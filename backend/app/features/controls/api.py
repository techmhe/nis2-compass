"""Recurring control calendar, occurrences, evidence freshness and exceptions (KPIs: kpi_api.py)."""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import app.features.controls.hooks  # noqa: F401  (registers targets and search sources)
from app.api.util import (
    can_see_document,
    cleanup_target,
    doc_links_for,
    entity_ref,
    get_or_404,
    next_code,
    user_names,
)
from app.core.deps import Principal, get_principal, principal_of, require, user_can
from app.db import get_db, utcnow
from app.features.controls.evidence import freshness_for_answers
from app.features.controls.jobs import owner_user_id
from app.features.controls.kpi_api import router as kpi_router
from app.features.controls.models import ControlActivity, ControlException, ControlOccurrence
from app.features.controls.schedule import (
    ANCHOR_MAX,
    MAX_DATE,
    MIN_DATE,
    RRuleError,
    add_months,
    effective_status,
    generate_occurrences,
    parse_rrule,
    scope_entity_ids,
    today,
)
from app.models import (
    ActionItem,
    Answer,
    Assessment,
    AssessmentRound,
    Document,
    DocumentLink,
    Entity,
    Requirement,
    Stakeholder,
)
from app.schemas.common import Ok
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object, remove_object
from app.services.notify import notify

router = APIRouter(prefix="/controls", tags=["controls"])
router.include_router(kpi_router)


# --- helpers ------------------------------------------------------------------------------------------------


def _reqs(db: Session, ids: list[int]) -> list[dict]:
    if not ids:
        return []
    rows = {r.id: r for r in db.scalars(select(Requirement).where(Requirement.id.in_(ids)))}
    return [{"id": r.id, "number": r.number, "section": r.section} for i in ids if (r := rows.get(i))]


def _can_record(pr: Principal, db: Session, o: ControlOccurrence) -> bool:
    if pr.can_write("controls.manage", o.entity_id):
        return True
    return pr.can_read("controls.read", o.entity_id) and owner_user_id(db, o.activity) == pr.id


def activity_out(
    db: Session, a: ControlActivity, stats: dict | None = None, owner_names: dict | None = None
) -> dict:
    st = db.get(Stakeholder, a.owner_stakeholder_id) if a.owner_stakeholder_id else None
    names = owner_names if owner_names is not None else user_names(db, [a.owner_user_id])
    ents = {e.id: e for e in db.scalars(select(Entity))}
    return {
        "id": a.id,
        "code": a.code,
        "title": a.title,
        "description": a.description,
        "requirement_ids": a.requirement_ids or [],
        "requirements": _reqs(db, a.requirement_ids or []),
        "legal_refs": a.legal_refs,
        "entity_scope": a.entity_scope,
        "entity_ids": a.entity_ids or [],
        "entities": [entity_ref(ents[i]) for i in (scope_entity_ids(db, a)) if i in ents],
        "recurrence": a.recurrence,
        "rrule": a.rrule,
        "anchor_month": a.anchor_month,
        "owner_stakeholder_id": a.owner_stakeholder_id,
        "owner_stakeholder_name": st.name if st else None,
        "owner_user_id": a.owner_user_id,
        "owner_user_name": names.get(a.owner_user_id) if a.owner_user_id else None,
        "required_evidence": a.required_evidence,
        "evidence_validity_days": a.evidence_validity_days,
        "active": a.active,
        "created_at": a.created_at,
        "updated_at": a.updated_at,
        "stats": stats or {},
    }


def occurrence_out(
    o: ControlOccurrence, names: dict[int, str], ref: date | None = None, linked: set[int] | None = None
) -> dict:
    a = o.activity
    return {
        "id": o.id,
        "activity": {"id": a.id, "code": a.code, "title": a.title, "required_evidence": a.required_evidence},
        "entity": entity_ref(o.entity),
        "period_key": o.period_key,
        "period_label": o.period_label,
        "due_date": o.due_date,
        "status": effective_status(o, ref),
        "stored_status": o.status,
        "performed_by_id": o.performed_by_id,
        "performed_by_name": names.get(o.performed_by_id) if o.performed_by_id else None,
        "performed_at": o.performed_at,
        "result": o.result,
        "notes": o.notes,
        "action_item_id": o.action_item_id,
        "has_evidence": (o.id in linked) if linked is not None else None,
        "updated_at": o.updated_at,
    }


def _linked_occurrences(db: Session, ids: list[int]) -> set[int]:
    if not ids:
        return set()
    return set(
        db.scalars(
            select(DocumentLink.target_id).where(
                DocumentLink.target_type == "control_occurrence", DocumentLink.target_id.in_(ids)
            )
        )
    )


# --- activities -----------------------------------------------------------------------------------------------


class ActivityIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=10000)
    requirement_ids: list[int] = Field(default_factory=list, max_length=100)
    legal_refs: str | None = Field(default=None, max_length=400)
    entity_scope: Literal["all", "list"] = "all"
    entity_ids: list[int] = Field(default_factory=list, max_length=50)
    recurrence: Literal["monthly", "quarterly", "semi_annual", "annual", "custom"] = "annual"
    rrule: str | None = Field(default=None, max_length=200)
    anchor_month: int = Field(default=12, ge=1, le=12)
    owner_stakeholder_id: int | None = None
    owner_user_id: int | None = None
    required_evidence: str | None = Field(default=None, max_length=4000)
    evidence_validity_days: int = Field(default=365, ge=1, le=3650)
    active: bool = True

    @model_validator(mode="after")
    def _check(self):
        if self.recurrence == "custom":
            try:
                parse_rrule(self.rrule or "")
            except RRuleError as e:
                raise ValueError(f"Invalid schedule rule: {e}") from None
        else:
            self.rrule = None
            self.anchor_month = min(self.anchor_month, ANCHOR_MAX[self.recurrence])
        if self.entity_scope == "list" and not self.entity_ids:
            raise ValueError("Choose at least one entity or apply the activity to all entities")
        if self.entity_scope == "all":
            self.entity_ids = []
        self.requirement_ids = list(dict.fromkeys(self.requirement_ids))
        return self


def _validate_refs(db: Session, body: ActivityIn) -> None:
    if body.requirement_ids:
        found = set(db.scalars(select(Requirement.id).where(Requirement.id.in_(body.requirement_ids))))
        if found != set(body.requirement_ids):
            raise HTTPException(422, "Unknown requirement")
    if body.entity_ids:
        found = set(db.scalars(select(Entity.id).where(Entity.id.in_(body.entity_ids))))
        if found != set(body.entity_ids):
            raise HTTPException(422, "Unknown entity")
    if body.owner_stakeholder_id and not db.get(Stakeholder, body.owner_stakeholder_id):
        raise HTTPException(422, "Unknown stakeholder")
    if body.owner_user_id:
        owner = principal_of(db, body.owner_user_id)
        if owner is None or not owner.has_any("controls.read"):
            raise HTTPException(422, "The owner must be an active user with read access to controls")


def _activity_stats(db: Session, pr: Principal) -> dict[int, dict]:
    ref = today()
    scope = pr.entity_scope("controls.read")
    stmt = select(ControlOccurrence).where(
        ControlOccurrence.due_date >= add_months(ref, -12), ControlOccurrence.due_date <= add_months(ref, 12)
    )
    if scope is not None:
        stmt = stmt.where(ControlOccurrence.entity_id.in_(scope or {-1}))
    out: dict[int, dict] = {}
    for o in db.scalars(stmt):
        s = out.setdefault(
            o.activity_id,
            {
                "done": 0,
                "overdue": 0,
                "not_effective": 0,
                "partially_effective": 0,
                "planned": 0,
                "next_due": None,
                "last_done": None,
            },
        )
        st = effective_status(o, ref)
        if st == "done":
            s["done"] += 1
            if o.result in ("not_effective", "partially_effective"):
                s[o.result] += 1
            if o.performed_at and (s["last_done"] is None or o.performed_at > s["last_done"]):
                s["last_done"] = o.performed_at
        elif st == "overdue":
            s["overdue"] += 1
        elif st == "planned":
            s["planned"] += 1
            if s["next_due"] is None or o.due_date < s["next_due"]:
                s["next_due"] = o.due_date
    return out


def _visible_scope(db: Session, pr: Principal, a: ControlActivity) -> list[int]:
    """Entities of the activity the caller may see; activities of other entities stay hidden."""
    return [e for e in scope_entity_ids(db, a) if pr.can_read("controls.read", e)]


def _scoped(pr: Principal, out: dict) -> dict:
    return {**out, "entities": [e for e in out["entities"] if pr.can_read("controls.read", e["id"])]}


@router.get("/activities")
def list_activities(pr: Principal = Depends(require("controls.read")), db: Session = Depends(get_db)):
    acts = [
        a
        for a in db.scalars(select(ControlActivity).order_by(ControlActivity.code))
        if _visible_scope(db, pr, a)
    ]
    stats = _activity_stats(db, pr)
    names = user_names(db, [a.owner_user_id for a in acts])
    return {
        "items": [_scoped(pr, activity_out(db, a, stats.get(a.id), names)) for a in acts],
        "can_manage": "controls.manage" in pr.global_perms,
    }


