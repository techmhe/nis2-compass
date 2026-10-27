"""Audit programme, audits and findings, incl. the "create action plan item" bridge from a finding."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import cleanup_target, doc_links_for, entity_ref, get_or_404, next_code
from app.core.deps import Principal, get_principal, require
from app.db import get_db
from app.features.audits.logic import next_finding_number
from app.features.audits.models import Audit, AuditFinding, AuditProgramme
from app.features.audits.validation import BoundedDate, merge_update, partial_model
from app.features.inventory.actions import create_action_item
from app.models import ActionItem, Entity, Requirement, User
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object, remove_object

router = APIRouter()


def _uname(db: Session, uid: int | None) -> str | None:
    u = db.get(User, uid) if uid else None
    return u.display_name if u else None


def _req(r: Requirement | None) -> dict | None:
    return {"id": r.id, "number": r.number, "section": r.section} if r else None


# --------------------------------------------------------------------------- programmes


def programme_out(p: AuditProgramme, pr: Principal) -> dict:
    return {
        "id": p.id,
        "year": p.year,
        "title": p.title,
        "scope": p.scope,
        "approved_by": p.approved_by,
        "approved_on": p.approved_on,
        "can_edit": pr.can_write("audits.manage", None),
    }


class ProgrammeIn(BaseModel):
    year: int = Field(ge=2020, le=2100)
    title: str = Field(min_length=1, max_length=300)
    scope: str | None = Field(default=None, max_length=20000)
    approved_by: str | None = Field(default=None, max_length=200)
    approved_on: BoundedDate | None = None


ProgrammePatch = partial_model(ProgrammeIn, "ProgrammePatch")


@router.get("/programmes")
def list_programmes(pr: Principal = Depends(require("audits.read")), db: Session = Depends(get_db)):
    return [
        programme_out(p, pr) for p in db.scalars(select(AuditProgramme).order_by(AuditProgramme.year.desc()))
    ]


@router.post("/programmes")
def create_programme(
    body: ProgrammeIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    pr.ensure("audits.manage", None, write=True)
    if db.scalar(select(AuditProgramme.id).where(AuditProgramme.year == body.year)):
        raise HTTPException(409, f"An audit programme for {body.year} already exists")
    p = AuditProgramme(created_by_id=pr.id, **body.model_dump())
    db.add(p)
    db.flush()
    audit(db, pr, "create", "audit_programme", p.id, p.title)
    db.commit()
    return programme_out(p, pr)


@router.put("/programmes/{programme_id}")
@router.patch("/programmes/{programme_id}")
def update_programme(
    programme_id: int,
    body: ProgrammePatch,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    p = get_or_404(db, AuditProgramme, programme_id, "Audit programme")
    pr.ensure("audits.manage", None, write=True)
    merged = merge_update(p, body, ProgrammeIn)
    if merged.year != p.year and db.scalar(
        select(AuditProgramme.id).where(AuditProgramme.year == merged.year, AuditProgramme.id != p.id)
    ):
        raise HTTPException(409, f"An audit programme for {merged.year} already exists")
    diff = apply_changes(p, merged.model_dump())
    audit(db, pr, "update", "audit_programme", p.id, p.title, details=diff)
    db.commit()
    db.refresh(p)
    return programme_out(p, pr)


@router.delete("/programmes/{programme_id}")
def delete_programme(
    programme_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    p = get_or_404(db, AuditProgramme, programme_id, "Audit programme")
    pr.ensure("audits.manage", None, write=True)
    if db.scalar(select(Audit.id).where(Audit.programme_id == p.id)):
        raise HTTPException(400, "This programme still has audits linked to it")
    audit(db, pr, "delete", "audit_programme", p.id, p.title)
    db.delete(p)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- audits


def audit_out(db: Session, a: Audit, pr: Principal, detail: bool = False) -> dict:
    open_findings = (
        db.scalar(
            select(AuditFinding.id)
            .where(AuditFinding.audit_id == a.id, AuditFinding.status != "closed")
            .limit(1)
        )
        is not None
    )
    out = {
        "id": a.id,
        "code": a.code,
        "programme_id": a.programme_id,
        "programme_title": a.programme.title if a.programme else None,
        "type": a.type,
        "entity": entity_ref(a.entity),
        "entity_id": a.entity_id,
        "scope": a.scope,
        "requirement_chapter": a.requirement_chapter,
        "lead_auditor_id": a.lead_auditor_id,
        "lead_auditor_name": _uname(db, a.lead_auditor_id),
        "auditors": a.auditors,
        "planned_start": a.planned_start,
        "planned_end": a.planned_end,
        "actual_start": a.actual_start,
        "actual_end": a.actual_end,
        "status": a.status,
        "summary": a.summary,
        "conclusion": a.conclusion,
        "has_open_findings": open_findings,
        "created_at": a.created_at,
        "can_edit": pr.can_write("audits.manage", a.entity_id),
    }
    if detail:
        findings = list(
            db.scalars(select(AuditFinding).where(AuditFinding.audit_id == a.id).order_by(AuditFinding.id))
        )
        out["findings"] = [finding_out(db, f, pr) for f in findings]
        out["documents"] = doc_links_for(db, pr, "audit", a.id)
    return out


class AuditIn(BaseModel):
    programme_id: int | None = None
    type: Literal["internal", "external", "certification", "supplier", "authority"]
    entity_id: int | None = None
    scope: str = Field(min_length=1, max_length=10000)
    requirement_chapter: str | None = Field(default=None, max_length=200)
    lead_auditor_id: int | None = None
    auditors: str | None = Field(default=None, max_length=400)
    planned_start: BoundedDate
    planned_end: BoundedDate
    actual_start: BoundedDate | None = None
    actual_end: BoundedDate | None = None
    status: Literal["planned", "in_progress", "reported", "closed"] = "planned"
    summary: str | None = Field(default=None, max_length=20000)
    conclusion: str | None = Field(default=None, max_length=20000)

    @model_validator(mode="after")
    def _dates(self):
        if self.planned_end < self.planned_start:
            raise ValueError("The planned end date cannot be before the planned start date")
        if self.actual_start and self.actual_end and self.actual_end < self.actual_start:
            raise ValueError("The actual end date cannot be before the actual start date")
        return self


AuditPatch = partial_model(AuditIn, "AuditPatch")


def _check_audit_refs(db: Session, body: AuditIn) -> None:
    if body.programme_id and not db.get(AuditProgramme, body.programme_id):
        raise HTTPException(422, "Unknown audit programme")
    if body.entity_id is not None:
        get_or_404(db, Entity, body.entity_id, "Entity")
    if body.lead_auditor_id is not None:
        u = db.get(User, body.lead_auditor_id)
        if not u or not u.is_active:
            raise HTTPException(422, "The lead auditor must be an active user")


@router.get("/audits")
def list_audits(
    entity_id: int | None = None,
    status: str | None = None,
    pr: Principal = Depends(require("audits.read")),
    db: Session = Depends(get_db),
):
    stmt = select(Audit).order_by(Audit.planned_start.desc(), Audit.id.desc())
    if entity_id:
        stmt = stmt.where(Audit.entity_id == entity_id)
    if status:
        stmt = stmt.where(Audit.status == status)
    return [audit_out(db, a, pr) for a in db.scalars(stmt) if pr.can_read("audits.read", a.entity_id)]


@router.get("/audits/{audit_id}")
def get_audit(audit_id: int, pr: Principal = Depends(require("audits.read")), db: Session = Depends(get_db)):
    a = get_or_404(db, Audit, audit_id, "Audit")
    pr.ensure("audits.read", a.entity_id)
    return audit_out(db, a, pr, detail=True)


def _next_audit_code(db: Session, planned_start: date) -> str:
    return next_code(db, Audit.code, f"AUD-{planned_start.year}-", width=2)


@router.post("/audits")
def create_audit(body: AuditIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr.ensure("audits.manage", body.entity_id, write=True)
    _check_audit_refs(db, body)
    a = Audit(code=_next_audit_code(db, body.planned_start), created_by_id=pr.id, **body.model_dump())
    db.add(a)
    db.flush()
    audit(db, pr, "create", "audit", a.id, f"{a.code} {a.scope}"[:400], entity_id=a.entity_id)
    db.commit()
    index_object(db, "audit", a.id)
    return audit_out(db, a, pr, detail=True)


@router.put("/audits/{audit_id}")
@router.patch("/audits/{audit_id}")
def update_audit(
    audit_id: int, body: AuditPatch, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    a = get_or_404(db, Audit, audit_id, "Audit")
    pr.ensure("audits.manage", a.entity_id, write=True)
    merged = merge_update(a, body, AuditIn)
    pr.ensure("audits.manage", merged.entity_id, write=True)
    _check_audit_refs(db, merged)
    diff = apply_changes(a, merged.model_dump())
    audit(db, pr, "update", "audit", a.id, a.code, entity_id=a.entity_id, details=diff)
    db.commit()
    db.refresh(a)
    index_object(db, "audit", a.id)
    return audit_out(db, a, pr, detail=True)


@router.delete("/audits/{audit_id}")
def delete_audit(audit_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    a = get_or_404(db, Audit, audit_id, "Audit")
    pr.ensure("audits.manage", a.entity_id, write=True)
    audit(db, pr, "delete", "audit", a.id, a.code, entity_id=a.entity_id)
    for f in db.scalars(select(AuditFinding).where(AuditFinding.audit_id == a.id)):
        cleanup_target(db, "audit_finding", f.id)
        db.delete(f)
    cleanup_target(db, "audit", a.id)
    db.delete(a)
    db.commit()
    remove_object(db, "audit", audit_id)
    return {"ok": True}


# --------------------------------------------------------------------------- findings


def finding_out(db: Session, f: AuditFinding, pr: Principal) -> dict:
    eff_entity_id = f.entity_id if f.entity_id is not None else f.audit.entity_id
    eff_entity = db.get(Entity, eff_entity_id) if eff_entity_id is not None else None
    return {
        "id": f.id,
        "audit_id": f.audit_id,
        "audit_code": f.audit.code,
        "number": f.number,
        "type": f.type,
        "description": f.description,
        "requirement_id": f.requirement_id,
        "requirement": _req(db.get(Requirement, f.requirement_id) if f.requirement_id else None),
        "entity": entity_ref(eff_entity),
        "entity_id": f.entity_id,
        "status": f.status,
        "due_date": f.due_date,
        "action_item_id": f.action_item_id,
        "closure_note": f.closure_note,
        "closed_at": f.closed_at,
        "closed_by": _uname(db, f.closed_by_id),
        "can_edit": pr.can_write("audits.manage", eff_entity_id),
    }


class FindingIn(BaseModel):
    type: Literal["major_nonconformity", "minor_nonconformity", "observation", "opportunity"]
    description: str = Field(min_length=1, max_length=10000)
    requirement_id: int | None = None
    entity_id: int | None = None
    due_date: BoundedDate | None = None


FindingPatch = partial_model(FindingIn, "FindingPatch")


def _finding_entity(a: Audit, entity_id: int | None) -> int | None:
    return entity_id if entity_id is not None else a.entity_id


@router.get("/audits/{audit_id}/findings")
def list_findings(
    audit_id: int, pr: Principal = Depends(require("audits.read")), db: Session = Depends(get_db)
):
    a = get_or_404(db, Audit, audit_id, "Audit")
    pr.ensure("audits.read", a.entity_id)
    rows = db.scalars(select(AuditFinding).where(AuditFinding.audit_id == a.id).order_by(AuditFinding.id))
    return [finding_out(db, f, pr) for f in rows]


@router.get("/findings")
def list_all_findings(
    entity_id: int | None = None,
    status: str | None = None,
    pr: Principal = Depends(require("audits.read")),
    db: Session = Depends(get_db),
):
    stmt = select(AuditFinding).join(Audit).order_by(AuditFinding.due_date.is_(None), AuditFinding.due_date)
    if status:
        stmt = stmt.where(AuditFinding.status == status)
    out = []
    for f in db.scalars(stmt):
        ent = _finding_entity(f.audit, f.entity_id)
        if entity_id is not None and ent != entity_id:
            continue
        if not pr.can_read("audits.read", ent):
            continue
        out.append(finding_out(db, f, pr))
    return out


@router.post("/audits/{audit_id}/findings")
def create_finding(
    audit_id: int, body: FindingIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    a = get_or_404(db, Audit, audit_id, "Audit")
    ent = _finding_entity(a, body.entity_id)
    pr.ensure("audits.manage", ent, write=True)
    if body.requirement_id is not None:
        get_or_404(db, Requirement, body.requirement_id, "Requirement")
    if body.entity_id is not None:
        get_or_404(db, Entity, body.entity_id, "Entity")
    f = AuditFinding(audit_id=a.id, number=next_finding_number(db, a.id), status="open", **body.model_dump())
    db.add(f)
    db.flush()
    audit(db, pr, "create", "audit_finding", f.id, f"{a.code} {f.number}", entity_id=ent)
    db.commit()
    index_object(db, "audit_finding", f.id)
    return finding_out(db, f, pr)


@router.put("/findings/{finding_id}")
@router.patch("/findings/{finding_id}")
def update_finding(
    finding_id: int, body: FindingPatch, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    f = get_or_404(db, AuditFinding, finding_id, "Finding")
    ent = _finding_entity(f.audit, f.entity_id)
    pr.ensure("audits.manage", ent, write=True)
    merged = merge_update(f, body, FindingIn)
    new_ent = _finding_entity(f.audit, merged.entity_id)
    pr.ensure("audits.manage", new_ent, write=True)
    if merged.requirement_id is not None:
        get_or_404(db, Requirement, merged.requirement_id, "Requirement")
    if merged.entity_id is not None:
        get_or_404(db, Entity, merged.entity_id, "Entity")
    diff = apply_changes(f, merged.model_dump())
    audit(
        db, pr, "update", "audit_finding", f.id, f"{f.audit.code} {f.number}", entity_id=new_ent, details=diff
    )
    db.commit()
    db.refresh(f)
    index_object(db, "audit_finding", f.id)
    return finding_out(db, f, pr)


@router.delete("/findings/{finding_id}")
def delete_finding(finding_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    f = get_or_404(db, AuditFinding, finding_id, "Finding")
    ent = _finding_entity(f.audit, f.entity_id)
    pr.ensure("audits.manage", ent, write=True)
    audit(db, pr, "delete", "audit_finding", f.id, f"{f.audit.code} {f.number}", entity_id=ent)
    cleanup_target(db, "audit_finding", f.id)
    db.delete(f)
    db.commit()
    remove_object(db, "audit_finding", finding_id)
    return {"ok": True}


class ActionFromFindingIn(BaseModel):
    title: str | None = Field(default=None, max_length=4000)
    requirement_id: int | None = None  # required if the finding has none of its own
    priority: Literal["High", "Medium", "Low"] = "Medium"
    target_date: date | None = None
    responsible_id: int | None = None


@router.post("/findings/{finding_id}/create-action-item")
def create_action_item_from_finding(
    finding_id: int,
    body: ActionFromFindingIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    """Pre-fill an ActionItem from an audit finding (app.features.inventory.actions.create_action_item does the
    numbering, permission check, audit log and notification, matching app.api.findings and the controls module)."""
    f = get_or_404(db, AuditFinding, finding_id, "Finding")
    ent = _finding_entity(f.audit, f.entity_id)
    pr.ensure("audits.manage", ent, write=True)
    if f.action_item_id:
        raise HTTPException(409, "An action plan item was already created from this finding")
    req_id = f.requirement_id or body.requirement_id
    if not req_id:
        raise HTTPException(422, "Choose the requirement the action plan item should be linked to")
    req = get_or_404(db, Requirement, req_id, "Requirement")
    if ent is None:
        raise HTTPException(422, "The finding needs an entity before an action plan item can be created")
    item = create_action_item(
        db,
        pr,
        entity_id=ent,
        requirement_number=req.number,
        title=(body.title or "").strip()
        or f"Close audit finding {f.audit.code} {f.number}: {f.description[:200]}",
        priority=body.priority,
        target_date=body.target_date or f.due_date,
        responsible_id=body.responsible_id,
        comments=f"Created from audit finding {f.audit.code} {f.number} ({f.type.replace('_', ' ')}).",
    )
    f.action_item_id = item.id
    f.status = "action_planned"
    audit(
        db,
        pr,
        "update",
        "audit_finding",
        f.id,
        f"{f.audit.code} {f.number}",
        entity_id=ent,
        details={"action_item": [None, item.code]},
    )
    db.commit()
    index_object(db, "action_item", item.id)
    return finding_out(db, f, pr)


class CloseFindingIn(BaseModel):
    closure_note: str | None = Field(default=None, max_length=10000)


@router.post("/findings/{finding_id}/close")
def close_finding(
    finding_id: int,
    body: CloseFindingIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    f = get_or_404(db, AuditFinding, finding_id, "Finding")
    ent = _finding_entity(f.audit, f.entity_id)
    pr.ensure("audits.manage", ent, write=True)
    action = db.get(ActionItem, f.action_item_id) if f.action_item_id else None
    note = (body.closure_note or "").strip() or None
    if not (action and action.status == "Completed") and not note:
        raise HTTPException(
            422, "Closing requires either a completed linked action plan item or a closure note"
        )
    f.status = "closed"
    f.closed_at = date.today()
    f.closed_by_id = pr.id
    f.closure_note = note
    audit(db, pr, "close", "audit_finding", f.id, f"{f.audit.code} {f.number}", entity_id=ent)
    db.commit()
    return finding_out(db, f, pr)


@router.post("/findings/{finding_id}/reopen")
def reopen_finding(finding_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    f = get_or_404(db, AuditFinding, finding_id, "Finding")
    ent = _finding_entity(f.audit, f.entity_id)
    pr.ensure("audits.manage", ent, write=True)
    f.status = "action_planned" if f.action_item_id else "open"
    f.closed_at = None
    f.closed_by_id = None
    audit(db, pr, "reopen", "audit_finding", f.id, f"{f.audit.code} {f.number}", entity_id=ent)
    db.commit()
    return finding_out(db, f, pr)
