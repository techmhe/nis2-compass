"""Threat information log (advisories, Cbb Art. 17) and vulnerability tracking (IR 2024/2690 6.10).

Advisories and vulnerabilities reuse controls.read / controls.manage, scoped exactly like the controls module:
an advisory may apply to the whole group or a list of entities (like a ControlActivity), a vulnerability belongs
to one entity or the whole group (like an Asset)."""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

import app.features.threats.hooks  # noqa: F401  (registers targets, search sources, my-work and reminders)
from app.api.util import (
    can_access_target,
    cleanup_target,
    doc_links_for,
    entity_ref,
    get_or_404,
    next_code,
    user_names,
)
from app.core.deps import Principal, get_principal, principal_of, require
from app.db import get_db, utcnow
from app.features.controls.models import ControlException
from app.features.inventory.actions import create_task
from app.features.inventory.models import Asset
from app.features.suppliers.models import Supplier
from app.features.threats.models import (
    ASSESSMENT_DUE_DAYS,
    REMEDIATION_DUE_DAYS,
    Advisory,
    Vulnerability,
)
from app.models import Entity, Stakeholder
from app.schemas.common import Ok
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object, remove_object

router = APIRouter(prefix="/threats", tags=["threats"])


# --- helpers --------------------------------------------------------------------------------------------------


def default_assessment_due(received_on: date, severity: str) -> date:
    return received_on + timedelta(days=ASSESSMENT_DUE_DAYS[severity])


def default_remediation_due(discovered_on: date, severity: str) -> date:
    return discovered_on + timedelta(days=REMEDIATION_DUE_DAYS[severity])


def _can_read_advisory(pr: Principal, a: Advisory) -> bool:
    if a.entity_scope == "all":
        return pr.has_any("controls.read")
    return any(pr.can_read("controls.read", e) for e in a.entity_ids)


def _ensure_write_advisory(pr: Principal, a_entity_scope: str, entity_ids: list[int]) -> None:
    if a_entity_scope == "all":
        pr.ensure("controls.manage", None, write=True)
    elif not entity_ids or not all(pr.can_write("controls.manage", e) for e in entity_ids):
        raise HTTPException(403, "Missing permission: controls.manage for every entity in scope")


def _advisory_out(db: Session, pr: Principal, a: Advisory, names: dict[int, str] | None = None) -> dict:
    names = names if names is not None else user_names(db, [a.created_by_id, a.assessed_by_id])
    ents = {e.id: e for e in db.scalars(select(Entity))}
    ref = utcnow().date()
    return {
        "id": a.id,
        "code": a.code,
        "title": a.title,
        "source": a.source,
        "reference": a.reference,
        "received_on": a.received_on,
        "severity": a.severity,
        "summary": a.summary,
        "entity_scope": a.entity_scope,
        "entity_ids": a.entity_ids or [],
        "entities": [entity_ref(ents[i]) for i in (a.entity_ids or []) if i in ents],
        "created_by_id": a.created_by_id,
        "created_by_name": names.get(a.created_by_id),
        "asset_ids": [x.id for x in a.assets],
        "assets": [{"id": x.id, "code": x.code, "name": x.name} for x in a.assets],
        "supplier_ids": [x.id for x in a.suppliers],
        "suppliers": [{"id": x.id, "code": x.code, "name": x.name} for x in a.suppliers],
        "relevant": a.relevant,
        "measures_need_adjustment": a.measures_need_adjustment,
        "rationale": a.rationale,
        "assessed_by_id": a.assessed_by_id,
        "assessed_by_name": names.get(a.assessed_by_id),
        "assessed_on": a.assessed_on,
        "assessment_due": a.assessment_due,
        "status": a.status,
        "overdue": a.status in ("new", "in_assessment") and a.assessment_due < ref,
        "vulnerability_ids": a.vulnerability_ids or [],
        "task_ids": a.task_ids or [],
        "can_edit": _can_write_ok(pr, a.entity_scope, a.entity_ids),
        "created_at": a.created_at,
        "updated_at": a.updated_at,
    }


def _can_write_ok(pr: Principal, entity_scope: str, entity_ids: list[int]) -> bool:
    if entity_scope == "all":
        return pr.can_write("controls.manage", None)
    return bool(entity_ids) and all(pr.can_write("controls.manage", e) for e in entity_ids)