@router.get("/activities/{activity_id}")
def get_activity(
    activity_id: int, pr: Principal = Depends(require("controls.read")), db: Session = Depends(get_db)
):
    a = get_or_404(db, ControlActivity, activity_id, "Control activity")
    if not _visible_scope(db, pr, a):
        raise HTTPException(404, "Control activity not found")
    ref = today()
    occ = [
        o
        for o in db.scalars(
            select(ControlOccurrence)
            .where(
                ControlOccurrence.activity_id == a.id,
                ControlOccurrence.due_date >= add_months(ref, -24),
                ControlOccurrence.due_date <= add_months(ref, 12),
            )
            .order_by(ControlOccurrence.due_date, ControlOccurrence.entity_id)
        )
        if pr.can_read("controls.read", o.entity_id)
    ]
    names = user_names(db, [o.performed_by_id for o in occ] + [a.owner_user_id])
    linked = _linked_occurrences(db, [o.id for o in occ])
    return {
        "activity": _scoped(pr, activity_out(db, a, _activity_stats(db, pr).get(a.id), names)),
        "occurrences": [occurrence_out(o, names, ref, linked) for o in occ],
        "can_manage": pr.can_write("controls.manage", None),
    }


@router.post("/activities")
def create_activity(body: ActivityIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr.ensure("controls.manage", None, write=True)
    _validate_refs(db, body)
    a = ControlActivity(code=next_code(db, ControlActivity.code, "CA-"), **body.model_dump())
    db.add(a)
    db.flush()
    created, _ = generate_occurrences(db, a)
    audit(db, pr, "create", "control_activity", a.id, f"{a.code} {a.title}", details={"occurrences": created})
    db.commit()
    index_object(db, "control_activity", a.id)
    return activity_out(db, a)


@router.put("/activities/{activity_id}")
def update_activity(
    activity_id: int, body: ActivityIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    pr.ensure("controls.manage", None, write=True)
    a = get_or_404(db, ControlActivity, activity_id, "Control activity")
    _validate_refs(db, body)
    diff = apply_changes(a, body.model_dump())
    created, removed = generate_occurrences(db, a)
    audit(
        db,
        pr,
        "update",
        "control_activity",
        a.id,
        f"{a.code} {a.title}",
        details={**diff, "occurrences_created": created, "occurrences_removed": removed},
    )
    db.commit()
    index_object(db, "control_activity", a.id)
    return activity_out(db, a)


@router.post("/activities/{activity_id}/generate")
def regenerate(activity_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr.ensure("controls.manage", None, write=True)
    a = get_or_404(db, ControlActivity, activity_id, "Control activity")
    created, removed = generate_occurrences(db, a)
    db.commit()
    return {"created": created, "removed": removed}


@router.delete("/activities/{activity_id}", response_model=Ok)
def delete_activity(activity_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr.ensure("controls.manage", None, write=True)
    a = get_or_404(db, ControlActivity, activity_id, "Control activity")
    recorded = db.scalar(
        select(func.count(ControlOccurrence.id)).where(
            ControlOccurrence.activity_id == a.id, ControlOccurrence.status != "planned"
        )
    )
    if recorded:
        raise HTTPException(
            400, "The activity has recorded occurrences. Deactivate it instead to keep the history."
        )
    occ_ids = list(db.scalars(select(ControlOccurrence.id).where(ControlOccurrence.activity_id == a.id)))
    for oid in occ_ids:
        cleanup_target(db, "control_occurrence", oid)
    cleanup_target(db, "control_activity", a.id)
    audit(db, pr, "delete", "control_activity", a.id, f"{a.code} {a.title}")
    db.delete(a)
    db.commit()
    remove_object(db, "control_activity", activity_id)
    return Ok()


# --- occurrences and calendar -------------------------------------------------------------------------------


@router.get("/occurrences")
def list_occurrences(
    entity_id: int | None = None,
    activity_id: int | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 500,
    pr: Principal = Depends(require("controls.read")),
    db: Session = Depends(get_db),
):
    ref = today()
    stmt = select(ControlOccurrence).order_by(ControlOccurrence.due_date, ControlOccurrence.id)
    if entity_id is not None:
        stmt = stmt.where(ControlOccurrence.entity_id == entity_id)
    if activity_id is not None:
        stmt = stmt.where(ControlOccurrence.activity_id == activity_id)
    if date_from:
        stmt = stmt.where(ControlOccurrence.due_date >= date_from)
    if date_to:
        stmt = stmt.where(ControlOccurrence.due_date <= date_to)
    if status == "overdue":
        stmt = stmt.where(ControlOccurrence.status == "planned", ControlOccurrence.due_date < ref)
    elif status == "planned":
        stmt = stmt.where(ControlOccurrence.status == "planned", ControlOccurrence.due_date >= ref)
    elif status == "open":
        stmt = stmt.where(ControlOccurrence.status == "planned")
    elif status in ("done", "skipped"):
        stmt = stmt.where(ControlOccurrence.status == status)
    scope = pr.entity_scope("controls.read")
    if scope is not None:
        stmt = stmt.where(ControlOccurrence.entity_id.in_(scope or {-1}))
    occ = list(db.scalars(stmt.limit(max(1, min(limit, 2000)))))
    names = user_names(db, [o.performed_by_id for o in occ])
    linked = _linked_occurrences(db, [o.id for o in occ])
    return [occurrence_out(o, names, ref, linked) | {"can_record": _can_record(pr, db, o)} for o in occ]


@router.get("/calendar")
def calendar_view(
    start: str | None = None,
    months: int = 12,
    entity_id: int | None = None,
    pr: Principal = Depends(require("controls.read")),
    db: Session = Depends(get_db),
):
    """Heat map: rows = activities, columns = months, cells = occurrences due in that month (per entity)."""
    ref = today()
    months = max(1, min(months, 24))
    if start:
        try:
            y, m = start.split("-")
            first = date(int(y), int(m), 1)
            if not MIN_DATE <= first <= MAX_DATE:
                raise ValueError
        except ValueError:
            raise HTTPException(422, "start must be YYYY-MM") from None
    else:
        first = add_months(date(ref.year, ref.month, 1), -5)
    last = add_months(first, months) - timedelta(days=1)
    keys = [add_months(first, k).strftime("%Y-%m") for k in range(months)]
    stmt = select(ControlOccurrence).where(
        ControlOccurrence.due_date >= first, ControlOccurrence.due_date <= last
    )
    if entity_id is not None:
        stmt = stmt.where(ControlOccurrence.entity_id == entity_id)
    scope = pr.entity_scope("controls.read")
    if scope is not None:
        stmt = stmt.where(ControlOccurrence.entity_id.in_(scope or {-1}))
    rows: dict[int, dict] = {}
    for a in db.scalars(select(ControlActivity).order_by(ControlActivity.code)):
        rows[a.id] = {
            "activity": {
                "id": a.id,
                "code": a.code,
                "title": a.title,
                "recurrence": a.recurrence,
                "active": a.active,
            },
            "cells": {k: [] for k in keys},
        }
    for o in db.scalars(stmt.order_by(ControlOccurrence.due_date)):
        k = o.due_date.strftime("%Y-%m")
        rows[o.activity_id]["cells"][k].append(
            {
                "id": o.id,
                "entity_code": o.entity.code,
                "entity_id": o.entity_id,
                "status": effective_status(o, ref),
                "result": o.result,
                "due_date": o.due_date,
                "period_label": o.period_label,
            }
        )
    items = [r for r in rows.values() if r["activity"]["active"] or any(r["cells"][k] for k in keys)]
    return {"months": keys, "today": ref, "rows": items}


@router.get("/occurrences/{occurrence_id}")
def get_occurrence(
    occurrence_id: int, pr: Principal = Depends(require("controls.read")), db: Session = Depends(get_db)
):
    o = get_or_404(db, ControlOccurrence, occurrence_id, "Occurrence")
    pr.ensure("controls.read", o.entity_id)
    names = user_names(db, [o.performed_by_id])
    item = db.get(ActionItem, o.action_item_id) if o.action_item_id else None
    a = o.activity
    return {
        "occurrence": occurrence_out(o, names),
        "activity": activity_out(db, a),
        "documents": doc_links_for(db, pr, "control_occurrence", o.id),
        "action_item": {"id": item.id, "code": item.code, "title": item.title, "status": item.status}
        if item
        else None,
        "can_record": _can_record(pr, db, o),
        "can_create_finding": bool(a.requirement_ids),
    }


class OccurrenceIn(BaseModel):
    status: Literal["planned", "done", "skipped"]
    performed_at: date | None = None
    performed_by_id: int | None = None
    result: Literal["effective", "partially_effective", "not_effective"] | None = None
    notes: str | None = Field(default=None, max_length=10000)
    create_finding: bool = False
    finding_title: str | None = Field(default=None, max_length=2000)


@router.put("/occurrences/{occurrence_id}")
def record_occurrence(
    occurrence_id: int,
    body: OccurrenceIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    o = get_or_404(db, ControlOccurrence, occurrence_id, "Occurrence")
    if not _can_record(pr, db, o):
        raise HTTPException(
            403, "Only the control owner or a control manager for this entity can record results"
        )
    ref = today()
    data = body.model_dump(exclude={"create_finding", "finding_title"})
    if body.status == "done":
        if not body.result:
            raise HTTPException(422, "Record the result of the control")
        data["performed_at"] = body.performed_at or ref
        if data["performed_at"] > ref:
            raise HTTPException(422, "The performance date cannot be in the future")
        if data["performed_at"] < MIN_DATE:
            raise HTTPException(422, "The performance date is implausibly old")
        if pr.can_write("controls.manage", o.entity_id) and body.performed_by_id:
            # managers may record on behalf of another person who can see this entity's controls
            if not user_can(db, body.performed_by_id, "controls.read", o.entity_id):
                raise HTTPException(
                    422, "The performer must be an active user with access to this entity's controls"
                )
            data["performed_by_id"] = body.performed_by_id
        else:
            data["performed_by_id"] = pr.id
    elif body.status == "skipped":
        if not (body.notes or "").strip():
            raise HTTPException(422, "Explain in the notes why the occurrence is skipped")
        data.update(performed_at=None, performed_by_id=None, result=None)
    else:
        data.update(performed_at=None, performed_by_id=None, result=None)
    a = o.activity
    needs_finding = body.status == "done" and body.result == "not_effective" and not o.action_item_id
    if needs_finding and not body.create_finding:
        raise HTTPException(422, "A not effective result needs a finding: create an action plan item")
    diff = apply_changes(o, data)
    item = None
    if needs_finding:
        if not a.requirement_ids:
            raise HTTPException(422, "Link the activity to a requirement before creating a finding")
        rnd = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
        item = ActionItem(
            code=next_code(db, ActionItem.code, "AP-"),
            round_id=rnd,
            entity_id=o.entity_id,
            requirement_id=a.requirement_ids[0],
            title=(body.finding_title or "").strip()
            or f"Control {a.code} not effective ({o.period_label}): {a.title}",
            priority="High",
            status="Not Started",
            responsible_id=a.owner_stakeholder_id,
            target_date=ref + timedelta(days=30),
            acceptance_criterion=f"Control {a.code} performed again with the result effective",
            expected_evidence=a.required_evidence,
            comments=f"Created from control occurrence {a.code} {o.entity.code} {o.period_label}."
            + (f"\n\n{body.notes}" if body.notes else ""),
        )
        db.add(item)
        db.flush()
        o.action_item_id = item.id
        audit(
            db,
            pr,
            "create",
            "action_item",
            item.id,
            item.code,
            entity_id=item.entity_id,
            details={"source": f"control_occurrence {o.id}"},
        )
    audit(
        db,
        pr,
        "record",
        "control_occurrence",
        o.id,
        f"{a.code} {o.entity.code} {o.period_label}",
        entity_id=o.entity_id,
        details=diff,
    )
    db.commit()
    if item:
        index_object(db, "action_item", item.id)
    return get_occurrence(o.id, pr, db)


class EvidenceLinkIn(BaseModel):
    document_id: int
    note: str | None = Field(default=None, max_length=400)


def _evidence_target(db: Session, pr: Principal, occurrence_id: int) -> ControlOccurrence:
    """Evidence on an occurrence may be linked by everyone who may record it (control owner or manager)."""
    o = get_or_404(db, ControlOccurrence, occurrence_id, "Occurrence")
    pr.ensure("controls.read", o.entity_id)
    if not _can_record(pr, db, o):
        raise HTTPException(
            403, "Only the control owner or a control manager for this entity can change evidence"
        )
    return o


@router.post("/occurrences/{occurrence_id}/evidence")
def link_evidence(
    occurrence_id: int,
    body: EvidenceLinkIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    o = _evidence_target(db, pr, occurrence_id)
    d = db.get(Document, body.document_id)
    if d is None or not can_see_document(pr, d):
        raise HTTPException(404, "Document not found")
    if not db.scalar(
        select(DocumentLink.id).where(
            DocumentLink.document_id == d.id,
            DocumentLink.target_type == "control_occurrence",
            DocumentLink.target_id == o.id,
        )
    ):
        db.add(
            DocumentLink(
                document_id=d.id,
                target_type="control_occurrence",
                target_id=o.id,
                note=body.note,
                created_by_id=pr.id,
            )
        )
        audit(
            db, pr, "link", "document", d.id, f"{d.title} -> control_occurrence {o.id}", entity_id=o.entity_id
        )
        db.commit()
    return doc_links_for(db, pr, "control_occurrence", o.id)


@router.delete("/occurrences/{occurrence_id}/evidence/{link_id}")
def unlink_evidence(
    occurrence_id: int, link_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    o = _evidence_target(db, pr, occurrence_id)
    link = db.get(DocumentLink, link_id)
    if (
        link is None
        or link.target_type != "control_occurrence"
        or link.target_id != o.id
        or not can_see_document(pr, link.document)
    ):
        raise HTTPException(404, "Link not found")
    audit(db, pr, "unlink", "document", link.document_id, f"control_occurrence {o.id}", entity_id=o.entity_id)
    db.delete(link)
    db.commit()
    return doc_links_for(db, pr, "control_occurrence", o.id)


# --- evidence freshness -------------------------------------------------------------------------------------


@router.get("/freshness")
def freshness(
    assessment_id: int, pr: Principal = Depends(require("assessments.read")), db: Session = Depends(get_db)
):
    """Evidence freshness per answer of an assessment (badge in the assessment workspace)."""
    asm = get_or_404(db, Assessment, assessment_id, "Assessment")
    pr.ensure("assessments.read", asm.entity_id)
    answers = [
        a
        for a in db.scalars(select(Answer).where(Answer.assessment_id == asm.id))
        if a.scope != "Not Applicable"
    ]
    fr = freshness_for_answers(db, answers, pr)
    summary = {"fresh": 0, "ageing": 0, "stale": 0, "none": 0}
    for v in fr.values():
        summary[v["status"]] += 1
    return {
        "assessment_id": asm.id,
        "entity_id": asm.entity_id,
        "as_of": today(),
        "summary": summary,
        "items": list(fr.values()),
    }


@router.get("/evidence")
def evidence_list(
    round_id: int | None = None,
    entity_id: int | None = None,
    pr: Principal = Depends(require("assessments.read")),
    db: Session = Depends(get_db),
):
    """In-scope answers of a round with their evidence freshness (all statuses; the client filters)."""
    rid = round_id or db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    if rid is None:
        return {"round_id": None, "items": [], "summary": {}}
    stmt = select(Assessment).where(Assessment.round_id == rid)
    if entity_id is not None:
        stmt = stmt.where(Assessment.entity_id == entity_id)
    asms = [a for a in db.scalars(stmt) if pr.can_read("assessments.read", a.entity_id)]
    answers = (
        list(
            db.scalars(
                select(Answer).where(
                    Answer.assessment_id.in_([a.id for a in asms]), Answer.scope == "In Scope"
                )
            )
        )
        if asms
        else []
    )
    fr = freshness_for_answers(db, answers, pr)
    items, summary = [], {}
    for a in answers:
        f = fr[a.id]
        ent = a.assessment.entity
        s = summary.setdefault(
            ent.code, {"entity": entity_ref(ent), "fresh": 0, "ageing": 0, "stale": 0, "none": 0}
        )
        s[f["status"]] += 1
        items.append(
            {
                **f,
                "assessment_id": a.assessment_id,
                "entity": entity_ref(ent),
                "requirement": {
                    "id": a.requirement.id,
                    "number": a.requirement.number,
                    "section": a.requirement.section,
                    "chapter": a.requirement.chapter.number,
                },
                "implemented": a.implemented,
                "effectiveness": a.effectiveness,
            }
        )
    items.sort(
        key=lambda x: (
            {"stale": 0, "ageing": 1, "none": 2, "fresh": 3}[x["status"]],
            -(x["age_days"] or 0),
            x["entity"]["code"],
            x["requirement"]["id"],
        )
    )
    return {"round_id": rid, "as_of": today(), "items": items, "summary": list(summary.values())}


# --- exceptions ---------------------------------------------------------------------------------------------


def exc_status(x: ControlException, ref: date | None = None) -> str:
    if x.status == "approved" and x.expires_at < (ref or today()):
        return "expired"
    return x.status


def exception_out(
    db: Session, pr: Principal, x: ControlException, names: dict[int, str] | None = None
) -> dict:
    names = names if names is not None else user_names(db, [x.requested_by_id, x.approver_id])
    req = db.get(Requirement, x.requirement_id) if x.requirement_id else None
    act = db.get(ControlActivity, x.activity_id) if x.activity_id else None
    status = exc_status(x)
    return {
        "id": x.id,
        "code": x.code,
        "title": x.title,
        "scope_type": x.scope_type,
        "entity": entity_ref(x.entity),
        "requirement": {"id": req.id, "number": req.number, "section": req.section} if req else None,
        "activity": {"id": act.id, "code": act.code, "title": act.title} if act else None,
        "reason": x.reason,
        "compensating_measures": x.compensating_measures,
        "requested_by_id": x.requested_by_id,
        "requested_by_name": names.get(x.requested_by_id),
        "approver_id": x.approver_id,
        "approver_name": names.get(x.approver_id),
        "status": status,
        "decided_at": x.decided_at,
        "decision_note": x.decision_note,
        "expires_at": x.expires_at,
        "days_to_expiry": (x.expires_at - today()).days,
        "created_at": x.created_at,
        "updated_at": x.updated_at,
        "can_edit": pr.can_write("controls.manage", x.entity_id),
        "can_decide": x.status == "requested"
        and x.approver_id == pr.id
        and x.requested_by_id != pr.id
        and pr.can_write("controls.manage", x.entity_id),
    }


@router.get("/exceptions")
def list_exceptions(pr: Principal = Depends(require("controls.read")), db: Session = Depends(get_db)):
    rows = [
        x
        for x in db.scalars(select(ControlException).order_by(ControlException.expires_at))
        if pr.can_read("controls.read", x.entity_id)
    ]
    names = user_names(db, [u for x in rows for u in (x.requested_by_id, x.approver_id)])
    return {
        "items": [exception_out(db, pr, x, names) for x in rows],
        "can_create": pr.has_any("controls.manage"),
    }


class ExceptionIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    scope_type: Literal["entity", "requirement", "control"] = "requirement"
    entity_id: int | None = None
    requirement_id: int | None = None
    activity_id: int | None = None
    reason: str = Field(min_length=1, max_length=10000)
    compensating_measures: str | None = Field(default=None, max_length=10000)
    approver_id: int
    expires_at: date

    @model_validator(mode="after")
    def _check(self):
        if self.scope_type == "requirement" and not self.requirement_id:
            raise ValueError("Choose the requirement the exception applies to")
        if self.scope_type == "control" and not self.activity_id:
            raise ValueError("Choose the control activity the exception applies to")
        if self.scope_type == "entity" and not self.entity_id:
            raise ValueError("Choose the entity the exception applies to")
        return self


def _validate_exception(db: Session, pr: Principal, body: ExceptionIn) -> None:
    pr.ensure("controls.manage", body.entity_id, write=True)
    if body.approver_id == pr.id:
        raise HTTPException(422, "You cannot approve your own exception; choose another approver")
    if not user_can(db, body.approver_id, "controls.manage", body.entity_id, write=True):
        raise HTTPException(
            422,
            "The approver must be an active user who manages controls for this "
            + ("entity" if body.entity_id else "group (group-wide rights)"),
        )
    if body.requirement_id and not db.get(Requirement, body.requirement_id):
        raise HTTPException(422, "Unknown requirement")
    if body.activity_id and not db.get(ControlActivity, body.activity_id):
        raise HTTPException(422, "Unknown control activity")
    if body.entity_id and not db.get(Entity, body.entity_id):
        raise HTTPException(422, "Unknown entity")
    if body.expires_at <= today():
        raise HTTPException(422, "The expiry date must be in the future")
    if body.expires_at > add_months(today(), 36):
        raise HTTPException(422, "Exceptions can be granted for at most three years")


def _notify_approver(db: Session, pr: Principal, x: ControlException) -> None:
    if not user_can(db, x.approver_id, "controls.read", x.entity_id):
        return
    notify(
        db,
        x.approver_id,
        "assigned",
        f"Approval requested: exception {x.code} {x.title}",
        f"/controls/exceptions?exception={x.id}",
        actor_id=pr.id,
    )


@router.post("/exceptions")
def create_exception(
    body: ExceptionIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    _validate_exception(db, pr, body)
    x = ControlException(
        code=next_code(db, ControlException.code, "EX-"),
        **body.model_dump(),
        requested_by_id=pr.id,
        status="requested",
    )
    db.add(x)
    db.flush()
    _notify_approver(db, pr, x)
    audit(db, pr, "create", "control_exception", x.id, f"{x.code} {x.title}", entity_id=x.entity_id)
    db.commit()
    index_object(db, "control_exception", x.id)
    return exception_out(db, pr, x)


@router.put("/exceptions/{exception_id}")
def update_exception(
    exception_id: int,
    body: ExceptionIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    x = get_or_404(db, ControlException, exception_id, "Exception")
    pr.ensure("controls.manage", x.entity_id, write=True)
    if x.status in ("rejected", "revoked"):
        raise HTTPException(400, "Rejected or revoked exceptions cannot be changed; create a new one")
    _validate_exception(db, pr, body)
    if body.approver_id == x.requested_by_id:
        raise HTTPException(422, "The approver must differ from the requester")
    diff = apply_changes(x, body.model_dump())
    material = diff.keys() & {
        "scope_type",
        "entity_id",
        "requirement_id",
        "activity_id",
        "reason",
        "compensating_measures",
        "expires_at",
        "approver_id",
    }
    if material and x.status == "approved":
        x.status, x.decided_at, x.decision_note = "requested", None, None
        diff["status"] = ["approved", "requested"]
    if material and x.status == "requested":
        _notify_approver(db, pr, x)
    audit(
        db,
        pr,
        "update",
        "control_exception",
        x.id,
        f"{x.code} {x.title}",
        entity_id=x.entity_id,
        details=diff,
    )
    db.commit()
    index_object(db, "control_exception", x.id)
    return exception_out(db, pr, x)


class DecisionIn(BaseModel):
    decision: Literal["approve", "reject"]
    note: str | None = Field(default=None, max_length=4000)


@router.post("/exceptions/{exception_id}/decision")
def decide_exception(
    exception_id: int, body: DecisionIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    x = get_or_404(db, ControlException, exception_id, "Exception")
    pr.ensure("controls.read", x.entity_id)
    if x.status != "requested":
        raise HTTPException(400, "Only requested exceptions can be decided")
    if x.approver_id != pr.id:
        raise HTTPException(403, "Only the named approver can decide on this exception")
    if x.requested_by_id == pr.id:
        raise HTTPException(403, "The requester cannot approve their own exception")
    if not pr.can_write("controls.manage", x.entity_id):
        raise HTTPException(
            403, "Deciding on this exception requires the right to manage controls for its entity"
        )
    if body.decision == "reject" and not (body.note or "").strip():
        raise HTTPException(422, "Give a reason for the rejection")
    x.status = "approved" if body.decision == "approve" else "rejected"
    x.decided_at = utcnow()
    x.decision_note = (body.note or "").strip() or None
    if user_can(db, x.requested_by_id, "controls.read", x.entity_id):
        notify(
            db,
            x.requested_by_id,
            "assigned",
            f"Exception {x.code} {x.status}: {x.title}",
            f"/controls/exceptions?exception={x.id}",
            actor_id=pr.id,
        )
    audit(
        db,
        pr,
        body.decision,
        "control_exception",
        x.id,
        f"{x.code} {x.title}",
        entity_id=x.entity_id,
        details={"note": x.decision_note},
    )
    db.commit()
    index_object(db, "control_exception", x.id)
    return exception_out(db, pr, x)


@router.post("/exceptions/{exception_id}/revoke")
def revoke_exception(
    exception_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    x = get_or_404(db, ControlException, exception_id, "Exception")
    pr.ensure("controls.manage", x.entity_id, write=True)
    if x.status != "approved":
        raise HTTPException(400, "Only approved exceptions can be revoked")
    x.status = "revoked"
    audit(db, pr, "revoke", "control_exception", x.id, f"{x.code} {x.title}", entity_id=x.entity_id)
    db.commit()
    index_object(db, "control_exception", x.id)
    return exception_out(db, pr, x)


@router.delete("/exceptions/{exception_id}", response_model=Ok)
def delete_exception(
    exception_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    x = get_or_404(db, ControlException, exception_id, "Exception")
    pr.ensure("controls.manage", x.entity_id, write=True)
    if x.status not in ("requested", "rejected"):
        raise HTTPException(400, "Approved exceptions are kept as a record; revoke them instead")
    audit(db, pr, "delete", "control_exception", x.id, f"{x.code} {x.title}", entity_id=x.entity_id)
    cleanup_target(db, "control_exception", x.id)
    db.delete(x)
    db.commit()
    remove_object(db, "control_exception", exception_id)
    return Ok()


# --- summary for dashboards ---------------------------------------------------------------------------------


@router.get("/summary")
def summary(pr: Principal = Depends(require("controls.read")), db: Session = Depends(get_db)):
    ref = today()
    scope = pr.entity_scope("controls.read")
    stmt = select(ControlOccurrence).where(
        ControlOccurrence.due_date >= add_months(ref, -3),
        ControlOccurrence.due_date <= ref + timedelta(days=30),
    )
    if scope is not None:
        stmt = stmt.where(ControlOccurrence.entity_id.in_(scope or {-1}))
    occ = list(db.scalars(stmt))
    overdue_all = select(func.count(ControlOccurrence.id)).where(
        ControlOccurrence.status == "planned", ControlOccurrence.due_date < ref
    )
    if scope is not None:
        overdue_all = overdue_all.where(ControlOccurrence.entity_id.in_(scope or {-1}))
    excs = [x for x in db.scalars(select(ControlException)) if pr.can_read("controls.read", x.entity_id)]
    return {
        "overdue": db.scalar(overdue_all) or 0,
        "due_next_30_days": sum(1 for o in occ if o.status == "planned" and ref <= o.due_date),
        "done_last_90_days": sum(1 for o in occ if o.status == "done" and o.due_date <= ref),
        "not_effective_last_90_days": sum(1 for o in occ if o.result == "not_effective"),
        "exceptions_pending": sum(1 for x in excs if x.status == "requested"),
        "exceptions_expiring_30_days": sum(
            1 for x in excs if exc_status(x, ref) == "approved" and (x.expires_at - ref).days <= 30
        ),
        "exceptions_expired": sum(1 for x in excs if exc_status(x, ref) == "expired"),
    }
