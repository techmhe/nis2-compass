"""KPI catalogue, instances per entity/group, values (manual or computed), trends and dashboard tiles."""

import csv
import io
import math
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.util import get_or_404, user_names
from app.core.deps import Principal, build_principal, get_principal, require
from app.db import get_db
from app.features.controls.kpi import (
    COMPUTATIONS,
    compute,
    ensure_instances,
    is_stale,
    period_bounds,
    period_label,
    recent_periods,
    refresh_computed,
    status_of,
    upsert_value,
    valid_period,
)
from app.features.controls.models import MetricDefinition, MetricInstance, MetricValue
from app.features.controls.schedule import today
from app.models import Entity, User
from app.schemas.common import Ok
from app.services.audit import apply_changes, audit

router = APIRouter(prefix="/kpis")


def _fin(v: float | None) -> float | None:
    """Stored numbers that are not finite (legacy bad data) are treated as missing; JSON cannot carry them."""
    return v if v is not None and math.isfinite(v) else None


def _def_out(d: MetricDefinition, n_instances: int | None = None) -> dict:
    return {
        "id": d.id,
        "code": d.code,
        "name": d.name,
        "unit": d.unit,
        "direction": d.direction,
        "description": d.description,
        "legal_refs": d.legal_refs,
        "default_target": _fin(d.default_target),
        "frequency": d.frequency,
        "computation": d.computation,
        "computation_label": COMPUTATIONS[d.computation][0] if d.computation in COMPUTATIONS else None,
        "active": d.active,
        "sort_order": d.sort_order,
        "instances": n_instances,
    }


def _values(db: Session, inst_ids: list[int]) -> dict[int, list[MetricValue]]:
    out: dict[int, list[MetricValue]] = {i: [] for i in inst_ids}
    if inst_ids:
        for v in db.scalars(
            select(MetricValue).where(MetricValue.instance_id.in_(inst_ids)).order_by(MetricValue.period_end)
        ):
            if _fin(v.value) is not None:
                out[v.instance_id].append(v)
    return out


def _val(v: MetricValue | None, names: dict[int, str] | None = None) -> dict | None:
    if v is None:
        return None
    return {
        "period": v.period,
        "label": period_label(v.period),
        "period_end": v.period_end,
        "value": v.value,
        "source": v.source,
        "note": v.note,
        "recorded_by": (names or {}).get(v.recorded_by_id) if v.recorded_by_id else None,
        "updated_at": v.updated_at,
    }


def _can_enter(pr: Principal, inst: MetricInstance) -> bool:
    return pr.can_write("controls.manage", inst.entity_id) or (
        inst.owner_user_id == pr.id and pr.can_read("controls.read", inst.entity_id)
    )


def _inst_out(
    pr: Principal, inst: MetricInstance, values: list[MetricValue], names: dict[int, str], trend_n: int = 8
) -> dict:
    d = inst.definition
    own = _fin(inst.target)
    target = own if own is not None else _fin(d.default_target)
    latest = values[-1] if values else None
    prev = values[-2] if len(values) > 1 else None
    return {
        "id": inst.id,
        "definition_id": d.id,
        "entity": {"id": inst.entity.id, "code": inst.entity.code, "name": inst.entity.name}
        if inst.entity
        else None,
        "target": own,
        "effective_target": target,
        "owner_user_id": inst.owner_user_id,
        "owner_name": names.get(inst.owner_user_id) if inst.owner_user_id else None,
        "latest": _val(latest),
        "previous": _val(prev),
        "status": status_of(d.direction, latest.value if latest else None, target),
        "stale": is_stale(d.frequency, latest.period if latest else None),
        "trend": [
            {"period": v.period, "label": period_label(v.period), "value": v.value} for v in values[-trend_n:]
        ],
        "can_edit": pr.can_write("controls.manage", inst.entity_id),
        "can_enter": _can_enter(pr, inst),
    }


def _check_owner(db: Session, user_id: int | None, entity_id: int | None) -> None:
    """A KPI owner must be an active user who can read the controls of the instance's scope."""
    if not user_id:
        return
    u = db.get(User, user_id)
    if not u or not u.is_active or not build_principal(u).can_read("controls.read", entity_id):
        raise HTTPException(
            422, "The owner must be an active user with read access to controls of this entity"
        )


# --- definitions ---------------------------------------------------------------------------------------------