def _vuln_out(db: Session, pr: Principal, v: Vulnerability, names: dict[int, str] | None = None) -> dict:
    names = names if names is not None else user_names(db, [v.owner_user_id])
    st = db.get(Stakeholder, v.owner_stakeholder_id) if v.owner_stakeholder_id else None
    adv = db.get(Advisory, v.advisory_id) if v.advisory_id else None
    exc = db.get(ControlException, v.exception_id) if v.exception_id else None
    ref = utcnow().date()
    return {
        "id": v.id,
        "code": v.code,
        "title": v.title,
        "cve_ids": v.cve_ids or [],
        "advisory_id": v.advisory_id,
        "advisory": {"id": adv.id, "code": adv.code, "title": adv.title} if adv else None,
        "entity": entity_ref(v.entity),
        "entity_id": v.entity_id,
        "severity": v.severity,
        "cvss": v.cvss,
        "discovered_on": v.discovered_on,
        "remediation_due": v.remediation_due,
        "owner_user_id": v.owner_user_id,
        "owner_user_name": names.get(v.owner_user_id) if v.owner_user_id else None,
        "owner_stakeholder_id": v.owner_stakeholder_id,
        "owner_stakeholder_name": st.name if st else None,
        "status": v.status,
        "remediated_on": v.remediated_on,
        "exception_id": v.exception_id,
        "exception": {"id": exc.id, "code": exc.code, "title": exc.title} if exc else None,
        "acceptance_justification": v.acceptance_justification,
        "notes": v.notes,
        "asset_ids": [x.id for x in v.assets],
        "assets": [{"id": x.id, "code": x.code, "name": x.name} for x in v.assets],
        "task_ids": v.task_ids or [],
        "overdue": v.status in ("open", "in_progress") and v.remediation_due < ref,
        "can_edit": pr.can_write("controls.manage", v.entity_id),
        "created_at": v.created_at,
        "updated_at": v.updated_at,
    }


def _validate_visible(db: Session, pr: Principal, target_type: str, model, ids: list[int], what: str) -> None:
    """Linked objects must exist and be visible to the caller (no linking of other entities' objects)."""
    if ids and set(db.scalars(select(model.id).where(model.id.in_(ids)))) != set(ids):
        raise HTTPException(422, f"Unknown {what}")
    if any(not can_access_target(db, pr, target_type, i) for i in ids):
        raise HTTPException(422, f"Unknown {what}")


def _validate_assets(db: Session, pr: Principal, ids: list[int]) -> None:
    _validate_visible(db, pr, "asset", Asset, ids, "asset")


def _validate_suppliers(db: Session, pr: Principal, ids: list[int]) -> None:
    _validate_visible(db, pr, "supplier", Supplier, ids, "supplier")


def _set_assets(db: Session, obj, ids: list[int]) -> None:
    obj.assets = list(db.scalars(select(Asset).where(Asset.id.in_(ids)))) if ids else []


# --- advisories ------------------------------------------------------------------------------------------------


class AdvisoryIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    source: Literal["CERT-Bund", "NCSC-NL", "BSI", "vendor_psirt", "supplier", "other"] = "other"
    reference: str | None = Field(default=None, max_length=500)
    received_on: date
    severity: Literal["critical", "high", "medium", "low"] = "medium"
    summary: str | None = Field(default=None, max_length=10000)
    entity_scope: Literal["all", "list"] = "all"
    entity_ids: list[int] = Field(default_factory=list, max_length=50)
    asset_ids: list[int] = Field(default_factory=list, max_length=200)
    supplier_ids: list[int] = Field(default_factory=list, max_length=50)
    assessment_due: date | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.entity_scope == "list" and not self.entity_ids:
            raise ValueError("Choose at least one entity or apply the advisory group-wide")
        if self.entity_scope == "all":
            self.entity_ids = []
        self.entity_ids = list(dict.fromkeys(self.entity_ids))
        self.asset_ids = list(dict.fromkeys(self.asset_ids))
        self.supplier_ids = list(dict.fromkeys(self.supplier_ids))
        if self.assessment_due is None:
            self.assessment_due = default_assessment_due(self.received_on, self.severity)
        return self


