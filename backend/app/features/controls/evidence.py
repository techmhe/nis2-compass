"""Evidence freshness per answer (requirement x entity).

Last evidence date = the newest of
  * the newest version of any document linked to the answer (DocumentLink target "answer"; retired documents and
    documents without a file count with their last change date), and
  * the last *effective* occurrence of a control activity linked to the requirement for that entity.
Validity = the shortest evidence validity of the linked active activities, otherwise DEFAULT_VALIDITY_DAYS.
Status: none (no evidence) | fresh | ageing (older than 80 % of the validity) | stale (older than the validity).
"""

from collections import defaultdict
from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.util import can_see_document
from app.core.deps import Principal
from app.features.controls.models import ControlActivity, ControlOccurrence
from app.features.controls.schedule import scope_entity_ids, today
from app.models import Answer, Document, DocumentLink, DocumentVersion

DEFAULT_VALIDITY_DAYS = 365
AGEING_SHARE = 0.8


def _as_date(v: datetime | date | None) -> date | None:
    if v is None:
        return None
    return v.date() if isinstance(v, datetime) else v


def classify(last: date | None, validity: int, ref: date) -> tuple[str, int | None]:
    if last is None:
        return "none", None
    age = (ref - last).days
    if age > validity:
        return "stale", age
    if age > validity * AGEING_SHARE:
        return "ageing", age
    return "fresh", age


def activity_index(db: Session) -> dict[int, list[ControlActivity]]:
    """requirement_id -> active activities linked to it."""
    idx: dict[int, list[ControlActivity]] = defaultdict(list)
    for a in db.scalars(select(ControlActivity).where(ControlActivity.active.is_(True))):
        for rid in a.requirement_ids or []:
            idx[int(rid)].append(a)
    return idx


def freshness_for_answers(
    db: Session, answers: list[Answer], pr: Principal, ref: date | None = None
) -> dict[int, dict]:
    """Document titles are only shown when the caller may see the document (restricted documents stay anonymous)."""
    ref = ref or today()
    if not answers:
        return {}
    ids = [a.id for a in answers]
    # newest document version per answer
    doc_dates: dict[int, tuple[date, str]] = {}
    rows = db.execute(
        select(DocumentLink.target_id, Document.id, func.max(DocumentVersion.uploaded_at))
        .join(Document, Document.id == DocumentLink.document_id)
        .outerjoin(DocumentVersion, DocumentVersion.document_id == Document.id)
        .where(
            DocumentLink.target_type == "answer",
            DocumentLink.target_id.in_(ids),
            Document.status != "Retired",
        )
        .group_by(DocumentLink.target_id, Document.id)
    ).all()
    docs = (
        {x.id: x for x in db.scalars(select(Document).where(Document.id.in_({r[1] for r in rows})))}
        if rows
        else {}
    )
    for aid, did, newest_version in rows:
        doc = docs[did]
        title = doc.title if can_see_document(pr, doc) else "Linked document"
        d = _as_date(newest_version or doc.updated_at)
        if d and (aid not in doc_dates or d > doc_dates[aid][0]):
            doc_dates[aid] = (d, title)

    idx = activity_index(db)
    scope_cache: dict[int, set[int]] = {}
    act_ids = {a.id for acts in idx.values() for a in acts}
    last_eff: dict[tuple[int, int], date] = {}
    if act_ids:
        for act_id, ent_id, performed in db.execute(
            select(
                ControlOccurrence.activity_id,
                ControlOccurrence.entity_id,
                func.max(ControlOccurrence.performed_at),
            )
            .where(
                ControlOccurrence.activity_id.in_(act_ids),
                ControlOccurrence.result == "effective",
                ControlOccurrence.status == "done",
            )
            .group_by(ControlOccurrence.activity_id, ControlOccurrence.entity_id)
        ):
            if performed:
                last_eff[(act_id, ent_id)] = performed

    out: dict[int, dict] = {}
    for a in answers:
        ent = a.assessment.entity_id
        acts = []
        for act in idx.get(a.requirement_id, []):
            if act.id not in scope_cache:
                scope_cache[act.id] = set(scope_entity_ids(db, act))
            if ent in scope_cache[act.id]:
                acts.append(act)
        validity = min((x.evidence_validity_days for x in acts), default=DEFAULT_VALIDITY_DAYS)
        best: tuple[date, str, str] | None = None
        if a.id in doc_dates:
            d, title = doc_dates[a.id]
            best = (d, "document", title)
        for act in acts:
            d = last_eff.get((act.id, ent))
            if d and (best is None or d > best[0]):
                best = (d, "control", f"{act.code} {act.title}")
        status, age = classify(best[0] if best else None, validity, ref)
        out[a.id] = {
            "answer_id": a.id,
            "requirement_id": a.requirement_id,
            "last_evidence_at": best[0] if best else None,
            "source": best[1] if best else None,
            "source_label": best[2] if best else None,
            "age_days": age,
            "validity_days": validity,
            "status": status,
            "activities": [{"id": x.id, "code": x.code} for x in acts],
        }
    return out