class DefinitionIn(BaseModel):
    code: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$")
    name: str = Field(min_length=1, max_length=200)
    unit: Literal["%", "count", "days", "hours", "EUR"] = "%"
    direction: Literal["higher", "lower"] = "higher"
    description: str | None = Field(default=None, max_length=4000)
    legal_refs: str | None = Field(default=None, max_length=400)
    default_target: float | None = Field(default=None, allow_inf_nan=False, ge=-1e12, le=1e12)
    frequency: Literal["monthly", "quarterly", "annual"] = "quarterly"
    computation: str | None = None
    active: bool = True
    sort_order: int = Field(default=0, ge=-10000, le=10000)
    create_instances: bool = True


@router.get("/definitions")
def list_definitions(pr: Principal = Depends(require("controls.read")), db: Session = Depends(get_db)):
    counts = dict(
        db.execute(
            select(MetricInstance.definition_id, func.count(MetricInstance.id)).group_by(
                MetricInstance.definition_id
            )
        ).all()
    )
    defs = db.scalars(
        select(MetricDefinition).order_by(MetricDefinition.sort_order, MetricDefinition.code)
    ).all()
    return {
        "items": [_def_out(d, counts.get(d.id, 0)) for d in defs],
        "computations": {k: v[0] for k, v in COMPUTATIONS.items()},
        "can_manage": pr.can_write("controls.manage", None),
    }


def _check_def(db: Session, body: DefinitionIn, current: MetricDefinition | None) -> None:
    if body.computation and body.computation not in COMPUTATIONS:
        raise HTTPException(422, "Unknown computation")
    other = db.scalar(select(MetricDefinition).where(func.lower(MetricDefinition.code) == body.code.lower()))
    if other and (current is None or other.id != current.id):
        raise HTTPException(409, "A KPI with this code already exists")
    if body.default_target is not None and not math.isfinite(body.default_target):
        raise HTTPException(422, "Invalid target")