def _validate_advisory_refs(db: Session, pr: Principal, body: AdvisoryIn) -> None:
    if body.entity_ids and set(db.scalars(select(Entity.id).where(Entity.id.in_(body.entity_ids)))) != set(
        body.entity_ids
    ):
        raise HTTPException(422, "Unknown entity")
    _validate_assets(db, pr, body.asset_ids)
    _validate_suppliers(db, pr, body.supplier_ids)


@router.get("/advisories")
def list_advisories(
    status: str | None = None,
    severity: str | None = None,
    entity_id: int | None = None,
    overdue: bool | None = None,
    pr: Principal = Depends(require("controls.read")),
    db: Session = Depends(get_db),
):
    rows = [
        a
        for a in db.scalars(select(Advisory).order_by(Advisory.received_on.desc()))
        if _can_read_advisory(pr, a)
    ]
    if status:
        rows = [a for a in rows if a.status == status]
    if severity:
        rows = [a for a in rows if a.severity == severity]
    if entity_id is not None:
        rows = [a for a in rows if a.entity_scope == "all" or entity_id in (a.entity_ids or [])]
    ref = utcnow().date()
    if overdue is not None:
        rows = [
            a for a in rows if (a.status in ("new", "in_assessment") and a.assessment_due < ref) == overdue
        ]
    names = user_names(db, [i for a in rows for i in (a.created_by_id, a.assessed_by_id)])
    return {
        "items": [_advisory_out(db, pr, a, names) for a in rows],
        "can_create": pr.has_any("controls.manage"),
    }


@router.get("/advisories/{advisory_id}")
def get_advisory(
    advisory_id: int, pr: Principal = Depends(require("controls.read")), db: Session = Depends(get_db)
):
    a = get_or_404(db, Advisory, advisory_id, "Advisory")
    if not _can_read_advisory(pr, a):
        raise HTTPException(404, "Advisory not found")
    out = _advisory_out(db, pr, a)
    out["documents"] = doc_links_for(db, pr, "advisory", a.id)
    return out


