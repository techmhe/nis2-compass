"""Unified search index (search_chunks) maintenance.

Every searchable object is flattened into one or more text chunks with an entity scope and a frontend URL.
Global search and the AI assistant both query this table, filtered by the caller's permissions.
"""

import logging
import re

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.jurisdictions import sector_label
from app.models import (
    ActionItem,
    Activity,
    Answer,
    Document,
    Entity,
    Gate,
    Incident,
    Project,
    Provision,
    RaidRecord,
    Requirement,
    SearchChunk,
    Task,
    WorkPackage,
)

log = logging.getLogger(__name__)

# source_type -> permission required to see it
SOURCE_PERMISSIONS: dict[str, str] = {
    "document": "documents.read",
    "requirement": "catalog.read",
    "answer": "assessments.read",
    "action_item": "findings.read",
    "work_package": "workpackages.read",
    "task": "tasks.read",
    "activity": "projects.read",
    "gate": "projects.read",
    "raid": "projects.read",
    "project": "projects.read",
    "provision": "regulations.read",
    "incident": "incidents.read",
    "entity": "entities.read",
}

SOURCE_LABELS = {
    "document": "Document",
    "requirement": "Requirement",
    "answer": "Assessment answer",
    "action_item": "Action plan item",
    "work_package": "Work package",
    "task": "Task",
    "activity": "Master plan",
    "gate": "Gate",
    "raid": "RAID record",
    "project": "Project",
    "provision": "Regulation",
    "incident": "Incident",
    "entity": "Entity",
}

CHUNK_SIZE = 1400
CHUNK_OVERLAP = 200


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    text = re.sub(r"\n{3,}", "\n\n", text or "").strip()
    if len(text) <= size:
        return [text] if text else []
    paras = text.split("\n")
    chunks, cur = [], ""
    for p in paras:
        while len(p) > size:  # hard-split very long paragraphs
            head, p = p[:size], p[size - overlap :]
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.append(head)
        if len(cur) + len(p) + 1 > size and cur:
            chunks.append(cur)
            cur = cur[-overlap:] + "\n" + p if overlap else p
        else:
            cur = (cur + "\n" + p) if cur else p
    if cur.strip():
        chunks.append(cur)
    return chunks


def _j(*parts) -> str:
    return "\n".join(str(p) for p in parts if p)


