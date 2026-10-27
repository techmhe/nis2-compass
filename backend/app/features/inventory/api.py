"""Services, assets and dependencies (IR 12.4), business impact analysis (IR 4.1.3), continuity plans and the
exercise / restore-test log (IR 4.1.4, 4.2.6, 4.3.4).

All objects carry an entity_id (NULL = group-level) and follow the entity-scoped RBAC: assets.read to view,
assets.manage (for that entity, or group-wide for group objects) to change."""

import asyncio
import json
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select
from sqlalchemy.orm import Session, selectinload

import app.features.inventory.hooks  # noqa: F401  (registers search sources and comment targets)
from app.api.util import cleanup_target, doc_links_for, get_or_404, next_code
from app.config import get_settings
from app.core.deps import Principal, get_principal, require
from app.db import SessionLocal, get_db, utcnow
from app.features.inventory.actions import create_action_item, create_task, reindex_after
from app.features.inventory.logic import (
    ASSET_TYPES,
    BIA_STATUS,
    CIA_LEVELS,
    CRITICALITY,
    DIMENSIONS,
    EXERCISE_TYPES,
    IMPACT_LEVELS,
    LIFECYCLE,
    MTPD_THRESHOLD,
    PLAN_STATUS,
    PLAN_TYPES,
    RESULTS,
    SERVICE_KINDS,
    SERVICE_STATUS,
    SUCCESS,
    WINDOWS,
    add_months,
    clean_impacts,
    consistency_flags,
    item_values,
    restore_coverage,
)
from app.features.inventory.models import (
    Asset,
    Bia,
    BiaItem,
    ContinuityPlan,
    Exercise,
    Service,
    exercise_assets,
    exercise_services,
    plan_services,
    service_assets,
    service_suppliers,
)
from app.features.inventory.transfer import FIELDS, export_workbook, read_table, run_import, suggest_mapping
from app.features.suppliers.api import visible_supplier_ids
from app.features.suppliers.logic import dependency_map, effective_tier
from app.features.suppliers.models import Supplier
from app.models import AuditEvent, Entity, Stakeholder, User
from app.schemas.common import EntityBrief, Ok
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object, reindex_all, remove_object
from app.services.notify import notify

