"""Permission-aware hybrid search (full text + optional vector similarity) over search_chunks."""

import re
from dataclasses import dataclass

from sqlalchemy import and_, case, false, func, or_, select, text
from sqlalchemy.orm import Session

from app.core.deps import Principal
from app.models import SearchChunk
from app.services.indexing import SOURCE_LABELS, SOURCE_PERMISSIONS


@dataclass
class Hit:
    id: int
    source_type: str
    source_id: int
    title: str
    snippet: str
    content: str
    url: str | None
    entity_id: int | None
    score: float
    meta: dict | None

    def as_dict(self, with_content: bool = False) -> dict:
        d = {
            "source_type": self.source_type,
            "source_label": SOURCE_LABELS.get(self.source_type, self.source_type),
            "source_id": self.source_id,
            "title": self.title,
            "snippet": self.snippet,
            "url": self.url,
            "entity_id": self.entity_id,
            "score": round(self.score, 4),
            "meta": self.meta,
        }
        if with_content:
            d["content"] = self.content
        return d


def permission_filter(pr: Principal, types: list[str] | None = None):
    conds = []
    for st, perm in SOURCE_PERMISSIONS.items():
        if types and st not in types:
            continue
        if st == "task" and not pr.has_any(perm):
            # without tasks.read users still find their own tasks
            conds.append(
                and_(SearchChunk.source_type == "task", SearchChunk.meta["assignee_id"].as_integer() == pr.id)
            )
            continue
        scope = pr.entity_scope(perm)
        if scope is None:
            conds.append(SearchChunk.source_type == st)
        elif scope:
            conds.append(
                and_(
                    SearchChunk.source_type == st,
                    or_(SearchChunk.entity_id.is_(None), SearchChunk.entity_id.in_(scope)),
                )
            )
    return or_(*conds) if conds else false()


def _restricted_ok(pr: Principal, hit: Hit) -> bool:
    if hit.source_type != "document" or not hit.meta:
        return True
    if hit.meta.get("classification") != "Restricted":
        return True
    return (
        pr.can_write("documents.manage", hit.entity_id)
        or hit.meta.get("owner_id") == pr.id
        or hit.meta.get("created_by_id") == pr.id
    )


TYPE_WEIGHTS = {
    "document": 1.4,
    "answer": 1.25,
    "provision": 1.15,
    "requirement": 1.1,
    "action_item": 1.0,
    "work_package": 1.0,
    "incident": 1.0,
    "raid": 0.9,
    "activity": 0.9,
    "gate": 0.9,
    "task": 0.75,
    "entity": 0.8,
    "project": 0.7,
}
STOP = {
    "what",
    "which",
    "who",
    "whom",
    "does",
    "did",
    "do",
    "we",
    "our",
    "us",
    "the",
    "a",
    "an",
    "is",
    "are",
    "for",
    "of",
    "to",
    "in",
    "on",
    "and",
    "or",
    "have",
    "has",
    "had",
    "any",
    "there",
    "this",
    "that",
    "with",
    "about",
    "already",
    "say",
    "says",
    "tell",
    "me",
    "show",
    "can",
    "you",
    "please",
    "how",
    "when",
    "where",
    "was",
    "were",
    "be",
    "been",
    "it",
    "its",
    "at",
    "by",
    "from",
    "as",
    "if",
    "not",
    "no",
    "yes",
    "wie",
    "der",
    "die",
    "das",
    "und",
    "oder",
    "ist",
    "sind",
    "haben",
    "wir",
    "unsere",
    "welche",
    "gibt",
    "es",
    "ein",
    "eine",
    "zu",
    "für",
    "mit",
}


def _words(q: str) -> list[str]:
    ws = [w for w in re.findall(r"[\wäöüß]+", q.lower()) if len(w) >= 2 and w not in STOP]
    return list(dict.fromkeys(ws))[:16]


def _identifiers(q: str) -> list[str]:
    ids = re.findall(r"(?<![\w.])(\d{1,2}(?:\.\d{1,2}){1,2}|[A-Za-z]{1,4}-\d{1,4})(?![\w.])", q)
    ids += [w for w in re.findall(r"\b[A-Z]{2,4}\b", q) if w not in {"MFA", "ISO", "NIS", "IT", "OT", "IR"}]
    return list(dict.fromkeys(ids))[:5]


def _prefix_query(q: str) -> str | None:
    words = re.findall(r"[\wäöüß]+", q.lower())
    words = [w for w in words if len(w) >= 2][:8]
    if not words:
        return None
    return " & ".join(f"{w}:*" for w in words)