@router.post("/advisories")
def create_advisory(body: AdvisoryIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    _ensure_write_advisory(pr, body.entity_scope, body.entity_ids)
    _validate_advisory_refs(db, pr, body)
    data = body.model_dump(exclude={"asset_ids", "supplier_ids"})
    a = Advisory(
        code=next_code(db, Advisory.code, "ADV-", width=4), status="new", created_by_id=pr.id, **data
    )
    db.add(a)
    db.flush()
    _set_assets(db, a, body.asset_ids)
    a.suppliers = (
        list(db.scalars(select(Supplier).where(Supplier.id.in_(body.supplier_ids))))
        if body.supplier_ids
        else []
    )
    db.flush()
    audit(db, pr, "create", "advisory", a.id, f"{a.code} {a.title}")
    db.commit()
    index_object(db, "advisory", a.id)
    return _advisory_out(db, pr, a)


@router.put("/advisories/{advisory_id}")
def update_advisory(
    advisory_id: int, body: AdvisoryIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    a = get_or_404(db, Advisory, advisory_id, "Advisory")
    _ensure_write_advisory(pr, a.entity_scope, a.entity_ids)  # current scope
    _ensure_write_advisory(pr, body.entity_scope, body.entity_ids)  # new scope
    _validate_advisory_refs(db, pr, body)
    data = body.model_dump(exclude={"asset_ids", "supplier_ids"})
    diff = apply_changes(a, data)
    _set_assets(db, a, body.asset_ids)
    a.suppliers = (
        list(db.scalars(select(Supplier).where(Supplier.id.in_(body.supplier_ids))))
        if body.supplier_ids
        else []
    )
    audit(db, pr, "update", "advisory", a.id, f"{a.code} {a.title}", details=diff)
    db.commit()
    index_object(db, "advisory", a.id)
    return _advisory_out(db, pr, a)


@router.delete("/advisories/{advisory_id}", response_model=Ok)
def delete_advisory(advisory_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    a = get_or_404(db, Advisory, advisory_id, "Advisory")
    _ensure_write_advisory(pr, a.entity_scope, a.entity_ids)
    cleanup_target(db, "advisory", a.id)
    audit(db, pr, "delete", "advisory", a.id, f"{a.code} {a.title}")
    db.delete(a)
    db.commit()
    remove_object(db, "advisory", advisory_id)
    return Ok()


class AssessIn(BaseModel):
    status: Literal["in_assessment", "assessed", "closed"]
    relevant: Literal["yes", "no", "unclear"] | None = None
    measures_need_adjustment: Literal["yes", "no"] | None = None
    rationale: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def _check(self):
        if self.status in ("assessed", "closed") and not self.relevant:
            raise ValueError("Record whether the advisory is relevant before assessing it")
        if self.status == "closed":
            if not (self.rationale or "").strip():
                raise ValueError("A written rationale is required to close the assessment (Cbb Art. 17)")
            if not self.measures_need_adjustment:
                raise ValueError("Record whether measures need to be adjusted before closing")
        return self


@router.post("/advisories/{advisory_id}/assess")
def assess_advisory(
    advisory_id: int, body: AssessIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    a = get_or_404(db, Advisory, advisory_id, "Advisory")
    _ensure_write_advisory(pr, a.entity_scope, a.entity_ids)
    data = body.model_dump()
    if body.status in ("assessed", "closed"):
        data["assessed_by_id"] = pr.id
        data["assessed_on"] = utcnow().date()
    diff = apply_changes(a, data)
    audit(db, pr, "assess", "advisory", a.id, f"{a.code} {a.title}", details=diff)
    db.commit()
    index_object(db, "advisory", a.id)
    return _advisory_out(db, pr, a)


class VulnFromAdvisoryIn(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    entity_id: int | None = None
    severity: Literal["critical", "high", "medium", "low"] | None = None
    cve_ids: list[str] = Field(default_factory=list, max_length=20)
    discovered_on: date | None = None
    asset_ids: list[int] | None = None


@router.post("/advisories/{advisory_id}/vulnerability")
def create_vulnerability_from_advisory(
    advisory_id: int,
    body: VulnFromAdvisoryIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    a = get_or_404(db, Advisory, advisory_id, "Advisory")
    if not _can_read_advisory(pr, a):
        raise HTTPException(404, "Advisory not found")
    entity_id = body.entity_id if body.entity_id is not None else (a.entity_ids[0] if a.entity_ids else None)
    pr.ensure("controls.manage", entity_id, write=True)
    if entity_id is not None and not db.get(Entity, entity_id):
        raise HTTPException(422, "Unknown entity")
    severity = body.severity or a.severity
    discovered_on = body.discovered_on or utcnow().date()
    asset_ids = body.asset_ids if body.asset_ids is not None else [x.id for x in a.assets]
    _validate_assets(db, pr, asset_ids)
    v = Vulnerability(
        code=next_code(db, Vulnerability.code, "VUL-", width=4),
        title=body.title or f"{a.code}: {a.title}",
        cve_ids=body.cve_ids,
        advisory_id=a.id,
        entity_id=entity_id,
        severity=severity,
        discovered_on=discovered_on,
        remediation_due=default_remediation_due(discovered_on, severity),
        status="open",
    )
    db.add(v)
    db.flush()
    _set_assets(db, v, asset_ids)
    a.vulnerability_ids = [*(a.vulnerability_ids or []), v.id]
    audit(
        db,
        pr,
        "create",
        "vulnerability",
        v.id,
        f"{v.code} {v.title}",
        entity_id=entity_id,
        details={"source": f"advisory {a.code}"},
    )
    db.commit()
    index_object(db, "vulnerability", v.id)
    return _vuln_out(db, pr, v)


class TaskFromIn(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=10000)
    assignee_id: int | None = None
    due_date: date | None = None
    priority: Literal["Low", "Medium", "High"] = "Medium"


@router.post("/advisories/{advisory_id}/task")
def create_task_from_advisory(
    advisory_id: int, body: TaskFromIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    a = get_or_404(db, Advisory, advisory_id, "Advisory")
    if not _can_read_advisory(pr, a):
        raise HTTPException(404, "Advisory not found")
    if not _can_write_ok(pr, a.entity_scope, a.entity_ids):
        raise HTTPException(403, "Missing permission: controls.manage")
    entity_id = a.entity_ids[0] if a.entity_scope == "list" and a.entity_ids else None
    t = create_task(
        db,
        pr,
        entity_id=entity_id,
        title=body.title or f"Assess advisory {a.code}: {a.title}",
        description=body.description,
        assignee_id=body.assignee_id,
        due_date=body.due_date,
        priority=body.priority,
    )
    a.task_ids = [*(a.task_ids or []), t.id]
    db.commit()
    index_object(db, "task", t.id)
    return {"id": t.id, "key": t.key, "title": t.title}


# --- vulnerabilities -------------------------------------------------------------------------------------------


class VulnerabilityIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    cve_ids: list[str] = Field(default_factory=list, max_length=20)
    advisory_id: int | None = None
    entity_id: int | None = None
    severity: Literal["critical", "high", "medium", "low"] = "medium"
    cvss: float | None = Field(default=None, ge=0, le=10)
    discovered_on: date
    remediation_due: date | None = None
    owner_user_id: int | None = None
    owner_stakeholder_id: int | None = None
    status: Literal["open", "in_progress", "mitigated", "remediated", "accepted"] = "open"
    remediated_on: date | None = None
    exception_id: int | None = None
    acceptance_justification: str | None = Field(default=None, max_length=10000)
    notes: str | None = Field(default=None, max_length=10000)
    asset_ids: list[int] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def _check(self):
        if self.remediation_due is None:
            self.remediation_due = default_remediation_due(self.discovered_on, self.severity)
        if self.status == "accepted" and not (
            self.exception_id or (self.acceptance_justification or "").strip()
        ):
            raise ValueError("Accepting a vulnerability needs a linked exception or a written justification")
        self.asset_ids = list(dict.fromkeys(self.asset_ids))
        self.cve_ids = [c.strip().upper() for c in self.cve_ids if c.strip()]
        return self


def _validate_vuln_refs(db: Session, pr: Principal, body: VulnerabilityIn) -> None:
    if body.entity_id is not None and not db.get(Entity, body.entity_id):
        raise HTTPException(422, "Unknown entity")
    if body.advisory_id is not None:
        adv = db.get(Advisory, body.advisory_id)
        if not adv or not _can_read_advisory(pr, adv):
            raise HTTPException(422, "Unknown advisory")
    if body.owner_stakeholder_id and not db.get(Stakeholder, body.owner_stakeholder_id):
        raise HTTPException(422, "Unknown stakeholder")
    if body.owner_user_id:
        owner = principal_of(db, body.owner_user_id)
        if owner is None or not owner.has_any("controls.read"):
            raise HTTPException(422, "The owner must be an active user with read access to controls")
    if body.exception_id:
        x = db.get(ControlException, body.exception_id)
        if not x or x.entity_id != body.entity_id or not pr.can_read("controls.read", x.entity_id):
            raise HTTPException(422, "Unknown exception, or it belongs to another entity")
    _validate_assets(db, pr, body.asset_ids)


@router.get("/vulnerabilities")
def list_vulnerabilities(
    status: str | None = None,
    severity: str | None = None,
    entity_id: int | None = None,
    overdue: bool | None = None,
    pr: Principal = Depends(require("controls.read")),
    db: Session = Depends(get_db),
):
    scope = pr.entity_scope("controls.read")
    stmt = select(Vulnerability).order_by(Vulnerability.remediation_due)
    if scope is not None:
        stmt = stmt.where(Vulnerability.entity_id.in_(scope or {-1}))
    if entity_id is not None:
        stmt = stmt.where(Vulnerability.entity_id == entity_id)
    if status:
        stmt = stmt.where(Vulnerability.status == status)
    if severity:
        stmt = stmt.where(Vulnerability.severity == severity)
    rows = list(db.scalars(stmt))
    ref = utcnow().date()
    if overdue is not None:
        rows = [
            v for v in rows if (v.status in ("open", "in_progress") and v.remediation_due < ref) == overdue
        ]
    names = user_names(db, [v.owner_user_id for v in rows])
    return {"items": [_vuln_out(db, pr, v, names) for v in rows], "can_create": pr.has_any("controls.manage")}


@router.get("/vulnerabilities/{vulnerability_id}")
def get_vulnerability(
    vulnerability_id: int, pr: Principal = Depends(require("controls.read")), db: Session = Depends(get_db)
):
    v = get_or_404(db, Vulnerability, vulnerability_id, "Vulnerability")
    pr.ensure("controls.read", v.entity_id)
    out = _vuln_out(db, pr, v)
    out["documents"] = doc_links_for(db, pr, "vulnerability", v.id)
    return out


def _apply_remediated(v: Vulnerability, data: dict) -> None:
    """remediated_on is auto-set when the status moves to remediated/mitigated, unless given explicitly."""
    if (
        data.get("status") in ("remediated", "mitigated")
        and data.get("remediated_on") is None
        and v.remediated_on is None
    ):
        data["remediated_on"] = utcnow().date()


@router.post("/vulnerabilities")
def create_vulnerability(
    body: VulnerabilityIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    pr.ensure("controls.manage", body.entity_id, write=True)
    _validate_vuln_refs(db, pr, body)
    data = body.model_dump(exclude={"asset_ids"})
    v = Vulnerability(code=next_code(db, Vulnerability.code, "VUL-", width=4), **data)
    _apply_remediated(v, data)
    if data.get("remediated_on") is not None:
        v.remediated_on = data["remediated_on"]
    db.add(v)
    db.flush()
    _set_assets(db, v, body.asset_ids)
    audit(db, pr, "create", "vulnerability", v.id, f"{v.code} {v.title}", entity_id=v.entity_id)
    db.commit()
    index_object(db, "vulnerability", v.id)
    return _vuln_out(db, pr, v)


@router.put("/vulnerabilities/{vulnerability_id}")
def update_vulnerability(
    vulnerability_id: int,
    body: VulnerabilityIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    v = get_or_404(db, Vulnerability, vulnerability_id, "Vulnerability")
    pr.ensure("controls.manage", v.entity_id, write=True)
    pr.ensure("controls.manage", body.entity_id, write=True)
    _validate_vuln_refs(db, pr, body)
    data = body.model_dump(exclude={"asset_ids"})
    _apply_remediated(v, data)
    diff = apply_changes(v, data)
    _set_assets(db, v, body.asset_ids)
    audit(db, pr, "update", "vulnerability", v.id, f"{v.code} {v.title}", entity_id=v.entity_id, details=diff)
    db.commit()
    index_object(db, "vulnerability", v.id)
    return _vuln_out(db, pr, v)


@router.delete("/vulnerabilities/{vulnerability_id}", response_model=Ok)
def delete_vulnerability(
    vulnerability_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    v = get_or_404(db, Vulnerability, vulnerability_id, "Vulnerability")
    pr.ensure("controls.manage", v.entity_id, write=True)
    cleanup_target(db, "vulnerability", v.id)
    audit(db, pr, "delete", "vulnerability", v.id, f"{v.code} {v.title}", entity_id=v.entity_id)
    db.delete(v)
    db.commit()
    remove_object(db, "vulnerability", vulnerability_id)
    return Ok()


@router.post("/vulnerabilities/{vulnerability_id}/task")
def create_task_from_vulnerability(
    vulnerability_id: int,
    body: TaskFromIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    v = get_or_404(db, Vulnerability, vulnerability_id, "Vulnerability")
    pr.ensure("controls.read", v.entity_id)
    pr.ensure("controls.manage", v.entity_id, write=True)
    t = create_task(
        db,
        pr,
        entity_id=v.entity_id,
        title=body.title or f"Remediate {v.code}: {v.title}",
        description=body.description,
        assignee_id=body.assignee_id,
        due_date=body.due_date,
        priority=body.priority,
    )
    v.task_ids = [*(v.task_ids or []), t.id]
    db.commit()
    index_object(db, "task", t.id)
    return {"id": t.id, "key": t.key, "title": t.title}


# --- summary for dashboards --------------------------------------------------------------------------------------


@router.get("/summary")
def summary(pr: Principal = Depends(require("controls.read")), db: Session = Depends(get_db)):
    ref = utcnow().date()
    advisories = [a for a in db.scalars(select(Advisory)) if _can_read_advisory(pr, a)]
    scope = pr.entity_scope("controls.read")
    vstmt = select(Vulnerability)
    if scope is not None:
        vstmt = vstmt.where(Vulnerability.entity_id.in_(scope or {-1}))
    vulns = list(db.scalars(vstmt))
    return {
        "advisories_awaiting_assessment": sum(1 for a in advisories if a.status in ("new", "in_assessment")),
        "advisories_overdue": sum(
            1 for a in advisories if a.status in ("new", "in_assessment") and a.assessment_due < ref
        ),
        "vulnerabilities_open": sum(1 for v in vulns if v.status in ("open", "in_progress")),
        "vulnerabilities_overdue": sum(
            1 for v in vulns if v.status in ("open", "in_progress") and v.remediation_due < ref
        ),
        "critical_open": sum(
            1 for v in vulns if v.severity == "critical" and v.status in ("open", "in_progress")
        ),
    }