def _build(db: Session, source_type: str, obj) -> list[dict]:
    """Return list of chunk dicts {title, content, entity_id, url, meta}."""
    if source_type == "document":
        d: Document = obj
        header = _j(
            d.title,
            d.description,
            f"Type: {d.doc_type}; Status: {d.status}; Classification: {d.classification}",
            ("Tags: " + ", ".join(d.tags)) if d.tags else None,
            f"Entity: {d.entity.name}" if d.entity else None,
        )
        body = d.current_version.extracted_text if d.current_version else None
        meta = {
            "doc_type": d.doc_type,
            "status": d.status,
            "classification": d.classification,
            "owner_id": d.owner_id,
            "created_by_id": d.created_by_id,
            "filename": d.current_version.filename if d.current_version else None,
        }
        pieces = chunk_text(body or "") or [""]
        return [
            {
                "title": d.title,
                "content": _j(header if i == 0 else f"{d.title} (continued)", c),
                "entity_id": d.entity_id,
                "url": f"/documents/{d.id}",
                "meta": meta,
            }
            for i, c in enumerate(pieces)
        ]
    if source_type == "requirement":
        r: Requirement = obj
        return [
            {
                "title": f"{r.number} {r.section}",
                "content": _j(
                    f"Requirement {r.number} (Chapter {r.chapter.number} {r.chapter.title})",
                    r.section,
                    r.text,
                    r.check_points,
                    f"Legal reference: {r.legal_reference}" if r.legal_reference else None,
                    f"ISO/IEC 27001:2022: {r.iso_reference}" if r.iso_reference else None,
                    r.guidance,
                ),
                "entity_id": None,
                "url": f"/catalog/{r.id}",
                "meta": {"number": r.number, "chapter": r.chapter.number},
            }
        ]
    if source_type == "answer":
        a: Answer = obj
        if not any(
            [
                a.implemented,
                a.documented,
                a.effectiveness,
                a.evidence,
                a.gap_description,
                a.recommended_action,
                a.notes,
                a.scope != "In Scope",
            ]
        ):
            return []
        ent = a.assessment.entity
        r = a.requirement
        return [
            {
                "title": f"{ent.name} – {r.number} {r.section}",
                "content": _j(
                    f"Assessment answer of entity {ent.name} ({ent.code}) for requirement {r.number} in {a.assessment.round.name}",
                    f"Requirement: {r.text[:500]}",
                    f"Scope: {a.scope}; Implemented: {a.implemented or '-'}; Documented: {a.documented or '-'}; "
                    f"Effectiveness: {a.effectiveness or '-'}; Score: {'' if a.score is None else f'{a.score:.0%}'}",
                    f"Evidence / Source: {a.evidence}" if a.evidence else None,
                    f"Gap: {a.gap_description}" if a.gap_description else None,
                    f"Recommended action: {a.recommended_action}" if a.recommended_action else None,
                    f"Responsible: {a.responsible.name}" if a.responsible else None,
                    f"Finding ID: {a.finding_id}" if a.finding_id else None,
                    f"Notes: {a.notes}" if a.notes else None,
                ),
                "entity_id": ent.id,
                "url": f"/assessments/{a.assessment_id}?req={r.id}",
                "meta": {"requirement": r.number, "entity": ent.code, "round_id": a.assessment.round_id},
            }
        ]
    if source_type == "action_item":
        x: ActionItem = obj
        return [
            {
                "title": f"{x.code} {x.title[:200]}",
                "content": _j(
                    f"Action plan item {x.code} for {x.entity.name}, requirement {x.requirement.number} "
                    f"{x.requirement.section}",
                    x.title,
                    f"Priority: {x.priority}; Status: {x.status}; Target date: {x.target_date or '-'}",
                    f"Acceptance criterion: {x.acceptance_criterion}" if x.acceptance_criterion else None,
                    f"Expected evidence: {x.expected_evidence}" if x.expected_evidence else None,
                    f"Responsible: {x.responsible.name}" if x.responsible else None,
                    x.comments,
                ),
                "entity_id": x.entity_id,
                "url": f"/action-plan?item={x.id}",
                "meta": {"status": x.status},
            }
        ]
    if source_type == "work_package":
        w: WorkPackage = obj
        return [
            {
                "title": f"{w.code} {w.title[:200]}",
                "content": _j(
                    f"Work package {w.code} ({w.measure_area or 'no area'}, {w.central_or_local})",
                    w.title,
                    w.description,
                    f"Status: {w.status}; Priority: {w.priority}; Progress: {w.progress:.0%}",
                    f"Owner: {w.owner.display_name}" if w.owner else None,
                    f"Findings: {', '.join(f.code for f in w.findings)}" if w.findings else None,
                    f"Acceptance criterion: {w.acceptance_criterion}" if w.acceptance_criterion else None,
                    f"Expected evidence: {w.expected_evidence}" if w.expected_evidence else None,
                    w.comments,
                ),
                "entity_id": w.entity_id,
                "url": f"/work-packages/{w.id}",
                "meta": {"status": w.status},
            }
        ]
    if source_type == "task":
        t: Task = obj
        return [
            {
                "title": f"{t.key} {t.title}",
                "content": _j(
                    f"Task {t.key}: {t.title}",
                    t.description,
                    f"Status: {t.status}; Priority: {t.priority}; Due: {t.due_date or '-'}",
                    f"Assignee: {t.assignee.display_name}" if t.assignee else None,
                    f"Work package: {t.work_package.code} {t.work_package.title}" if t.work_package else None,
                    ("Checklist: " + "; ".join(c.get("text", "") for c in t.checklist))
                    if t.checklist
                    else None,
                ),
                "entity_id": t.entity_id,
                "url": f"/tasks?task={t.id}",
                "meta": {"status": t.status, "assignee_id": t.assignee_id},
            }
        ]
    if source_type == "activity":
        a2: Activity = obj
        return [
            {
                "title": f"{a2.code} {a2.title}",
                "content": _j(
                    f"Master plan activity {a2.code} ({a2.phase.name if a2.phase else ''})",
                    a2.title,
                    f"Owner: {a2.owner.name}" if a2.owner else None,
                    f"Support: {a2.support}" if a2.support else None,
                    f"Planned: {a2.planned_start} – {a2.planned_finish}; Status: {a2.status}; Progress {a2.progress:.0%}",
                    f"Deliverable / exit criterion: {a2.deliverable}" if a2.deliverable else None,
                    f"Gate: {a2.gate.code}" if a2.gate else None,
                ),
                "entity_id": None,
                "url": f"/projects/{a2.project_id}/plan?activity={a2.id}",
                "meta": {"status": a2.status},
            }
        ]
    if source_type == "gate":
        g: Gate = obj
        return [
            {
                "title": f"{g.code}: {g.decision or ''}"[:300],
                "content": _j(
                    f"Management gate {g.code}, planned {g.planned_date}, status {g.status}",
                    g.decision,
                    f"Decision owner: {g.decision_owner.name}" if g.decision_owner else None,
                    f"Required input: {g.required_input}" if g.required_input else None,
                    f"Approval criterion: {g.approval_criterion}" if g.approval_criterion else None,
                    g.decision_reference,
                ),
                "entity_id": None,
                "url": f"/projects/{g.project_id}/gates",
                "meta": {"status": g.status},
            }
        ]
    if source_type == "raid":
        rr: RaidRecord = obj
        return [
            {
                "title": f"{rr.code} {rr.type}: {rr.title[:200]}",
                "content": _j(
                    f"{rr.type} {rr.code} raised {rr.date_raised}",
                    rr.title,
                    f"Impact {rr.impact}, probability {rr.probability}, severity {rr.severity}; status {rr.status}",
                    f"Owner: {rr.owner.name}" if rr.owner else None,
                    f"Mitigation / action: {rr.mitigation}" if rr.mitigation else None,
                    f"Decision / resolution: {rr.resolution}" if rr.resolution else None,
                ),
                "entity_id": rr.entity_id,
                "url": f"/projects/{rr.project_id}/raid?record={rr.id}",
                "meta": {"status": rr.status},
            }
        ]
    if source_type == "project":
        p: Project = obj
        ov = "\n".join(f"{f.get('field')}: {f.get('value')}" for f in (p.overview or []))
        return [
            {
                "title": p.name,
                "content": _j(p.name, p.description, ov),
                "entity_id": None,
                "url": f"/projects/{p.id}",
                "meta": {},
            }
        ]
    if source_type == "provision":
        pv: Provision = obj
        if not pv.text and not pv.heading:
            return []
        reg = pv.regulation
        title = f"{reg.short_title} {pv.ref}" + (f" – {pv.heading}" if pv.heading else "")
        return [
            {
                "title": title[:590],
                "content": _j(title, c),
                "entity_id": None,
                "url": f"/regulations/{reg.id}?p={pv.id}",
                "meta": {"regulation": reg.code, "key": pv.key},
            }
            for c in (chunk_text(pv.text or "") or [""])
        ]
    if source_type == "incident":
        i: Incident = obj
        return [
            {
                "title": f"{i.code} {i.title}",
                "content": _j(
                    f"Incident {i.code} ({i.severity}, {i.status})",
                    i.title,
                    i.description,
                    i.impact,
                    i.root_cause,
                    i.measures,
                    i.lessons_learned,
                ),
                "entity_id": i.entity_id,
                "url": f"/incidents/{i.id}",
                "meta": {"status": i.status},
            }
        ]
    if source_type == "entity":
        e: Entity = obj
        return [
            {
                "title": f"{e.name} ({e.code})",
                "content": _j(
                    f"Legal entity {e.name}, code {e.code}, country {e.country}",
                    f"Sector/activity: {sector_label(e.activity_sector)}" if e.activity_sector else None,
                    f"NIS2 classification: {e.nis2_classification}" if e.nis2_classification else None,
                    f"Competent authority: {e.competent_authority}" if e.competent_authority else None,
                    f"CSIRT: {e.csirt}" if e.csirt else None,
                    f"Registration: {e.registration_status} {e.registration_date or ''}"
                    if e.registration_status
                    else None,
                    e.notes,
                ),
                "entity_id": e.id,
                "url": f"/entities/{e.id}",
                "meta": {},
            }
        ]
    if source_type in EXTRA_BUILDERS:
        return EXTRA_BUILDERS[source_type](db, obj)
    raise ValueError(source_type)