def search(
    db: Session,
    pr: Principal,
    q: str,
    types: list[str] | None = None,
    entity_id: int | None = None,
    limit: int = 20,
    query_embedding: list[float] | None = None,
    embedding_model: str | None = None,
) -> list[Hit]:
    q = (q or "").replace("\x00", " ").strip()[:500]
    if not q:
        return []
    limit = max(1, min(limit, 200))
    perm = permission_filter(pr, types)
    # AND semantics (all terms) for precision, OR semantics over the individual words for recall on
    # natural-language questions; both in english/german/simple configurations.
    and_q = (
        func.websearch_to_tsquery("english", q)
        .op("||")(func.websearch_to_tsquery("german", q))
        .op("||")(func.websearch_to_tsquery("simple", q))
    )
    prefix = _prefix_query(q)
    if prefix:
        and_q = and_q.op("||")(func.to_tsquery("simple", prefix))
    words = _words(q)
    or_q = None
    if words:
        joined = " | ".join(words)
        or_q = func.to_tsquery("english", joined).op("||")(func.to_tsquery("simple", joined))
    match_q = and_q.op("||")(or_q) if or_q is not None else and_q
    like = f"%{q[:100].replace('%', '').replace('_', '')}%"
    weight = case(*[(SearchChunk.source_type == k, v) for k, v in TYPE_WEIGHTS.items()], else_=1.0)
    rank = (
        func.ts_rank_cd(SearchChunk.tsv, match_q, 32)
        + case((SearchChunk.tsv.op("@@")(and_q), 0.5), else_=0.0)
    ) * weight + case((SearchChunk.title.ilike(like), 1.0), else_=0.0)
    # explicit identifiers in the query (requirement numbers, AP-/WP-/T- codes, entity codes) boost exact titles
    for tok in _identifiers(q):
        rank = rank + case(
            (SearchChunk.title.op("~*")(rf"(^|[\s(–-]){re.escape(tok)}([\s),:]|$)"), 1.5), else_=0.0
        )

    stmt = (
        select(
            SearchChunk,
            rank.label("rank"),
            func.ts_headline(
                "english",
                SearchChunk.content,
                match_q,
                "StartSel=«, StopSel=», MaxWords=28, MinWords=12, MaxFragments=2, FragmentDelimiter= … ",
            ).label("snippet"),
        )
        .where(perm)
        .where(
            or_(
                SearchChunk.tsv.op("@@")(match_q),
                SearchChunk.title.ilike(like),
                SearchChunk.content.ilike(like),
            )
        )
    )
    if types:
        stmt = stmt.where(SearchChunk.source_type.in_(types))
    if entity_id is not None:
        stmt = stmt.where(or_(SearchChunk.entity_id == entity_id, SearchChunk.entity_id.is_(None)))
    stmt = stmt.order_by(text("rank DESC")).limit(limit * 4)

    fts: list[Hit] = []
    for chunk, rnk, snippet in db.execute(stmt):
        fts.append(
            Hit(
                chunk.id,
                chunk.source_type,
                chunk.source_id,
                chunk.title,
                snippet or chunk.content[:240],
                chunk.content,
                chunk.url,
                chunk.entity_id,
                float(rnk or 0),
                chunk.meta,
            )
        )

    vec: list[Hit] = []
    if query_embedding is not None and embedding_model:
        dist = SearchChunk.embedding.cosine_distance(query_embedding)
        vstmt = (
            select(SearchChunk, dist.label("dist"))
            .where(perm)
            .where(SearchChunk.embedding_model == embedding_model, SearchChunk.embedding.is_not(None))
        )
        if types:
            vstmt = vstmt.where(SearchChunk.source_type.in_(types))
        if entity_id is not None:
            vstmt = vstmt.where(or_(SearchChunk.entity_id == entity_id, SearchChunk.entity_id.is_(None)))
        for chunk, d in db.execute(vstmt.order_by(dist).limit(limit * 3)):
            vec.append(
                Hit(
                    chunk.id,
                    chunk.source_type,
                    chunk.source_id,
                    chunk.title,
                    chunk.content[:300],
                    chunk.content,
                    chunk.url,
                    chunk.entity_id,
                    1 - float(d),
                    chunk.meta,
                )
            )

    # reciprocal-rank fusion, then collapse to best chunk per source object
    fused: dict[int, tuple[float, Hit]] = {}
    for lst in (fts, vec):
        for rank_pos, h in enumerate(lst):
            s = 1.0 / (60 + rank_pos)
            prev = fused.get(h.id)
            fused[h.id] = ((prev[0] if prev else 0) + s, prev[1] if prev and lst is vec else h)
    ordered = sorted(fused.values(), key=lambda x: -x[0])
    seen: set[tuple[str, int]] = set()
    per_type: dict[str, int] = {}
    cap = limit if (types and len(types) == 1) else max(3, limit // 2)
    out: list[Hit] = []
    overflow: list[Hit] = []
    for s, h in ordered:
        if not _restricted_ok(pr, h):
            continue
        key = (h.source_type, h.source_id)
        if key in seen:
            continue
        seen.add(key)
        h.score = s
        if per_type.get(h.source_type, 0) >= cap:
            overflow.append(h)
            continue
        per_type[h.source_type] = per_type.get(h.source_type, 0) + 1
        out.append(h)
        if len(out) >= limit:
            break
    return (out + overflow)[:limit]


def retrieve_chunks(
    db: Session,
    pr: Principal,
    q: str,
    limit: int = 12,
    types: list[str] | None = None,
    entity_id: int | None = None,
    query_embedding=None,
    embedding_model=None,
) -> list[Hit]:
    """Like search() but keeps several chunks of the same object (for RAG context)."""
    hits = search(
        db,
        pr,
        q,
        types,
        entity_id,
        limit=limit * 2,
        query_embedding=query_embedding,
        embedding_model=embedding_model,
    )
    return hits[:limit]