@router.post("/definitions")
def create_definition(
    body: DefinitionIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    pr.ensure("controls.manage", None, write=True)
    _check_def(db, body, None)
    d = MetricDefinition(**body.model_dump(exclude={"create_instances"}))
    db.add(d)
    db.flush()
    if body.create_instances:
        ensure_instances(db, d)
    audit(db, pr, "create", "kpi_definition", d.id, f"{d.code} {d.name}")
    db.commit()
    if d.computation:
        refresh_computed(db)
        db.commit()
    return _def_out(d)


@router.put("/definitions/{definition_id}")
def update_definition(
    definition_id: int,
    body: DefinitionIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    pr.ensure("controls.manage", None, write=True)
    d = get_or_404(db, MetricDefinition, definition_id, "KPI")
    _check_def(db, body, d)
    diff = apply_changes(d, body.model_dump(exclude={"create_instances"}))
    if body.create_instances:
        ensure_instances(db, d)
    audit(db, pr, "update", "kpi_definition", d.id, f"{d.code} {d.name}", details=diff)
    db.commit()
    return _def_out(d)


@router.delete("/definitions/{definition_id}", response_model=Ok)
def delete_definition(
    definition_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    pr.ensure("controls.manage", None, write=True)
    d = get_or_404(db, MetricDefinition, definition_id, "KPI")
    has_values = db.scalar(
        select(func.count(MetricValue.id))
        .join(MetricInstance)
        .where(MetricInstance.definition_id == d.id, MetricValue.source != "computed")
    )
    if has_values:
        raise HTTPException(400, "The KPI has recorded values. Deactivate it instead to keep the history.")
    audit(db, pr, "delete", "kpi_definition", d.id, f"{d.code} {d.name}")
    db.delete(d)
    db.commit()
    return Ok()


# --- overview, instances, values -----------------------------------------------------------------------------


@router.get("/overview")
def overview(
    entity: str | None = None,
    pr: Principal = Depends(require("controls.read")),
    db: Session = Depends(get_db),
):
    """Per active KPI: the visible instances with latest value, status against target and trend.
    `entity` = entity id, "group" for group-wide instances only, or omitted for all."""
    defs = db.scalars(
        select(MetricDefinition)
        .where(MetricDefinition.active.is_(True))
        .order_by(MetricDefinition.sort_order, MetricDefinition.code)
    ).all()
    stmt = select(MetricInstance).where(MetricInstance.definition_id.in_([d.id for d in defs]))
    if entity == "group":
        stmt = stmt.where(MetricInstance.entity_id.is_(None))
    elif entity:
        try:
            stmt = stmt.where(MetricInstance.entity_id == int(entity))
        except ValueError:
            raise HTTPException(422, "entity must be an entity id or 'group'") from None
    insts = [i for i in db.scalars(stmt) if pr.can_read("controls.read", i.entity_id)]
    vals = _values(db, [i.id for i in insts])
    names = user_names(db, [i.owner_user_id for i in insts])
    ents = {e.id: e.sort_order for e in db.scalars(select(Entity))}
    by_def: dict[int, list] = {d.id: [] for d in defs}
    for i in sorted(insts, key=lambda x: (x.entity_id is not None, ents.get(x.entity_id, 0))):
        by_def[i.definition_id].append(_inst_out(pr, i, vals[i.id], names))
    return {
        "items": [{**_def_out(d), "instance_rows": by_def[d.id]} for d in defs if by_def[d.id]],
        "can_manage": pr.can_write("controls.manage", None),
    }


@router.get("/instances/{instance_id}")
def get_instance(
    instance_id: int, pr: Principal = Depends(require("controls.read")), db: Session = Depends(get_db)
):
    inst = get_or_404(db, MetricInstance, instance_id, "KPI instance")
    pr.ensure("controls.read", inst.entity_id)
    values = _values(db, [inst.id])[inst.id]
    names = user_names(db, [inst.owner_user_id] + [v.recorded_by_id for v in values])
    d = inst.definition
    return {
        "definition": _def_out(d),
        "instance": _inst_out(pr, inst, values, names, trend_n=60),
        "values": [_val(v, names) for v in reversed(values)],
        "open_periods": recent_periods(d.frequency, today(), 8),
    }


class InstanceIn(BaseModel):
    definition_id: int
    entity_id: int | None = None
    target: float | None = Field(default=None, allow_inf_nan=False, ge=-1e12, le=1e12)
    owner_user_id: int | None = None


@router.post("/instances")
def create_instance(body: InstanceIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr.ensure("controls.manage", body.entity_id, write=True)
    d = get_or_404(db, MetricDefinition, body.definition_id, "KPI")
    if body.entity_id is not None:
        get_or_404(db, Entity, body.entity_id, "Entity")
    if db.scalar(
        select(MetricInstance.id).where(
            MetricInstance.definition_id == d.id,
            MetricInstance.entity_id.is_(None)
            if body.entity_id is None
            else MetricInstance.entity_id == body.entity_id,
        )
    ):
        raise HTTPException(409, "This KPI is already measured for this scope")
    _check_owner(db, body.owner_user_id, body.entity_id)
    inst = MetricInstance(
        definition_id=d.id,
        entity_id=body.entity_id,
        target=body.target if body.target is not None else _fin(d.default_target),
        owner_user_id=body.owner_user_id,
    )
    db.add(inst)
    db.flush()
    audit(db, pr, "create", "kpi_instance", inst.id, d.code, entity_id=inst.entity_id)
    db.commit()
    return get_instance(inst.id, pr, db)


class InstanceUpdate(BaseModel):
    target: float | None = Field(default=None, allow_inf_nan=False, ge=-1e12, le=1e12)
    owner_user_id: int | None = None


@router.put("/instances/{instance_id}")
def update_instance(
    instance_id: int,
    body: InstanceUpdate,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    inst = get_or_404(db, MetricInstance, instance_id, "KPI instance")
    pr.ensure("controls.manage", inst.entity_id, write=True)
    _check_owner(db, body.owner_user_id, inst.entity_id)
    if body.target is not None and not math.isfinite(body.target):
        raise HTTPException(422, "Invalid target")
    diff = apply_changes(inst, body.model_dump())
    audit(
        db,
        pr,
        "update",
        "kpi_instance",
        inst.id,
        inst.definition.code,
        entity_id=inst.entity_id,
        details=diff,
    )
    db.commit()
    return get_instance(inst.id, pr, db)


@router.delete("/instances/{instance_id}", response_model=Ok)
def delete_instance(instance_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    inst = get_or_404(db, MetricInstance, instance_id, "KPI instance")
    pr.ensure("controls.manage", inst.entity_id, write=True)
    audit(db, pr, "delete", "kpi_instance", inst.id, inst.definition.code, entity_id=inst.entity_id)
    db.delete(inst)
    db.commit()
    return Ok()


def _check_value(pr: Principal, inst: MetricInstance, period: str, value: float) -> None:
    """Who may record the value, and whether period and value are valid for the KPI (manual entry and import)."""
    if not _can_enter(pr, inst):
        raise HTTPException(403, "Only the KPI owner or a control manager for this entity can enter values")
    d = inst.definition
    if not valid_period(d.frequency, period):
        raise HTTPException(422, f"'{period}' is not a valid {d.frequency} period")
    if period_bounds(period)[0] > today():
        raise HTTPException(422, "Values cannot be entered for future periods")
    if (
        not math.isfinite(value)
        or (d.unit == "%" and not 0 <= value <= 100)
        or (d.unit in ("count", "days", "hours") and value < 0)
    ):
        raise HTTPException(422, "The value is out of range for this unit")


class ValueIn(BaseModel):
    value: float = Field(allow_inf_nan=False, ge=-1e12, le=1e12)
    note: str | None = Field(default=None, max_length=2000)


@router.put("/instances/{instance_id}/values/{period}")
def put_value(
    instance_id: int,
    period: str,
    body: ValueIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    inst = get_or_404(db, MetricInstance, instance_id, "KPI instance")
    pr.ensure("controls.read", inst.entity_id)
    _check_value(pr, inst, period, body.value)
    d = inst.definition
    v = upsert_value(db, inst, period, body.value, "manual", (body.note or "").strip() or None, pr.id)
    audit(
        db, pr, "record", "kpi_value", inst.id, f"{d.code} {period} = {body.value}", entity_id=inst.entity_id
    )
    db.commit()
    return _val(v, user_names(db, [pr.id]))


@router.delete("/instances/{instance_id}/values/{period}", response_model=Ok)
def delete_value(
    instance_id: int, period: str, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    inst = get_or_404(db, MetricInstance, instance_id, "KPI instance")
    pr.ensure("controls.read", inst.entity_id)
    if not _can_enter(pr, inst):
        raise HTTPException(403, "Only the KPI owner or a control manager for this entity can remove values")
    v = db.scalar(select(MetricValue).where(MetricValue.instance_id == inst.id, MetricValue.period == period))
    if v is None:
        raise HTTPException(404, "No value for this period")
    audit(
        db, pr, "delete", "kpi_value", inst.id, f"{inst.definition.code} {period}", entity_id=inst.entity_id
    )
    db.delete(v)
    db.commit()
    return Ok()


IMPORT_COLUMNS = ["kpi_code", "entity_code", "period", "value", "note"]


@router.post("/import")
async def import_values(
    file: UploadFile = File(...),
    dry_run: bool = True,
    pr: Principal = Depends(require("controls.read")),
    db: Session = Depends(get_db),
):
    """CSV import of KPI values (columns kpi_code, entity_code or "group", period, value, optional note), e.g. exported
    by a script from Entra ID, Intune, Defender or the backup software. Validates every row like manual entry;
    with dry_run nothing is stored. Computed KPIs are skipped."""
    raw = await file.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(413, "The file is larger than 2 MB")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(422, "The file must be UTF-8 encoded CSV") from None
    sample = text[:2048]
    reader = csv.DictReader(
        io.StringIO(text), delimiter=";" if sample.count(";") > sample.count(",") else ","
    )
    missing = {"kpi_code", "entity_code", "period", "value"} - set(reader.fieldnames or [])
    if missing:
        raise HTTPException(422, f"Missing columns: {', '.join(sorted(missing))}")
    defs = {d.code.lower(): d for d in db.scalars(select(MetricDefinition))}
    ents = {e.code.lower(): e.id for e in db.scalars(select(Entity))}
    results, ok = [], 0
    for n, row in enumerate(reader, start=2):
        if n > 5001:
            raise HTTPException(422, "At most 5000 rows per file")
        code, ent, period = (
            (row.get("kpi_code") or "").strip(),
            (row.get("entity_code") or "").strip(),
            (row.get("period") or "").strip(),
        )
        try:
            d = defs.get(code.lower())
            if not d:
                raise HTTPException(422, f"Unknown KPI '{code}'")
            if d.computation:
                raise HTTPException(422, "This KPI is computed automatically")
            eid = None if ent.lower() in ("", "group") else ents.get(ent.lower(), -1)
            if eid == -1:
                raise HTTPException(422, f"Unknown entity '{ent}'")
            inst = db.scalar(
                select(MetricInstance).where(
                    MetricInstance.definition_id == d.id,
                    MetricInstance.entity_id.is_(None) if eid is None else MetricInstance.entity_id == eid,
                )
            )
            if not inst or not pr.can_read("controls.read", inst.entity_id):
                raise HTTPException(422, f"KPI '{code}' is not tracked for {ent or 'group'}")
            try:
                value = float((row.get("value") or "").strip().replace(",", "."))
            except ValueError:
                raise HTTPException(422, "The value is not a number") from None
            _check_value(pr, inst, period, value)
            if not dry_run:
                upsert_value(
                    db, inst, period, value, "import", ((row.get("note") or "").strip()[:2000]) or None, pr.id
                )
            ok += 1
            results.append(
                {
                    "row": n,
                    "kpi": code,
                    "entity": ent or "group",
                    "period": period,
                    "value": value,
                    "ok": True,
                }
            )
        except HTTPException as e:
            results.append(
                {
                    "row": n,
                    "kpi": code,
                    "entity": ent or "group",
                    "period": period,
                    "ok": False,
                    "error": e.detail,
                }
            )
    if not dry_run and ok:
        audit(db, pr, "import", "kpi_value", None, f"{ok} KPI values from {file.filename or 'CSV'}")
        db.commit()
    return {"dry_run": dry_run, "valid": ok, "invalid": len(results) - ok, "rows": results[:500]}


@router.get("/grid")
def grid(
    entity: str = "group",
    periods: int = 6,
    pr: Principal = Depends(require("controls.read")),
    db: Session = Depends(get_db),
):
    """Entry grid for one scope: rows = active KPIs, columns = the last `periods` periods of each KPI's frequency."""
    entity_id: int | None = None
    if entity != "group":
        try:
            entity_id = int(entity)
        except ValueError:
            raise HTTPException(422, "entity must be an entity id or 'group'") from None
    pr.ensure("controls.read", entity_id)
    periods = max(1, min(periods, 12))
    stmt = (
        select(MetricInstance)
        .join(MetricDefinition)
        .where(MetricDefinition.active.is_(True))
        .order_by(MetricDefinition.sort_order, MetricDefinition.code)
    )
    stmt = stmt.where(
        MetricInstance.entity_id.is_(None) if entity_id is None else MetricInstance.entity_id == entity_id
    )
    insts = list(db.scalars(stmt))
    vals = _values(db, [i.id for i in insts])
    names = user_names(db, [i.owner_user_id for i in insts])
    ref = today()
    rows = []
    for inst in insts:
        d = inst.definition
        keys = recent_periods(d.frequency, ref, periods)
        by_p = {v.period: v for v in vals[inst.id]}
        rows.append(
            {
                "instance": _inst_out(pr, inst, vals[inst.id], names),
                "definition": _def_out(d),
                "periods": [
                    {"period": k, "label": period_label(k), "value": _val(by_p.get(k))} for k in keys
                ],
            }
        )
    return {"entity_id": entity_id, "rows": rows}


@router.post("/recompute")
def recompute(backfill: int = 0, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Recompute computed KPIs now; `backfill` also recomputes that many past periods of period-based KPIs."""
    pr.ensure("controls.manage", None, write=True)
    n = refresh_computed(db)
    backfill = max(0, min(backfill, 12))
    if backfill:
        for inst in db.scalars(
            select(MetricInstance)
            .join(MetricDefinition)
            .where(MetricDefinition.active.is_(True), MetricDefinition.computation.is_not(None))
        ):
            d = inst.definition
            if d.computation not in COMPUTATIONS or COMPUTATIONS[d.computation][2]:
                continue
            for k in recent_periods(d.frequency, today(), backfill + 1)[:-1]:
                val = compute(db, d.computation, inst.entity_id, k)
                if val is not None:
                    upsert_value(db, inst, k, val, "computed")
                    n += 1
    audit(db, pr, "recompute", "kpi", None, f"{n} values")
    db.commit()
    return {"values": n}


@router.get("/tiles")
def tiles(pr: Principal = Depends(require("controls.read")), db: Session = Depends(get_db)):
    """Dashboard tiles: the group-wide instance of every active KPI with latest value, target, status and trend."""
    insts = list(
        db.scalars(
            select(MetricInstance)
            .join(MetricDefinition)
            .where(MetricDefinition.active.is_(True), MetricInstance.entity_id.is_(None))
            .order_by(MetricDefinition.sort_order, MetricDefinition.code)
        )
    )
    vals = _values(db, [i.id for i in insts])
    out = []
    for inst in insts:
        d = inst.definition
        row = _inst_out(pr, inst, vals[inst.id], {}, trend_n=6)
        out.append(
            {
                "instance_id": inst.id,
                "code": d.code,
                "name": d.name,
                "unit": d.unit,
                "direction": d.direction,
                "frequency": d.frequency,
                "value": row["latest"]["value"] if row["latest"] else None,
                "period": row["latest"]["label"] if row["latest"] else None,
                "previous": row["previous"]["value"] if row["previous"] else None,
                "target": row["effective_target"],
                "status": row["status"],
                "stale": row["stale"],
                "trend": row["trend"],
                "url": f"/controls/kpis?instance={inst.id}",
            }
        )
    return out