router = APIRouter(prefix="/inventory", tags=["inventory"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
READ, MANAGE = "assets.read", "assets.manage"
DEFAULT_REQUIREMENT = {
    "restore_test": "4.2.6",
    "failover": "4.2.4",
    "tabletop": "4.1.4",
    "crisis_drill": "4.3.4",
}

AssetType = Literal["IT", "OT", "cloud", "data", "facility", "network"]
Lifecycle = Literal["planned", "in_operation", "end_of_life", "retired"]


# --- helpers ---------------------------------------------------------------------------------------------


class Ctx:
    """Lookup tables used to render many objects at once."""

    def __init__(self, db: Session, pr: Principal):
        self.entities = {e.id: e for e in db.scalars(select(Entity))}
        self.stakeholders = {s.id: s for s in db.scalars(select(Stakeholder))}
        self.suppliers = {s.id: s for s in db.scalars(select(Supplier))}
        self.visible_suppliers = visible_supplier_ids(db, pr)

    def entity(self, eid: int | None) -> dict | None:
        e = self.entities.get(eid) if eid else None
        return EntityBrief.model_validate(e).model_dump() if e else None

    def owner(self, sid: int | None) -> dict | None:
        s = self.stakeholders.get(sid) if sid else None
        return {"id": s.id, "name": s.name} if s else None

    def supplier(self, sid: int | None) -> dict | None:
        s = self.suppliers.get(sid) if sid else None
        if not s:
            return None
        if s.id not in self.visible_suppliers:
            return {"id": s.id, "hidden": True}
        return {"id": s.id, "code": s.code, "name": s.name, "status": s.status, "access_type": s.access_type}


def _pairs(db: Session, table, a: str, b: str) -> dict[int, list[int]]:
    out: dict[int, list[int]] = {}
    for x, y in db.execute(select(table.c[a], table.c[b])):
        out.setdefault(x, []).append(y)
    return out


def _ensure_entity(db: Session, entity_id: int | None) -> None:
    if entity_id is not None and not db.get(Entity, entity_id):
        raise HTTPException(400, "Entity not found")


def _check_owner(db: Session, owner_id: int | None) -> None:
    if owner_id is not None and not db.get(Stakeholder, owner_id):
        raise HTTPException(400, "Owner not found")


def _history(db: Session, target_type: str, target_id: int) -> list[dict]:
    rows = db.scalars(
        select(AuditEvent)
        .where(AuditEvent.target_type == target_type, AuditEvent.target_id == target_id)
        .order_by(AuditEvent.at.desc())
        .limit(100)
    )
    return [{"at": r.at, "actor": r.actor_label, "action": r.action, "details": r.details} for r in rows]


def _visible(pr: Principal, rows: list, entity_id: int | None = None) -> list:
    return [
        r
        for r in rows
        if pr.can_read(READ, r.entity_id)
        and (entity_id is None or r.entity_id == entity_id or (entity_id == 0 and r.entity_id is None))
    ]


# --- meta ------------------------------------------------------------------------------------------------


@router.get("/meta")
def meta(pr: Principal = Depends(require(READ))):
    return {
        "asset_types": ASSET_TYPES,
        "lifecycle": LIFECYCLE,
        "service_status": SERVICE_STATUS,
        "service_kinds": SERVICE_KINDS,
        "criticality": CRITICALITY,
        "cia_levels": CIA_LEVELS,
        "plan_types": PLAN_TYPES,
        "plan_status": PLAN_STATUS,
        "exercise_types": EXERCISE_TYPES,
        "results": RESULTS,
        "bia_status": BIA_STATUS,
        "dimensions": DIMENSIONS,
        "windows": [{"key": k, "label": lab, "hours": h} for k, lab, h in WINDOWS],
        "impact_levels": IMPACT_LEVELS,
        "mtpd_threshold": MTPD_THRESHOLD,
        "default_requirement": DEFAULT_REQUIREMENT,
        "import_fields": {
            kind: [{"field": f, "label": lab, "required": req} for f, (lab, _s, req) in fs.items()]
            for kind, fs in FIELDS.items()
        },
    }


# --- services --------------------------------------------------------------------------------------------


class ServiceIn(BaseModel):
    entity_id: int | None = None
    name: str = Field(min_length=1, max_length=300)
    description: str | None = None
    kind: Literal["service", "process"] = "service"
    criticality: int = Field(default=2, ge=1, le=4)
    nis2_relevant: bool = True
    owner_id: int | None = None
    rto_hours: float | None = Field(default=None, ge=0, le=100000)
    rpo_hours: float | None = Field(default=None, ge=0, le=100000)
    status: Literal["active", "planned", "retired"] = "active"
    tags: list[str] = Field(default_factory=list, max_length=20)
    notes: str | None = None


class ServiceDepsIn(BaseModel):
    asset_ids: list[int] = Field(default_factory=list, max_length=500)
    supplier_ids: list[int] = Field(default_factory=list, max_length=200)


def _bia_state(db: Session, pr: Principal) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for item, bia in db.execute(select(BiaItem, Bia).join(Bia).where(BiaItem.service_id.is_not(None))):
        if not pr.can_read(READ, bia.entity_id):
            continue
        cur = out.get(item.service_id)
        rank = 2 if bia.status == "approved" else 1
        if not cur or rank > cur["rank"] or (rank == cur["rank"] and bia.period > cur["period"]):
            v = item_values(item)
            out[item.service_id] = {
                "rank": rank,
                "bia_id": bia.id,
                "status": bia.status,
                "period": bia.period,
                "mtpd_hours": v["mtpd_hours"],
                "rto_hours": v["rto_hours"],
                "rpo_hours": v["rpo_hours"],
            }
    for v in out.values():
        v.pop("rank")
    return out


def _service_out(
    s: Service,
    ctx: Ctx,
    pr: Principal,
    asset_ids: list[int],
    supplier_ids: list[int],
    bia: dict | None,
    plans: list[dict],
    coverage: dict | None,
) -> dict:
    return {
        "id": s.id,
        "code": s.code,
        "entity": ctx.entity(s.entity_id),
        "entity_id": s.entity_id,
        "name": s.name,
        "description": s.description,
        "kind": s.kind,
        "criticality": s.criticality,
        "nis2_relevant": s.nis2_relevant,
        "owner": ctx.owner(s.owner_id),
        "owner_id": s.owner_id,
        "rto_hours": s.rto_hours,
        "rpo_hours": s.rpo_hours,
        "status": s.status,
        "tags": s.tags or [],
        "notes": s.notes,
        "asset_ids": asset_ids,
        "supplier_ids": supplier_ids,
        "bia": bia,
        "plans": plans,
        "restore_state": coverage["state"] if coverage else None,
        "updated_at": s.updated_at,
        "can_edit": pr.can_write(MANAGE, s.entity_id),
    }


def _plan_map(db: Session, pr: Principal) -> dict[int, list[dict]]:
    plans = {
        p.id: p
        for p in db.scalars(select(ContinuityPlan).where(ContinuityPlan.status != "retired"))
        if pr.can_read(READ, p.entity_id)
    }
    out: dict[int, list[dict]] = {}
    for pid, sid in db.execute(select(plan_services.c.plan_id, plan_services.c.service_id)):
        if pid in plans:
            p = plans[pid]
            out.setdefault(sid, []).append(
                {
                    "id": p.id,
                    "code": p.code,
                    "title": p.title,
                    "plan_type": p.plan_type,
                    "last_tested": p.last_tested,
                    "next_test_due": p.next_test_due,
                }
            )
    return out


@router.get("/services")
def list_services(
    entity_id: int | None = None, pr: Principal = Depends(require(READ)), db: Session = Depends(get_db)
):
    ctx = Ctx(db, pr)
    rows = _visible(pr, list(db.scalars(select(Service).order_by(Service.name))), entity_id)
    s_assets = _pairs(db, service_assets, "service_id", "asset_id")
    s_sups = _pairs(db, service_suppliers, "service_id", "supplier_id")
    readable_assets = _readable_ids(db, pr, Asset)
    bias = _bia_state(db, pr)
    plans = _plan_map(db, pr)
    cov = {c["service_id"]: c for c in restore_coverage(db, rows, visible=_reader(pr))}
    return [
        _service_out(
            s,
            ctx,
            pr,
            [a for a in s_assets.get(s.id, []) if a in readable_assets],
            s_sups.get(s.id, []),
            bias.get(s.id),
            plans.get(s.id, []),
            cov.get(s.id),
        )
        for s in rows
    ]


def _reader(pr: Principal):
    return lambda entity_id: pr.can_read(READ, entity_id)


def _readable_ids(db: Session, pr: Principal, model) -> set[int]:
    return {i for i, eid in db.execute(select(model.id, model.entity_id)) if pr.can_read(READ, eid)}


def _load_service(db: Session, pr: Principal, service_id: int, write: bool = False) -> Service:
    s = get_or_404(db, Service, service_id, "Service")
    pr.ensure(MANAGE if write else READ, s.entity_id, write=write)
    return s


def _asset_brief(a: Asset, ctx: Ctx) -> dict:
    return {
        "id": a.id,
        "code": a.code,
        "name": a.name,
        "asset_type": a.asset_type,
        "entity": ctx.entity(a.entity_id),
        "criticality": a.criticality,
        "lifecycle": a.lifecycle,
        "supplier": ctx.supplier(a.supplier_id),
        "owner": ctx.owner(a.owner_id),
    }


def _service_detail(db: Session, pr: Principal, s: Service) -> dict:
    ctx = Ctx(db, pr)
    all_asset_ids = list(
        db.scalars(select(service_assets.c.asset_id).where(service_assets.c.service_id == s.id))
    )
    sup_ids = [
        r
        for r in db.scalars(
            select(service_suppliers.c.supplier_id).where(service_suppliers.c.service_id == s.id)
        )
    ]
    cov = restore_coverage(db, [s], visible=_reader(pr))
    assets = [
        a
        for a in db.scalars(select(Asset).where(Asset.id.in_(all_asset_ids)).order_by(Asset.name))
        if pr.can_read(READ, a.entity_id)
    ]
    out = _service_out(
        s,
        ctx,
        pr,
        [a.id for a in assets],
        sup_ids,
        _bia_state(db, pr).get(s.id),
        _plan_map(db, pr).get(s.id, []),
        cov[0] if cov else None,
    )
    out["assets"] = [_asset_brief(a, ctx) for a in assets]
    out["suppliers"] = [ctx.supplier(i) for i in sup_ids if i in ctx.suppliers]
    ex_ids = set(
        db.scalars(select(exercise_services.c.exercise_id).where(exercise_services.c.service_id == s.id))
    )
    out["exercises"] = (
        [
            _exercise_brief(e)
            for e in db.scalars(
                select(Exercise).where(Exercise.id.in_(ex_ids)).order_by(Exercise.exercise_date.desc())
            )
            if pr.can_read(READ, e.entity_id)
        ]
        if ex_ids
        else []
    )
    out["bia_items"] = []
    for item, bia in db.execute(
        select(BiaItem, Bia).join(Bia).where(BiaItem.service_id == s.id).order_by(Bia.period.desc())
    ):
        if not pr.can_read(READ, bia.entity_id):
            continue
        v = item_values(item)
        out["bia_items"].append(
            {
                "bia_id": bia.id,
                "item_id": item.id,
                "period": bia.period,
                "status": bia.status,
                "entity": ctx.entity(bia.entity_id),
                "mtpd_hours": v["mtpd_hours"],
                "rto_hours": v["rto_hours"],
                "rpo_hours": v["rpo_hours"],
                "min_staffing": item.min_staffing,
            }
        )
    out["coverage"] = cov[0] if cov else None
    out["documents"] = doc_links_for(db, pr, "service", s.id)
    out["history"] = _history(db, "service", s.id)
    return out


def _exercise_brief(e: Exercise) -> dict:
    return {
        "id": e.id,
        "code": e.code,
        "title": e.title,
        "exercise_type": e.exercise_type,
        "exercise_date": e.exercise_date,
        "result": e.result,
        "achieved_rto_hours": e.achieved_rto_hours,
        "achieved_rpo_hours": e.achieved_rpo_hours,
    }


@router.post("/services")
def create_service(body: ServiceIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr.ensure(MANAGE, body.entity_id, write=True)
    _ensure_entity(db, body.entity_id)
    _check_owner(db, body.owner_id)
    data = body.model_dump()
    data["tags"] = [t.strip()[:40] for t in body.tags if t.strip()]
    s = Service(code=next_code(db, Service.code, "SVC-"), **data)
    db.add(s)
    db.flush()
    audit(db, pr, "create", "service", s.id, f"{s.code} {s.name}", entity_id=s.entity_id)
    db.commit()
    index_object(db, "service", s.id)
    return _service_detail(db, pr, s)


@router.get("/services/{service_id}")
def get_service(service_id: int, pr: Principal = Depends(require(READ)), db: Session = Depends(get_db)):
    return _service_detail(db, pr, _load_service(db, pr, service_id))


@router.put("/services/{service_id}")
def update_service(
    service_id: int, body: ServiceIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    s = _load_service(db, pr, service_id, write=True)
    pr.ensure(MANAGE, body.entity_id, write=True)
    _ensure_entity(db, body.entity_id)
    _check_owner(db, body.owner_id)
    data = body.model_dump()
    data["tags"] = [t.strip()[:40] for t in body.tags if t.strip()]
    diff = apply_changes(s, data)
    if diff:
        audit(db, pr, "update", "service", s.id, f"{s.code} {s.name}", entity_id=s.entity_id, details=diff)
    db.commit()
    index_object(db, "service", s.id)
    return _service_detail(db, pr, s)


@router.put("/services/{service_id}/dependencies")
def set_service_dependencies(
    service_id: int,
    body: ServiceDepsIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    s = _load_service(db, pr, service_id, write=True)
    old_a = set(db.scalars(select(service_assets.c.asset_id).where(service_assets.c.service_id == s.id)))
    old_s = set(
        db.scalars(select(service_suppliers.c.supplier_id).where(service_suppliers.c.service_id == s.id))
    )
    new_a, new_s = set(body.asset_ids), set(body.supplier_ids)
    for aid in new_a - old_a:
        a = db.get(Asset, aid)
        if not a or not pr.can_read(READ, a.entity_id):
            raise HTTPException(400, f"Asset {aid} not found")
    for sid in new_s - old_s:
        _check_supplier(db, pr, sid)
    db.execute(
        delete(service_assets).where(
            service_assets.c.service_id == s.id, service_assets.c.asset_id.in_(old_a - new_a)
        )
    )
    db.execute(
        delete(service_suppliers).where(
            service_suppliers.c.service_id == s.id, service_suppliers.c.supplier_id.in_(old_s - new_s)
        )
    )
    if new_a - old_a:
        db.execute(
            insert(service_assets), [{"service_id": s.id, "asset_id": a} for a in sorted(new_a - old_a)]
        )
    if new_s - old_s:
        db.execute(
            insert(service_suppliers), [{"service_id": s.id, "supplier_id": x} for x in sorted(new_s - old_s)]
        )
    if old_a != new_a or old_s != new_s:
        audit(
            db,
            pr,
            "update",
            "service",
            s.id,
            f"{s.code} dependencies",
            entity_id=s.entity_id,
            details={
                "asset_ids": [sorted(old_a), sorted(new_a)],
                "supplier_ids": [sorted(old_s), sorted(new_s)],
            },
        )
        s.updated_at = utcnow()
    db.commit()
    db.expire(s)
    index_object(db, "service", s.id)
    return _service_detail(db, pr, s)


@router.delete("/services/{service_id}", response_model=Ok)
def delete_service(service_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    s = _load_service(db, pr, service_id, write=True)
    audit(db, pr, "delete", "service", s.id, f"{s.code} {s.name}", entity_id=s.entity_id)
    cleanup_target(db, "service", s.id)
    db.delete(s)
    db.commit()
    remove_object(db, "service", service_id)
    return Ok()


# --- assets ----------------------------------------------------------------------------------------------


class AssetIn(BaseModel):
    entity_id: int | None = None
    external_id: str | None = Field(default=None, max_length=120)
    site: str | None = Field(default=None, max_length=200)
    name: str = Field(min_length=1, max_length=300)
    asset_type: AssetType = "IT"
    description: str | None = None
    owner_id: int | None = None
    confidentiality: int | None = Field(default=None, ge=1, le=4)
    integrity: int | None = Field(default=None, ge=1, le=4)
    availability: int | None = Field(default=None, ge=1, le=4)
    criticality: int | None = Field(default=None, ge=1, le=4)
    ot_zone: str | None = Field(default=None, max_length=120)
    ot_conduit: str | None = Field(default=None, max_length=200)
    supplier_id: int | None = None
    lifecycle: Lifecycle = "in_operation"
    location: str | None = Field(default=None, max_length=300)
    vendor_product: str | None = Field(default=None, max_length=300)
    crypto_algorithms: str | None = Field(default=None, max_length=300)
    key_management_owner: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=20)
    notes: str | None = None


class AssetServicesIn(BaseModel):
    service_ids: list[int] = Field(default_factory=list, max_length=200)


def _asset_out(a: Asset, ctx: Ctx, pr: Principal, service_ids: list[int]) -> dict:
    return {
        "id": a.id,
        "code": a.code,
        "external_id": a.external_id,
        "entity": ctx.entity(a.entity_id),
        "entity_id": a.entity_id,
        "site": a.site,
        "name": a.name,
        "asset_type": a.asset_type,
        "description": a.description,
        "owner": ctx.owner(a.owner_id),
        "owner_id": a.owner_id,
        "confidentiality": a.confidentiality,
        "integrity": a.integrity,
        "availability": a.availability,
        "criticality": a.criticality,
        "ot_zone": a.ot_zone,
        "ot_conduit": a.ot_conduit,
        "supplier": ctx.supplier(a.supplier_id),
        "supplier_id": a.supplier_id,
        "lifecycle": a.lifecycle,
        "location": a.location,
        "vendor_product": a.vendor_product,
        "crypto_algorithms": a.crypto_algorithms,
        "key_management_owner": a.key_management_owner,
        "tags": a.tags or [],
        "notes": a.notes,
        "service_ids": service_ids,
        "updated_at": a.updated_at,
        "can_edit": pr.can_write(MANAGE, a.entity_id),
    }


@router.get("/assets")
def list_assets(
    entity_id: int | None = None, pr: Principal = Depends(require(READ)), db: Session = Depends(get_db)
):
    ctx = Ctx(db, pr)
    rows = _visible(pr, list(db.scalars(select(Asset).order_by(Asset.name))), entity_id)
    a_svcs = _pairs(db, service_assets, "asset_id", "service_id")
    readable = _readable_ids(db, pr, Service)
    return [_asset_out(a, ctx, pr, [x for x in a_svcs.get(a.id, []) if x in readable]) for a in rows]


def _load_asset(db: Session, pr: Principal, asset_id: int, write: bool = False) -> Asset:
    a = get_or_404(db, Asset, asset_id, "Asset")
    pr.ensure(MANAGE if write else READ, a.entity_id, write=write)
    return a


def _asset_detail(db: Session, pr: Principal, a: Asset) -> dict:
    ctx = Ctx(db, pr)
    svc_ids = list(db.scalars(select(service_assets.c.service_id).where(service_assets.c.asset_id == a.id)))
    svcs = [
        s
        for s in (
            db.scalars(select(Service).where(Service.id.in_(svc_ids)).order_by(Service.name))
            if svc_ids
            else []
        )
        if pr.can_read(READ, s.entity_id)
    ]
    out = _asset_out(a, ctx, pr, [s.id for s in svcs])
    out["services"] = [
        {
            "id": s.id,
            "code": s.code,
            "name": s.name,
            "criticality": s.criticality,
            "entity": ctx.entity(s.entity_id),
            "status": s.status,
        }
        for s in svcs
    ]
    ex_ids = set(db.scalars(select(exercise_assets.c.exercise_id).where(exercise_assets.c.asset_id == a.id)))
    out["exercises"] = (
        [
            _exercise_brief(e)
            for e in db.scalars(
                select(Exercise).where(Exercise.id.in_(ex_ids)).order_by(Exercise.exercise_date.desc())
            )
            if pr.can_read(READ, e.entity_id)
        ]
        if ex_ids
        else []
    )
    out["documents"] = doc_links_for(db, pr, "asset", a.id)
    out["history"] = _history(db, "asset", a.id)
    return out


def _check_supplier(db: Session, pr: Principal, supplier_id: int) -> None:
    # an invisible supplier answers like a missing one, so ids cannot be probed
    if supplier_id not in visible_supplier_ids(db, pr):
        raise HTTPException(400, "unknown supplier")


def _check_asset_refs(
    db: Session, pr: Principal, body: AssetIn, current_supplier_id: int | None = None
) -> None:
    _ensure_entity(db, body.entity_id)
    _check_owner(db, body.owner_id)
    # an unchanged link may stay, so editing other fields of an asset linked to a hidden supplier still works
    if body.supplier_id is not None and body.supplier_id != current_supplier_id:
        _check_supplier(db, pr, body.supplier_id)


@router.post("/assets")
def create_asset(body: AssetIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr.ensure(MANAGE, body.entity_id, write=True)
    _check_asset_refs(db, pr, body)
    data = body.model_dump()
    data["tags"] = [t.strip()[:40] for t in body.tags if t.strip()]
    a = Asset(code=next_code(db, Asset.code, "AST-"), **data)
    db.add(a)
    db.flush()
    audit(db, pr, "create", "asset", a.id, f"{a.code} {a.name}", entity_id=a.entity_id)
    db.commit()
    index_object(db, "asset", a.id)
    return _asset_detail(db, pr, a)


@router.get("/assets/{asset_id}")
def get_asset(asset_id: int, pr: Principal = Depends(require(READ)), db: Session = Depends(get_db)):
    return _asset_detail(db, pr, _load_asset(db, pr, asset_id))


@router.put("/assets/{asset_id}")
def update_asset(
    asset_id: int, body: AssetIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    a = _load_asset(db, pr, asset_id, write=True)
    pr.ensure(MANAGE, body.entity_id, write=True)
    _check_asset_refs(db, pr, body, a.supplier_id)
    data = body.model_dump()
    data["tags"] = [t.strip()[:40] for t in body.tags if t.strip()]
    diff = apply_changes(a, data)
    if diff:
        audit(db, pr, "update", "asset", a.id, f"{a.code} {a.name}", entity_id=a.entity_id, details=diff)
    db.commit()
    index_object(db, "asset", a.id)
    return _asset_detail(db, pr, a)


@router.put("/assets/{asset_id}/services")
def set_asset_services(
    asset_id: int,
    body: AssetServicesIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    a = _load_asset(db, pr, asset_id, write=True)
    old = set(db.scalars(select(service_assets.c.service_id).where(service_assets.c.asset_id == a.id)))
    new = set(body.service_ids)
    for sid in old ^ new:
        s = db.get(Service, sid)
        if not s:
            raise HTTPException(400, f"Service {sid} not found")
        if not pr.can_write(MANAGE, s.entity_id):
            raise HTTPException(403, f"No permission to change the dependencies of {s.code}")
    db.execute(
        delete(service_assets).where(
            service_assets.c.asset_id == a.id, service_assets.c.service_id.in_(old - new)
        )
    )
    if new - old:
        db.execute(insert(service_assets), [{"service_id": s, "asset_id": a.id} for s in sorted(new - old)])
    if old != new:
        audit(
            db,
            pr,
            "update",
            "asset",
            a.id,
            f"{a.code} services",
            entity_id=a.entity_id,
            details={"service_ids": [sorted(old), sorted(new)]},
        )
        for sid in old ^ new:
            audit(
                db,
                pr,
                "update",
                "service",
                sid,
                "dependencies",
                details={"asset": a.code, "linked": sid in new},
            )
    db.commit()
    db.expire(a)
    for sid in old ^ new:
        index_object(db, "service", sid)
    return _asset_detail(db, pr, a)


@router.delete("/assets/{asset_id}", response_model=Ok)
def delete_asset(asset_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    a = _load_asset(db, pr, asset_id, write=True)
    audit(db, pr, "delete", "asset", a.id, f"{a.code} {a.name}", entity_id=a.entity_id)
    cleanup_target(db, "asset", a.id)
    db.delete(a)
    db.commit()
    remove_object(db, "asset", asset_id)
    return Ok()


# --- dependencies, consistency, overview -----------------------------------------------------------------


@router.get("/dependencies")
def dependencies(
    entity_id: int | None = None, pr: Principal = Depends(require(READ)), db: Session = Depends(get_db)
):
    """Service → assets → suppliers tree (plus direct service → supplier dependencies)."""
    ctx = Ctx(db, pr)
    services = _visible(
        pr,
        list(
            db.scalars(
                select(Service)
                .where(Service.status != "retired")
                .order_by(Service.criticality.desc(), Service.name)
            )
        ),
        entity_id,
    )
    assets = {a.id: a for a in db.scalars(select(Asset))}
    s_assets = _pairs(db, service_assets, "service_id", "asset_id")
    s_sups = _pairs(db, service_suppliers, "service_id", "supplier_id")
    svc_map, _ = dependency_map(db)
    tiers = {sid: effective_tier(sup, svc_map.get(sid, []))[0] for sid, sup in ctx.suppliers.items()}

    def sup(sid):
        d = ctx.supplier(sid)
        if d and not d.get("hidden"):
            d["tier"] = tiers.get(sid)
        return d

    tree = []
    for s in services:
        a_nodes = []
        for aid in s_assets.get(s.id, []):
            a = assets.get(aid)
            if not a:
                continue
            if not pr.can_read(READ, a.entity_id):
                a_nodes.append({"id": -len(a_nodes) - 1, "code": "", "name": "", "hidden": True})
                continue
            a_nodes.append({**_asset_brief(a, ctx), "supplier": sup(a.supplier_id), "hidden": False})
        a_nodes.sort(key=lambda x: (-(x.get("criticality") or 0), x["name"]))
        tree.append(
            {
                "id": s.id,
                "code": s.code,
                "name": s.name,
                "entity": ctx.entity(s.entity_id),
                "criticality": s.criticality,
                "kind": s.kind,
                "rto_hours": s.rto_hours,
                "rpo_hours": s.rpo_hours,
                "assets": a_nodes,
                "suppliers": [sup(x) for x in s_sups.get(s.id, []) if x in ctx.suppliers],
            }
        )
    used = {a for v in s_assets.values() for a in v}
    unlinked = [
        _asset_brief(a, ctx)
        for a in _visible(pr, list(assets.values()), entity_id)
        if a.id not in used and a.lifecycle != "retired"
    ]
    return {"services": tree, "unlinked_assets": sorted(unlinked, key=lambda x: x["name"])}


@router.get("/consistency")
def consistency(
    entity_id: int | None = None, pr: Principal = Depends(require(READ)), db: Session = Depends(get_db)
):
    services = _visible(pr, list(db.scalars(select(Service))), entity_id)
    assets = _visible(pr, list(db.scalars(select(Asset))), entity_id)
    ctx = Ctx(db, pr)
    flags = consistency_flags(db, services, assets)
    for f in flags:
        f["entity"] = ctx.entity(f["entity_id"])
    return flags


def _test_state(p: ContinuityPlan, today: date) -> str:
    if p.status == "retired":
        return "n/a"
    if not p.last_tested:
        return "never"
    if p.next_test_due and p.next_test_due < today:
        return "overdue"
    if p.next_test_due and (p.next_test_due - today).days <= 60:
        return "due_soon"
    return "ok"


@router.get("/overview")
def overview(
    entity_id: int | None = None, pr: Principal = Depends(require(READ)), db: Session = Depends(get_db)
):
    ctx = Ctx(db, pr)
    today = date.today()
    services = _visible(
        pr, list(db.scalars(select(Service).order_by(Service.criticality.desc(), Service.name))), entity_id
    )
    assets = _visible(pr, list(db.scalars(select(Asset))), entity_id)
    active = [s for s in services if s.status != "retired"]
    critical = [s for s in active if s.criticality >= 3]
    coverage = restore_coverage(db, critical, visible=_reader(pr))
    for c in coverage:
        c["entity"] = ctx.entity(c["entity_id"])
    flags = consistency_flags(db, services, assets)
    plans = _visible(
        pr, list(db.scalars(select(ContinuityPlan).order_by(ContinuityPlan.next_test_due))), entity_id
    )
    exercises = _visible(
        pr, list(db.scalars(select(Exercise).order_by(Exercise.exercise_date.desc()))), entity_id
    )
    bias = _visible(pr, list(db.scalars(select(Bia).order_by(Bia.period.desc()))), entity_id)
    by_type: dict[str, int] = {}
    for a in assets:
        if a.lifecycle != "retired":
            by_type[a.asset_type] = by_type.get(a.asset_type, 0) + 1
    latest_bia: dict[int, Bia] = {}
    for b in bias:
        cur = latest_bia.get(b.entity_id)
        if (
            not cur
            or (b.status == "approved" and cur.status != "approved")
            or (b.status == cur.status and b.period > cur.period)
        ):
            latest_bia[b.entity_id] = b
    return {
        "counts": {
            "services": len(active),
            "critical_services": len(critical),
            "nis2_services": sum(1 for s in active if s.nis2_relevant),
            "assets": sum(by_type.values()),
            "assets_by_type": by_type,
            "plans": sum(1 for p in plans if p.status != "retired"),
            "exercises": len(exercises),
        },
        "coverage": coverage,
        "flags": {
            "high": sum(1 for f in flags if f["severity"] == "high"),
            "medium": sum(1 for f in flags if f["severity"] == "medium"),
            "low": sum(1 for f in flags if f["severity"] == "low"),
            "top": flags[:8],
        },
        "plans": [
            {
                "id": p.id,
                "code": p.code,
                "title": p.title,
                "plan_type": p.plan_type,
                "entity": ctx.entity(p.entity_id),
                "last_tested": p.last_tested,
                "next_test_due": p.next_test_due,
                "test_state": _test_state(p, today),
            }
            for p in plans
            if p.status != "retired"
        ],
        "upcoming_exercises": [
            {**_exercise_brief(e), "entity": ctx.entity(e.entity_id)}
            for e in sorted(exercises, key=lambda e: e.exercise_date)
            if e.result is None and e.exercise_date >= today
        ][:6],
        "recent_exercises": [
            {**_exercise_brief(e), "entity": ctx.entity(e.entity_id)}
            for e in exercises
            if e.result is not None
        ][:6],
        "bia": [
            {
                "id": b.id,
                "entity": ctx.entity(b.entity_id),
                "period": b.period,
                "status": b.status,
                "approved_at": b.approved_at,
                "next_review": b.next_review,
            }
            for b in latest_bia.values()
        ],
    }


# --- import / export -------------------------------------------------------------------------------------


@router.get("/export.xlsx")
def export_inventory(
    entity_id: int | None = None,
    pr: Principal = Depends(require(READ, "reports.export")),
    db: Session = Depends(get_db),
):
    services = _visible(pr, list(db.scalars(select(Service).order_by(Service.code))), entity_id)
    assets = _visible(pr, list(db.scalars(select(Asset).order_by(Asset.code))), entity_id)
    data = export_workbook(db, pr, services, assets)
    audit(db, pr, "export", "asset", None, "Service and asset inventory", entity_id=entity_id or None)
    db.commit()
    return Response(
        data,
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="Inventory_{date.today().isoformat()}.xlsx"'},
    )


async def _read_upload(file: UploadFile) -> bytes:
    name = (file.filename or "").lower()
    if not name.endswith((".csv", ".txt", ".xlsx", ".xlsm")):
        raise HTTPException(400, "Upload a .csv or .xlsx file")
    limit = min(get_settings().max_upload_mb, 10) * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, "File too large (imports are limited to 10 MB)")
    if name.endswith((".xlsx", ".xlsm")):
        from app.services.extract import zip_is_safe

        if not data.startswith(b"PK") or not zip_is_safe(data):
            raise HTTPException(400, "Not a valid .xlsx file")
    return data


def _table(data: bytes, filename: str, sheet: str | None) -> dict:
    try:
        return read_table(data, filename, sheet)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001  (corrupt workbook)
        raise HTTPException(400, "The file could not be read") from e


@router.post("/import/preview")
async def import_preview(
    file: UploadFile = File(...),
    sheet: str | None = Form(default=None),
    pr: Principal = Depends(require(MANAGE)),
):
    data = await _read_upload(file)
    t = await asyncio.to_thread(_table, data, file.filename or "", sheet)
    return {
        "filename": file.filename,
        "sheets": t["sheets"],
        "sheet": t["sheet"],
        "columns": t["columns"],
        "row_count": len(t["rows"]),
        "sample": t["rows"][:8],
        "suggested": {k: suggest_mapping(k, t["columns"]) for k in FIELDS},
    }


def _do_import(
    data: bytes, filename: str, sheet: str | None, kind: str, mapping: dict, pr: Principal, dry_run: bool
) -> dict:
    t = _table(data, filename, sheet)
    db = SessionLocal()
    try:
        try:
            result = run_import(db, pr, kind, t, mapping, dry_run)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        if not dry_run:
            audit(
                db,
                pr,
                "import",
                kind[:-1],
                None,
                filename,
                details={k: result[k] for k in ("created", "updated", "unchanged", "errors")},
            )
            db.commit()
            reindex_all(db, ["asset", "service"])
        return result
    finally:
        db.close()


@router.post("/import")
async def import_run(
    file: UploadFile = File(...),
    kind: Literal["assets", "services"] = Form(...),
    mapping: str = Form(...),
    sheet: str | None = Form(default=None),
    dry_run: bool = Form(True),
    pr: Principal = Depends(require(MANAGE)),
):
    try:
        m = json.loads(mapping)
        if not isinstance(m, dict):
            raise ValueError
        m = {str(k): (str(v) if v else None) for k, v in m.items()}
    except (ValueError, TypeError) as e:
        raise HTTPException(400, "Invalid column mapping") from e
    data = await _read_upload(file)
    return await asyncio.to_thread(_do_import, data, file.filename or "", sheet, kind, m, pr, dry_run)


# --- BIA -------------------------------------------------------------------------------------------------


class BiaIn(BaseModel):
    entity_id: int
    period: str = Field(min_length=1, max_length=40)
    title: str | None = Field(default=None, max_length=300)
    notes: str | None = None
    next_review: date | None = None
    copy_from_id: int | None = None
    include_services: bool = True


class BiaUpdate(BaseModel):
    period: str = Field(min_length=1, max_length=40)
    title: str | None = Field(default=None, max_length=300)
    notes: str | None = None
    next_review: date | None = None


class BiaItemIn(BaseModel):
    service_id: int | None = None
    process_name: str | None = Field(default=None, max_length=300)
    impacts: dict = Field(default_factory=dict)
    mtpd_hours: float | None = Field(default=None, ge=0, le=100000)
    rto_hours: float | None = Field(default=None, ge=0, le=100000)
    rpo_hours: float | None = Field(default=None, ge=0, le=100000)
    dependencies: str | None = None
    min_staffing: int | None = Field(default=None, ge=0, le=100000)
    notes: str | None = None
    sort_order: int | None = None


def _bia_summary(b: Bia, ctx: Ctx, pr: Principal, users: dict[int, str]) -> dict:
    warn = sum(1 for i in b.items if item_values(i)["warnings"])
    return {
        "id": b.id,
        "entity": ctx.entity(b.entity_id),
        "entity_id": b.entity_id,
        "period": b.period,
        "title": b.title,
        "status": b.status,
        "approved_at": b.approved_at,
        "approved_by": users.get(b.approved_by_id),
        "created_by_id": b.created_by_id,
        "created_by": users.get(b.created_by_id),
        "updated_by_id": b.updated_by_id,
        "updated_by": users.get(b.updated_by_id),
        "next_review": b.next_review,
        "notes": b.notes,
        "item_count": len(b.items),
        "items_with_warnings": warn,
        "updated_at": b.updated_at,
        "can_edit": pr.can_write(MANAGE, b.entity_id),
        "can_approve": b.status == "draft"
        and pr.can_write(MANAGE, b.entity_id)
        and pr.id not in {b.created_by_id, b.updated_by_id},
    }


def _user_names(db: Session) -> dict[int, str]:
    return {uid: name for uid, name in db.execute(select(User.id, User.display_name))}


@router.get("/bias")
def list_bias(pr: Principal = Depends(require(READ)), db: Session = Depends(get_db)):
    ctx = Ctx(db, pr)
    rows = _visible(
        pr,
        list(
            db.scalars(
                select(Bia).options(selectinload(Bia.items)).order_by(Bia.period.desc(), Bia.id.desc())
            )
        ),
    )
    users = _user_names(db)
    return [_bia_summary(b, ctx, pr, users) for b in rows]


def _load_bia(db: Session, pr: Principal, bia_id: int, write: bool = False) -> Bia:
    b = get_or_404(db, Bia, bia_id, "BIA")
    pr.ensure(MANAGE if write else READ, b.entity_id, write=write)
    return b


def _item_out(
    i: BiaItem,
    ctx: Ctx,
    services: dict[int, Service],
    s_assets: dict[int, list[int]],
    s_sups: dict[int, list[int]],
    assets: dict[int, Asset],
) -> dict:
    """`assets` must only contain assets the caller may read."""
    v = item_values(i)
    s = services.get(i.service_id) if i.service_id else None
    dep_assets = [_asset_brief(assets[a], ctx) for a in s_assets.get(s.id, []) if a in assets] if s else []
    sup_ids = set(s_sups.get(s.id, [])) if s else set()
    sup_ids |= {a["supplier"]["id"] for a in dep_assets if a["supplier"]}
    return {
        "id": i.id,
        "service_id": i.service_id,
        "service": {
            "id": s.id,
            "code": s.code,
            "name": s.name,
            "criticality": s.criticality,
            "rto_hours": s.rto_hours,
            "rpo_hours": s.rpo_hours,
        }
        if s
        else None,
        "process_name": i.process_name,
        "label": s.name if s else (i.process_name or "Unnamed process"),
        "impacts": clean_impacts(i.impacts),
        "mtpd_hours_manual": i.mtpd_hours,
        "rto_hours_manual": i.rto_hours,
        "rpo_hours_manual": i.rpo_hours,
        "mtpd_hours": v["mtpd_hours"],
        "rto_hours": v["rto_hours"],
        "rpo_hours": v["rpo_hours"],
        "derived": v["derived"],
        "warnings": v["warnings"],
        "dependencies": i.dependencies,
        "min_staffing": i.min_staffing,
        "notes": i.notes,
        "sort_order": i.sort_order,
        "dependent_assets": dep_assets,
        "dependent_suppliers": [ctx.supplier(x) for x in sorted(sup_ids) if x in ctx.suppliers],
    }


def _bia_detail(db: Session, pr: Principal, b: Bia) -> dict:
    ctx = Ctx(db, pr)
    db.refresh(b)
    out = _bia_summary(b, ctx, pr, _user_names(db))
    services = {s.id: s for s in db.scalars(select(Service))}
    assets = {a.id: a for a in db.scalars(select(Asset)) if pr.can_read(READ, a.entity_id)}
    s_assets = _pairs(db, service_assets, "service_id", "asset_id")
    s_sups = _pairs(db, service_suppliers, "service_id", "supplier_id")
    out["items"] = [_item_out(i, ctx, services, s_assets, s_sups, assets) for i in b.items]
    used = {i.service_id for i in b.items if i.service_id}
    out["available_services"] = [
        {"id": s.id, "code": s.code, "name": s.name, "criticality": s.criticality}
        for s in sorted(services.values(), key=lambda s: s.name)
        if s.entity_id in (b.entity_id, None) and s.id not in used and s.status != "retired"
    ]
    out["documents"] = doc_links_for(db, pr, "bia", b.id)
    return out


@router.post("/bias")
def create_bia(body: BiaIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr.ensure(MANAGE, body.entity_id, write=True)
    _ensure_entity(db, body.entity_id)
    src = _load_bia(db, pr, body.copy_from_id) if body.copy_from_id else None  # the source must be readable
    b = Bia(
        entity_id=body.entity_id,
        period=body.period.strip(),
        title=body.title,
        notes=body.notes,
        next_review=body.next_review,
        status="draft",
        created_by_id=pr.id,
        updated_by_id=pr.id,
    )
    db.add(b)
    db.flush()
    if src:
        allowed = {
            sid
            for sid in db.scalars(
                select(Service.id).where((Service.entity_id == b.entity_id) | Service.entity_id.is_(None))
            )
        }
        n = 0
        for i in src.items:
            if i.service_id is not None and i.service_id not in allowed:
                continue  # services of other entities are not copied
            if i.service_id is None and not (i.process_name or "").strip():
                continue
            n += 1
            db.add(
                BiaItem(
                    bia_id=b.id,
                    service_id=i.service_id,
                    process_name=i.process_name,
                    impacts=clean_impacts(i.impacts),
                    mtpd_hours=i.mtpd_hours,
                    rto_hours=i.rto_hours,
                    rpo_hours=i.rpo_hours,
                    dependencies=i.dependencies,
                    min_staffing=i.min_staffing,
                    notes=i.notes,
                    sort_order=n,
                )
            )
    elif body.include_services:
        svcs = db.scalars(
            select(Service)
            .where(Service.entity_id == body.entity_id, Service.status != "retired")
            .order_by(Service.criticality.desc(), Service.name)
        )
        for n, s in enumerate(svcs):
            db.add(BiaItem(bia_id=b.id, service_id=s.id, impacts={}, sort_order=n))
    audit(db, pr, "create", "bia", b.id, f"BIA {b.period}", entity_id=b.entity_id)
    db.commit()
    return _bia_detail(db, pr, b)


@router.get("/bias/{bia_id}")
def get_bia(bia_id: int, pr: Principal = Depends(require(READ)), db: Session = Depends(get_db)):
    return _bia_detail(db, pr, _load_bia(db, pr, bia_id))


@router.put("/bias/{bia_id}")
def update_bia(
    bia_id: int, body: BiaUpdate, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    b = _load_bia(db, pr, bia_id, write=True)
    if b.status != "draft":
        raise HTTPException(400, "The BIA is approved; reopen it to make changes")
    diff = apply_changes(b, body.model_dump())
    if diff:
        b.updated_by_id = pr.id
        audit(db, pr, "update", "bia", b.id, f"BIA {b.period}", entity_id=b.entity_id, details=diff)
    db.commit()
    return _bia_detail(db, pr, b)


@router.post("/bias/{bia_id}/approve")
def approve_bia(bia_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Approve the BIA and adopt its RTO / RPO as the targets of the covered services."""
    b = _load_bia(db, pr, bia_id, write=True)
    if b.status == "approved":
        raise HTTPException(400, "The BIA is already approved")
    if not b.items:
        raise HTTPException(400, "Add at least one service or process before approving")
    if pr.id in {b.created_by_id, b.updated_by_id}:
        raise HTTPException(
            403,
            "Four-eyes principle: the BIA must be approved by someone other than its creator "
            "and its last editor",
        )
    b.status = "approved"
    b.approved_by_id = pr.id
    b.approved_at = utcnow()
    if not b.next_review or b.next_review <= date.today():
        b.next_review = add_months(date.today(), 12)
    adopted = []
    for i in b.items:
        if not i.service_id:
            continue
        s = db.get(Service, i.service_id)
        if not s or not pr.can_write(MANAGE, s.entity_id):
            continue
        v = item_values(i)
        diff = apply_changes(s, {"rto_hours": v["rto_hours"], "rpo_hours": v["rpo_hours"]})
        if diff:
            adopted.append(s.code)
            audit(
                db,
                pr,
                "update",
                "service",
                s.id,
                f"{s.code} targets from BIA {b.period}",
                entity_id=s.entity_id,
                details=diff,
            )
    audit(
        db,
        pr,
        "approve",
        "bia",
        b.id,
        f"BIA {b.period}",
        entity_id=b.entity_id,
        details={"targets_adopted": adopted},
    )
    db.commit()
    for code in adopted:
        sid = db.scalar(select(Service.id).where(Service.code == code))
        index_object(db, "service", sid)
    return _bia_detail(db, pr, b)


@router.post("/bias/{bia_id}/reopen")
def reopen_bia(bia_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    b = _load_bia(db, pr, bia_id, write=True)
    if b.status != "approved":
        raise HTTPException(400, "Only approved BIAs can be reopened")
    b.status = "draft"
    b.approved_by_id = None
    b.approved_at = None
    audit(db, pr, "reopen", "bia", b.id, f"BIA {b.period}", entity_id=b.entity_id)
    db.commit()
    return _bia_detail(db, pr, b)


@router.delete("/bias/{bia_id}", response_model=Ok)
def delete_bia(bia_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    b = _load_bia(db, pr, bia_id, write=True)
    if b.status == "approved":
        raise HTTPException(400, "Approved BIAs cannot be deleted; reopen it first")
    audit(db, pr, "delete", "bia", b.id, f"BIA {b.period}", entity_id=b.entity_id)
    cleanup_target(db, "bia", b.id)
    db.delete(b)
    db.commit()
    return Ok()


def _check_item(db: Session, pr: Principal, b: Bia, body: BiaItemIn) -> None:
    if b.status != "draft":
        raise HTTPException(400, "The BIA is approved; reopen it to change items")
    if body.service_id is not None:
        s = db.get(Service, body.service_id)
        if not s or s.entity_id not in (b.entity_id, None):
            raise HTTPException(400, "Service not found for this entity")
    elif not (body.process_name or "").strip():
        raise HTTPException(400, "Choose a service or enter a process name")


@router.post("/bias/{bia_id}/items")
def add_bia_item(
    bia_id: int, body: BiaItemIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    b = _load_bia(db, pr, bia_id, write=True)
    _check_item(db, pr, b, body)
    if body.service_id and any(i.service_id == body.service_id for i in b.items):
        raise HTTPException(400, "The service is already part of this BIA")
    data = body.model_dump()
    data["impacts"] = clean_impacts(body.impacts)
    if data["sort_order"] is None:
        data["sort_order"] = len(b.items)
    i = BiaItem(bia_id=b.id, **data)
    db.add(i)
    b.updated_by_id = pr.id
    db.flush()
    audit(db, pr, "update", "bia", b.id, f"BIA {b.period} item added", entity_id=b.entity_id)
    db.commit()
    return _bia_detail(db, pr, b)


@router.put("/bia-items/{item_id}")
def update_bia_item(
    item_id: int, body: BiaItemIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    i = get_or_404(db, BiaItem, item_id, "BIA item")
    b = _load_bia(db, pr, i.bia_id, write=True)
    _check_item(db, pr, b, body)
    data = body.model_dump()
    data["impacts"] = clean_impacts(body.impacts)
    if data["sort_order"] is None:
        data.pop("sort_order")
    diff = apply_changes(i, data)
    if diff:
        b.updated_by_id = pr.id
        audit(
            db, pr, "update", "bia", b.id, f"BIA {b.period} item {i.id}", entity_id=b.entity_id, details=diff
        )
    db.commit()
    return _bia_detail(db, pr, b)


@router.delete("/bia-items/{item_id}")
def delete_bia_item(item_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    i = get_or_404(db, BiaItem, item_id, "BIA item")
    b = _load_bia(db, pr, i.bia_id, write=True)
    if b.status != "draft":
        raise HTTPException(400, "The BIA is approved; reopen it to change items")
    audit(db, pr, "update", "bia", b.id, f"BIA {b.period} item removed", entity_id=b.entity_id)
    b.updated_by_id = pr.id
    db.delete(i)
    db.commit()
    return _bia_detail(db, pr, b)


# --- continuity plans ------------------------------------------------------------------------------------


class PlanIn(BaseModel):
    entity_id: int | None = None
    title: str = Field(min_length=1, max_length=300)
    plan_type: Literal["BCP", "DRP", "crisis", "incident_response"] = "BCP"
    owner_id: int | None = None
    version: str | None = Field(default=None, max_length=40)
    status: Literal["draft", "approved", "retired"] = "draft"
    last_tested: date | None = None
    test_interval_months: int = Field(default=12, ge=1, le=60)
    next_test_due: date | None = None
    description: str | None = None
    service_ids: list[int] = Field(default_factory=list, max_length=200)


def _plan_exercises(db: Session, pr: Principal, plan_ids: list[int]) -> dict[int, list[Exercise]]:
    out: dict[int, list[Exercise]] = {}
    if not plan_ids:
        return out
    for e in db.scalars(
        select(Exercise).where(Exercise.plan_id.in_(plan_ids)).order_by(Exercise.exercise_date.desc())
    ):
        if pr.can_read(READ, e.entity_id):
            out.setdefault(e.plan_id, []).append(e)
    return out


def _plan_out(p: ContinuityPlan, ctx: Ctx, pr: Principal, today: date, exs: list[Exercise]) -> dict:
    done = [e for e in exs if e.result]
    svcs = [s for s in p.services if pr.can_read(READ, s.entity_id)]
    return {
        "id": p.id,
        "code": p.code,
        "entity": ctx.entity(p.entity_id),
        "entity_id": p.entity_id,
        "title": p.title,
        "plan_type": p.plan_type,
        "owner": ctx.owner(p.owner_id),
        "owner_id": p.owner_id,
        "version": p.version,
        "status": p.status,
        "last_tested": p.last_tested,
        "test_interval_months": p.test_interval_months,
        "next_test_due": p.next_test_due,
        "test_state": _test_state(p, today),
        "description": p.description,
        "services": [
            {"id": s.id, "code": s.code, "name": s.name, "criticality": s.criticality} for s in svcs
        ],
        "service_ids": [s.id for s in svcs],
        "exercise_count": len(exs),
        "last_result": done[0].result if done else None,
        "updated_at": p.updated_at,
        "can_edit": pr.can_write(MANAGE, p.entity_id),
    }


@router.get("/plans")
def list_plans(pr: Principal = Depends(require(READ)), db: Session = Depends(get_db)):
    ctx = Ctx(db, pr)
    today = date.today()
    rows = _visible(
        pr,
        list(
            db.scalars(
                select(ContinuityPlan)
                .options(selectinload(ContinuityPlan.services))
                .order_by(ContinuityPlan.code)
            )
        ),
    )
    exs = _plan_exercises(db, pr, [p.id for p in rows])
    return [_plan_out(p, ctx, pr, today, exs.get(p.id, [])) for p in rows]


def _load_plan(db: Session, pr: Principal, plan_id: int, write: bool = False) -> ContinuityPlan:
    p = get_or_404(db, ContinuityPlan, plan_id, "Continuity plan")
    pr.ensure(MANAGE if write else READ, p.entity_id, write=write)
    return p


def _set_services(db: Session, pr: Principal, obj, ids: list[int], require_all: bool = False) -> None:
    """Replace obj.services. Adding or removing a service changes that service's continuity coverage, so it needs
    write access to the service (to all linked services when require_all)."""
    svcs = list(db.scalars(select(Service).where(Service.id.in_(ids)))) if ids else []
    if len(svcs) != len(set(ids)):
        raise HTTPException(400, "Service not found")
    for s in svcs:
        if not pr.can_read(READ, s.entity_id):
            raise HTTPException(400, "Service not found")
    old = {s.id: s for s in (obj.services or [])}
    changed = [s for s in svcs if s.id not in old] + [s for sid, s in old.items() if sid not in set(ids)]
    for s in (svcs + changed) if require_all else changed:
        if not pr.can_write(MANAGE, s.entity_id):
            raise HTTPException(403, f"No permission to change the continuity records of {s.code}")
    obj.services = svcs


def _plan_detail(db: Session, pr: Principal, p: ContinuityPlan) -> dict:
    ctx = Ctx(db, pr)
    exs = _plan_exercises(db, pr, [p.id]).get(p.id, [])
    out = _plan_out(p, ctx, pr, date.today(), exs)
    out["exercises"] = [_exercise_brief(e) for e in exs]
    out["documents"] = doc_links_for(db, pr, "continuity_plan", p.id)
    return out


@router.post("/plans")
def create_plan(body: PlanIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr.ensure(MANAGE, body.entity_id, write=True)
    _ensure_entity(db, body.entity_id)
    _check_owner(db, body.owner_id)
    data = body.model_dump(exclude={"service_ids"})
    if data["next_test_due"] is None:
        data["next_test_due"] = (
            add_months(body.last_tested or date.today(), body.test_interval_months)
            if body.last_tested
            else None
        )
    p = ContinuityPlan(code=next_code(db, ContinuityPlan.code, "PLAN-"), **data)
    _set_services(db, pr, p, body.service_ids)
    db.add(p)
    db.flush()
    audit(db, pr, "create", "continuity_plan", p.id, f"{p.code} {p.title}", entity_id=p.entity_id)
    db.commit()
    index_object(db, "continuity_plan", p.id)
    return _plan_detail(db, pr, p)


@router.get("/plans/{plan_id}")
def get_plan(plan_id: int, pr: Principal = Depends(require(READ)), db: Session = Depends(get_db)):
    return _plan_detail(db, pr, _load_plan(db, pr, plan_id))


@router.put("/plans/{plan_id}")
def update_plan(
    plan_id: int, body: PlanIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    p = _load_plan(db, pr, plan_id, write=True)
    pr.ensure(MANAGE, body.entity_id, write=True)
    _ensure_entity(db, body.entity_id)
    _check_owner(db, body.owner_id)
    data = body.model_dump(exclude={"service_ids"})
    if data["next_test_due"] is None and body.last_tested:
        data["next_test_due"] = add_months(body.last_tested, body.test_interval_months)
    old_services = sorted(s.id for s in p.services)
    diff = apply_changes(p, data)
    _set_services(db, pr, p, body.service_ids)
    if old_services != sorted(set(body.service_ids)):
        diff["service_ids"] = [old_services, sorted(set(body.service_ids))]
    if diff:
        audit(
            db,
            pr,
            "update",
            "continuity_plan",
            p.id,
            f"{p.code} {p.title}",
            entity_id=p.entity_id,
            details=diff,
        )
    db.commit()
    index_object(db, "continuity_plan", p.id)
    return _plan_detail(db, pr, p)


@router.delete("/plans/{plan_id}", response_model=Ok)
def delete_plan(plan_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    p = _load_plan(db, pr, plan_id, write=True)
    audit(db, pr, "delete", "continuity_plan", p.id, f"{p.code} {p.title}", entity_id=p.entity_id)
    cleanup_target(db, "continuity_plan", p.id)
    db.delete(p)
    db.commit()
    remove_object(db, "continuity_plan", plan_id)
    return Ok()


# --- exercises -------------------------------------------------------------------------------------------


class ExerciseIn(BaseModel):
    entity_id: int | None = None
    plan_id: int | None = None
    title: str = Field(min_length=1, max_length=300)
    exercise_type: Literal["tabletop", "restore_test", "failover", "crisis_drill"]
    exercise_date: date
    participants: str | None = None
    objectives: str | None = None
    result: Literal["passed", "partially", "failed"] | None = None
    achieved_rto_hours: float | None = Field(default=None, ge=0, le=100000)
    achieved_rpo_hours: float | None = Field(default=None, ge=0, le=100000)
    deviations: str | None = None
    lessons_learned: str | None = None
    service_ids: list[int] = Field(default_factory=list, max_length=200)
    asset_ids: list[int] = Field(default_factory=list, max_length=500)


class ExerciseActionIn(BaseModel):
    kind: Literal["action_item", "task"]
    title: str = Field(min_length=1, max_length=400)
    description: str | None = None
    entity_id: int | None = None
    priority: Literal["High", "Medium", "Low"] = "Medium"
    due_date: date | None = None
    responsible_id: int | None = None  # stakeholder (action plan item)
    assignee_id: int | None = None  # user (task)
    requirement_number: str | None = Field(default=None, max_length=20)


def _actions_out(db: Session, pr: Principal, e: Exercise, cache: dict | None = None) -> list[dict]:
    """Follow-ups the caller may see. `cache` holds preloaded ActionItem / Task objects (list endpoints)."""

    cache = cache if cache is not None else _action_cache(db, [e])
    out = []
    for iid in e.action_item_ids or []:
        it = cache["items"].get(iid)
        if it and pr.can_read("findings.read", it.entity_id):
            out.append(
                {
                    "kind": "action_item",
                    "id": it.id,
                    "code": it.code,
                    "title": it.title,
                    "status": it.status,
                    "url": f"/action-plan?item={it.id}",
                }
            )
    for tid in e.task_ids or []:
        t = cache["tasks"].get(tid)
        if t and (pr.id in (t.assignee_id, t.reporter_id) or pr.can_read("tasks.read", t.entity_id)):
            out.append(
                {
                    "kind": "task",
                    "id": t.id,
                    "code": t.key,
                    "title": t.title,
                    "status": t.status,
                    "url": f"/tasks?task={t.id}",
                }
            )
    return out


def _action_cache(db: Session, exercises: list[Exercise]) -> dict:
    from app.models import ActionItem, Task

    iids = {i for e in exercises for i in (e.action_item_ids or [])}
    tids = {i for e in exercises for i in (e.task_ids or [])}
    return {
        "items": {x.id: x for x in db.scalars(select(ActionItem).where(ActionItem.id.in_(iids)))}
        if iids
        else {},
        "tasks": {x.id: x for x in db.scalars(select(Task).where(Task.id.in_(tids)))} if tids else {},
    }


def _exercise_out(
    db: Session,
    e: Exercise,
    ctx: Ctx,
    pr: Principal,
    plans: dict[int, ContinuityPlan],
    cache: dict | None = None,
) -> dict:
    p = plans.get(e.plan_id) if e.plan_id else None
    if p and not pr.can_read(READ, p.entity_id):
        p = None
    svcs = [s for s in e.services if pr.can_read(READ, s.entity_id)]
    assets = [a for a in e.assets if pr.can_read(READ, a.entity_id)]
    return {
        **_exercise_brief(e),
        "entity": ctx.entity(e.entity_id),
        "entity_id": e.entity_id,
        "plan_id": e.plan_id,
        "plan": {"id": p.id, "code": p.code, "title": p.title} if p else None,
        "participants": e.participants,
        "objectives": e.objectives,
        "deviations": e.deviations,
        "lessons_learned": e.lessons_learned,
        "services": [
            {"id": s.id, "code": s.code, "name": s.name, "rto_hours": s.rto_hours, "rpo_hours": s.rpo_hours}
            for s in svcs
        ],
        "assets": [{"id": a.id, "code": a.code, "name": a.name} for a in assets],
        "service_ids": [s.id for s in svcs],
        "asset_ids": [a.id for a in assets],
        "actions": _actions_out(db, pr, e, cache),
        "updated_at": e.updated_at,
        "can_edit": pr.can_write(MANAGE, e.entity_id),
    }


@router.get("/exercises")
def list_exercises(pr: Principal = Depends(require(READ)), db: Session = Depends(get_db)):
    ctx = Ctx(db, pr)
    plans = {p.id: p for p in db.scalars(select(ContinuityPlan))}
    rows = _visible(
        pr,
        list(
            db.scalars(
                select(Exercise)
                .options(selectinload(Exercise.services), selectinload(Exercise.assets))
                .order_by(Exercise.exercise_date.desc())
            )
        ),
    )
    cache = _action_cache(db, rows)
    return [_exercise_out(db, e, ctx, pr, plans, cache) for e in rows]


def _load_exercise(db: Session, pr: Principal, exercise_id: int, write: bool = False) -> Exercise:
    e = get_or_404(db, Exercise, exercise_id, "Exercise")
    pr.ensure(MANAGE if write else READ, e.entity_id, write=write)
    return e


def _exercise_detail(db: Session, pr: Principal, e: Exercise) -> dict:
    ctx = Ctx(db, pr)
    plans = {p.id: p for p in db.scalars(select(ContinuityPlan))}
    out = _exercise_out(db, e, ctx, pr, plans)
    out["documents"] = doc_links_for(db, pr, "exercise", e.id)
    out["default_requirement"] = DEFAULT_REQUIREMENT.get(e.exercise_type)
    return out


def _apply_exercise(db: Session, pr: Principal, e: Exercise, body: ExerciseIn) -> dict:
    """An exercise result updates the linked plan's test dates and the restore coverage of the linked services and
    assets, so the caller needs write access to all of them (not only to the exercise's entity)."""
    if body.plan_id is not None:
        p = db.get(ContinuityPlan, body.plan_id)
        if not p or not pr.can_read(READ, p.entity_id):
            raise HTTPException(400, "Continuity plan not found")
        if not pr.can_write(MANAGE, p.entity_id):
            raise HTTPException(403, f"No permission to record tests of plan {p.code}")
    _ensure_entity(db, body.entity_id)
    data = body.model_dump(exclude={"service_ids", "asset_ids"})
    old = {"service_ids": sorted(s.id for s in e.services), "asset_ids": sorted(a.id for a in e.assets)}
    _set_services(db, pr, e, body.service_ids, require_all=True)
    assets = list(db.scalars(select(Asset).where(Asset.id.in_(body.asset_ids)))) if body.asset_ids else []
    if len(assets) != len(set(body.asset_ids)) or any(not pr.can_read(READ, a.entity_id) for a in assets):
        raise HTTPException(400, "Asset not found")
    for a in assets + [a for a in e.assets if a.id not in set(body.asset_ids)]:
        if not pr.can_write(MANAGE, a.entity_id):
            raise HTTPException(403, f"No permission to change the continuity records of {a.code}")
    e.assets = assets
    diff = apply_changes(e, data)
    for k, new in (
        ("service_ids", sorted(set(body.service_ids))),
        ("asset_ids", sorted(set(body.asset_ids))),
    ):
        if old[k] != new:
            diff[k] = [old[k], new]
    return diff


def _ensure_links_writable(db: Session, pr: Principal, e: Exercise) -> None:
    for o in [*e.services, *e.assets]:
        if not pr.can_write(MANAGE, o.entity_id):
            raise HTTPException(403, f"No permission to change the continuity records of {o.code}")
    p = db.get(ContinuityPlan, e.plan_id) if e.plan_id else None
    if p and not pr.can_write(MANAGE, p.entity_id):
        raise HTTPException(403, f"No permission to change the tests of plan {p.code}")


def _sync_plan(db: Session, plan_id: int | None) -> None:
    """A successful exercise updates the plan's last test date and the next test due date."""
    if not plan_id:
        return
    p = db.get(ContinuityPlan, plan_id)
    if not p:
        return
    last = db.scalar(
        select(Exercise.exercise_date)
        .where(Exercise.plan_id == plan_id, Exercise.result.in_(SUCCESS))
        .order_by(Exercise.exercise_date.desc())
        .limit(1)
    )
    if last and (p.last_tested is None or last > p.last_tested):
        p.last_tested = last
        p.next_test_due = add_months(last, p.test_interval_months or 12)


def _notify_failed(db: Session, pr: Principal, e: Exercise) -> None:
    if e.result != "failed" or not e.plan_id:
        return
    p = db.get(ContinuityPlan, e.plan_id)
    st = db.get(Stakeholder, p.owner_id) if p and p.owner_id else None
    if st and st.user_id:
        notify(
            db,
            st.user_id,
            "exercise_failed",
            f"{e.code} failed: {e.title}",
            f"/inventory/plans?exercise={e.id}",
            body=e.deviations,
            dedupe_key=f"exercise_failed:{e.id}",
            actor_id=pr.id,
        )


@router.post("/exercises")
def create_exercise(body: ExerciseIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr.ensure(MANAGE, body.entity_id, write=True)
    e = Exercise(
        code=next_code(db, Exercise.code, "EX-"),
        title=body.title,
        exercise_type=body.exercise_type,
        exercise_date=body.exercise_date,
        action_item_ids=[],
        task_ids=[],
    )
    _apply_exercise(db, pr, e, body)
    db.add(e)
    db.flush()
    _sync_plan(db, e.plan_id)
    _notify_failed(db, pr, e)
    audit(db, pr, "create", "exercise", e.id, f"{e.code} {e.title}", entity_id=e.entity_id)
    db.commit()
    index_object(db, "exercise", e.id)
    if e.plan_id:
        index_object(db, "continuity_plan", e.plan_id)
    return _exercise_detail(db, pr, e)


@router.get("/exercises/{exercise_id}")
def get_exercise(exercise_id: int, pr: Principal = Depends(require(READ)), db: Session = Depends(get_db)):
    return _exercise_detail(db, pr, _load_exercise(db, pr, exercise_id))


@router.put("/exercises/{exercise_id}")
def update_exercise(
    exercise_id: int, body: ExerciseIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    e = _load_exercise(db, pr, exercise_id, write=True)
    pr.ensure(MANAGE, body.entity_id, write=True)
    old_plan = e.plan_id
    diff = _apply_exercise(db, pr, e, body)
    db.flush()
    _sync_plan(db, e.plan_id)
    if "result" in diff:
        _notify_failed(db, pr, e)
    if diff:
        audit(db, pr, "update", "exercise", e.id, f"{e.code} {e.title}", entity_id=e.entity_id, details=diff)
    db.commit()
    index_object(db, "exercise", e.id)
    for pid in {old_plan, e.plan_id} - {None}:
        index_object(db, "continuity_plan", pid)
    return _exercise_detail(db, pr, e)


@router.delete("/exercises/{exercise_id}", response_model=Ok)
def delete_exercise(exercise_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    e = _load_exercise(db, pr, exercise_id, write=True)
    _ensure_links_writable(db, pr, e)
    audit(db, pr, "delete", "exercise", e.id, f"{e.code} {e.title}", entity_id=e.entity_id)
    cleanup_target(db, "exercise", e.id)
    db.delete(e)
    db.commit()
    remove_object(db, "exercise", exercise_id)
    return Ok()


@router.post("/exercises/{exercise_id}/actions")
def exercise_action(
    exercise_id: int,
    body: ExerciseActionIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    """Turn a deviation into an action plan item (needs findings.manage) or a task."""
    e = _load_exercise(db, pr, exercise_id, write=True)
    ent = body.entity_id if body.entity_id is not None else e.entity_id
    ref = f"From {EXERCISE_TYPES.get(e.exercise_type, e.exercise_type).lower()} {e.code} on {e.exercise_date}"
    if body.kind == "action_item":
        if ent is None:
            raise HTTPException(400, "Choose the entity the action plan item belongs to")
        item = create_action_item(
            db,
            pr,
            entity_id=ent,
            requirement_number=body.requirement_number or DEFAULT_REQUIREMENT.get(e.exercise_type, "4.1.4"),
            title=body.title,
            priority=body.priority,
            target_date=body.due_date,
            responsible_id=body.responsible_id,
            comments=f"{ref}." + (f" {body.description}" if body.description else ""),
        )
        e.action_item_ids = [*(e.action_item_ids or []), item.id]
        audit(db, pr, "update", "exercise", e.id, f"{e.code} action {item.code}", entity_id=e.entity_id)
        db.commit()
        reindex_after(db, action_item_id=item.id)
    else:
        if ent is not None and ent != e.entity_id:
            pr.ensure(MANAGE, ent, write=True)
        t = create_task(
            db,
            pr,
            entity_id=ent,
            title=body.title,
            description=f"{ref}." + (f"\n\n{body.description}" if body.description else ""),
            assignee_id=body.assignee_id,
            due_date=body.due_date,
            priority=body.priority,
        )
        e.task_ids = [*(e.task_ids or []), t.id]
        audit(db, pr, "update", "exercise", e.id, f"{e.code} task {t.key}", entity_id=e.entity_id)
        db.commit()
        reindex_after(db, task_id=t.id)
    return _exercise_detail(db, pr, e)