# --- extension point -------------------------------------------------------------------------------------
EXTRA_BUILDERS: dict = {}


def register_source(source_type: str, model, permission: str, label: str, builder) -> None:
    """Register an additional searchable object type from a feature module.

    builder(db, obj) -> list of {title, content, entity_id, url, meta} dicts (see _build)."""
    MODELS[source_type] = model
    SOURCE_PERMISSIONS[source_type] = permission
    SOURCE_LABELS[source_type] = label
    EXTRA_BUILDERS[source_type] = builder


MODELS = {
    "document": Document,
    "requirement": Requirement,
    "answer": Answer,
    "action_item": ActionItem,
    "work_package": WorkPackage,
    "task": Task,
    "activity": Activity,
    "gate": Gate,
    "raid": RaidRecord,
    "project": Project,
    "provision": Provision,
    "incident": Incident,
    "entity": Entity,
}


def index_object(db: Session, source_type: str, source_id: int, commit: bool = True) -> None:
    db.execute(
        delete(SearchChunk).where(SearchChunk.source_type == source_type, SearchChunk.source_id == source_id)
    )
    obj = db.get(MODELS[source_type], source_id)
    if obj is not None:
        for n, c in enumerate(_build(db, source_type, obj)):
            db.add(
                SearchChunk(
                    source_type=source_type,
                    source_id=source_id,
                    chunk_no=n,
                    entity_id=c["entity_id"],
                    title=c["title"][:600],
                    content=c["content"],
                    url=c["url"],
                    meta=c["meta"],
                )
            )
    if commit:
        db.commit()


def remove_object(db: Session, source_type: str, source_id: int, commit: bool = True) -> None:
    db.execute(
        delete(SearchChunk).where(SearchChunk.source_type == source_type, SearchChunk.source_id == source_id)
    )
    if commit:
        db.commit()


def reindex_all(db: Session, types: list[str] | None = None) -> int:
    n = 0
    for st, model in MODELS.items():
        if types and st not in types:
            continue
        db.execute(delete(SearchChunk).where(SearchChunk.source_type == st))
        for obj in db.scalars(select(model)):
            for i, c in enumerate(_build(db, st, obj)):
                db.add(
                    SearchChunk(
                        source_type=st,
                        source_id=obj.id,
                        chunk_no=i,
                        entity_id=c["entity_id"],
                        title=c["title"][:600],
                        content=c["content"],
                        url=c["url"],
                        meta=c["meta"],
                    )
                )
                n += 1
        db.commit()
    return n
