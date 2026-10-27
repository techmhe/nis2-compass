from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.util import cleanup_target, get_or_404, next_code
from app.core.deps import Principal, require, require_global
from app.db import get_db
from app.models import (
    Activity,
    Gate,
    Phase,
    Project,
    RaciActivity,
    RaciCell,
    RaciColumn,
    RaidRecord,
    Task,
    WorkPackage,
)
from app.schemas.common import ORM, Ok, StakeholderBrief, UserBrief
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object, remove_object
from app.services.scoring import duration_weeks, raid_due_status, schedule_status

router = APIRouter(prefix="/projects", tags=["projects"])

Status = Literal["Not Started", "In Progress", "Completed", "Blocked", "Deferred", "Cancelled"]
Priority = Literal["High", "Medium", "Low"]
Rating = Literal["High", "Medium", "Low"]


class ProjectOut(ORM):
    id: int
    name: str
    code: str
    status: str
    planned_start: date | None
    planned_finish: date | None
    sponsor: str | None
    manager: UserBrief | None
    description: str | None
    overview: list
    version_note: str | None


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: str = Field(min_length=1, max_length=20)
    status: str = "In Progress"
    planned_start: date | None = None
    planned_finish: date | None = None
    sponsor: str | None = None
    manager_id: int | None = None
    description: str | None = None
    overview: list[dict] = []
    version_note: str | None = None


@router.get("", response_model=list[ProjectOut])
def list_projects(pr: Principal = Depends(require("projects.read")), db: Session = Depends(get_db)):
    return db.scalars(select(Project).order_by(Project.id)).all()


@router.post("", response_model=ProjectOut)
def create_project(
    body: ProjectIn, pr: Principal = Depends(require_global("projects.manage")), db: Session = Depends(get_db)
):
    if db.scalar(select(Project).where(Project.code == body.code)):
        raise HTTPException(409, "Project code exists")
    p = Project(**body.model_dump())
    db.add(p)
    db.flush()
    for i, name in enumerate(["1. Initiation", "2. Planning", "3. Execution", "4. Closure"]):
        db.add(Phase(project_id=p.id, name=name, sort_order=i))
    audit(db, pr, "create", "project", p.id, p.name)
    db.commit()
    index_object(db, "project", p.id)
    return p


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: int, pr: Principal = Depends(require("projects.read")), db: Session = Depends(get_db)
):
    return get_or_404(db, Project, project_id)


@router.put("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    body: ProjectIn,
    pr: Principal = Depends(require_global("projects.manage")),
    db: Session = Depends(get_db),
):
    p = get_or_404(db, Project, project_id)
    diff = apply_changes(p, body.model_dump())
    audit(db, pr, "update", "project", p.id, p.name, details=diff)
    db.commit()
    db.refresh(p)
    index_object(db, "project", p.id)
    return p


# --- phases ---------------------------------------------------------------------------------------------


class PhaseOut(ORM):
    id: int
    name: str
    sort_order: int


class PhaseIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sort_order: int = 0


@router.get("/{project_id}/phases", response_model=list[PhaseOut])
def list_phases(
    project_id: int, pr: Principal = Depends(require("projects.read")), db: Session = Depends(get_db)
):
    return db.scalars(select(Phase).where(Phase.project_id == project_id).order_by(Phase.sort_order)).all()


@router.post("/{project_id}/phases", response_model=PhaseOut)
def create_phase(
    project_id: int,
    body: PhaseIn,
    pr: Principal = Depends(require_global("projects.manage")),
    db: Session = Depends(get_db),
):
    get_or_404(db, Project, project_id)
    ph = Phase(project_id=project_id, **body.model_dump())
    db.add(ph)
    db.commit()
    return ph


@router.put("/phases/{phase_id}", response_model=PhaseOut)
def update_phase(
    phase_id: int,
    body: PhaseIn,
    pr: Principal = Depends(require_global("projects.manage")),
    db: Session = Depends(get_db),
):
    ph = get_or_404(db, Phase, phase_id)
    apply_changes(ph, body.model_dump())
    db.commit()
    return ph


@router.delete("/phases/{phase_id}", response_model=Ok)
def delete_phase(
    phase_id: int, pr: Principal = Depends(require_global("projects.manage")), db: Session = Depends(get_db)
):
    ph = get_or_404(db, Phase, phase_id)
    db.delete(ph)
    db.commit()
    return Ok()


# --- gates ----------------------------------------------------------------------------------------------


class GateOut(ORM):
    id: int
    project_id: int
    code: str
    planned_date: date | None
    actual_date: date | None
    decision: str | None
    decision_owner: StakeholderBrief | None
    required_input: str | None
    approval_criterion: str | None
    status: str
    decision_reference: str | None
    sort_order: int
    activities: int = 0
    open_activities: int = 0


class GateIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    planned_date: date | None = None
    actual_date: date | None = None
    decision: str | None = None
    decision_owner_id: int | None = None
    required_input: str | None = None
    approval_criterion: str | None = None
    status: Status = "Not Started"
    decision_reference: str | None = None
    sort_order: int = 0


@router.get("/{project_id}/gates", response_model=list[GateOut])
def list_gates(
    project_id: int, pr: Principal = Depends(require("projects.read")), db: Session = Depends(get_db)
):
    gates = db.scalars(select(Gate).where(Gate.project_id == project_id).order_by(Gate.sort_order)).all()
    acts = db.scalars(select(Activity).where(Activity.project_id == project_id)).all()
    out = []
    for g in gates:
        go = GateOut.model_validate(g)
        rel = [a for a in acts if a.gate_id == g.id]
        go.activities = len(rel)
        go.open_activities = sum(1 for a in rel if a.status != "Completed")
        out.append(go)
    return out


@router.post("/{project_id}/gates", response_model=GateOut)
def create_gate(
    project_id: int,
    body: GateIn,
    pr: Principal = Depends(require_global("projects.manage")),
    db: Session = Depends(get_db),
):
    get_or_404(db, Project, project_id)
    g = Gate(project_id=project_id, **body.model_dump())
    db.add(g)
    db.flush()
    audit(db, pr, "create", "gate", g.id, g.code)
    db.commit()
    index_object(db, "gate", g.id)
    return g


@router.put("/gates/{gate_id}", response_model=GateOut)
def update_gate(
    gate_id: int,
    body: GateIn,
    pr: Principal = Depends(require_global("projects.manage")),
    db: Session = Depends(get_db),
):
    g = get_or_404(db, Gate, gate_id)
    diff = apply_changes(g, body.model_dump())
    audit(db, pr, "update", "gate", g.id, g.code, details=diff)
    db.commit()
    db.refresh(g)
    index_object(db, "gate", g.id)
    return g


@router.delete("/gates/{gate_id}", response_model=Ok)
def delete_gate(
    gate_id: int, pr: Principal = Depends(require_global("projects.manage")), db: Session = Depends(get_db)
):
    g = get_or_404(db, Gate, gate_id)
    audit(db, pr, "delete", "gate", g.id, g.code)
    cleanup_target(db, "gate", g.id)
    db.delete(g)
    db.commit()
    remove_object(db, "gate", gate_id)
    return Ok()


# --- master plan activities -----------------------------------------------------------------------------


class ActivityOut(BaseModel):
    id: int
    project_id: int
    code: str
    phase: PhaseOut | None
    title: str
    owner: StakeholderBrief | None
    support: str | None
    planned_start: date | None
    planned_finish: date | None
    actual_finish: date | None
    duration_weeks: int | None
    dependencies: list[dict]
    deliverable: str | None
    gate: dict | None
    status: str
    priority: str
    progress: float
    schedule_status: str
    sort_order: int
    is_milestone: bool
    task_count: int = 0
    updated_at: datetime


def activity_out(a: Activity, task_counts: dict[int, int] | None = None) -> ActivityOut:
    return ActivityOut(
        id=a.id,
        project_id=a.project_id,
        code=a.code,
        phase=PhaseOut.model_validate(a.phase) if a.phase else None,
        title=a.title,
        owner=StakeholderBrief.model_validate(a.owner) if a.owner else None,
        support=a.support,
        planned_start=a.planned_start,
        planned_finish=a.planned_finish,
        actual_finish=a.actual_finish,
        duration_weeks=duration_weeks(a.planned_start, a.planned_finish),
        dependencies=[{"id": d.id, "code": d.code} for d in a.depends_on],
        deliverable=a.deliverable,
        gate={"id": a.gate.id, "code": a.gate.code, "planned_date": a.gate.planned_date} if a.gate else None,
        status=a.status,
        priority=a.priority,
        progress=a.progress,
        schedule_status=schedule_status(a.planned_start, a.planned_finish, a.status),
        sort_order=a.sort_order,
        is_milestone=a.is_milestone,
        task_count=(task_counts or {}).get(a.id, 0),
        updated_at=a.updated_at,
    )


class ActivityIn(BaseModel):
    code: str | None = Field(default=None, max_length=20)
    phase_id: int | None = None
    title: str = Field(min_length=1)
    owner_id: int | None = None
    support: str | None = None
    planned_start: date | None = None
    planned_finish: date | None = None
    actual_finish: date | None = None
    dependency_ids: list[int] = []
    deliverable: str | None = None
    gate_id: int | None = None
    status: Status = "Not Started"
    priority: Priority = "Medium"
    progress: float = Field(default=0, ge=0, le=1)
    sort_order: int | None = None
    is_milestone: bool = False


@router.get("/{project_id}/activities", response_model=list[ActivityOut])
def list_activities(
    project_id: int, pr: Principal = Depends(require("projects.read")), db: Session = Depends(get_db)
):
    from sqlalchemy import func

    counts = dict(
        db.execute(
            select(Task.activity_id, func.count())
            .where(Task.activity_id.is_not(None))
            .group_by(Task.activity_id)
        ).all()
    )
    acts = db.scalars(
        select(Activity).where(Activity.project_id == project_id).order_by(Activity.sort_order)
    ).all()
    return [activity_out(a, counts) for a in acts]


def _apply_activity(db: Session, a: Activity, body: ActivityIn) -> dict:
    data = body.model_dump(exclude={"dependency_ids", "code", "sort_order"})
    if body.planned_start and body.planned_finish and body.planned_finish < body.planned_start:
        raise HTTPException(400, "Planned finish is before planned start")
    if body.status == "Completed":
        data["progress"] = 1.0
    diff = apply_changes(a, data)
    if body.code:
        a.code = body.code
    if body.sort_order is not None:
        a.sort_order = body.sort_order
    deps = [get_or_404(db, Activity, i) for i in body.dependency_ids if i != a.id]
    if {d.id for d in deps} != {d.id for d in a.depends_on}:
        # reject cycles
        for d in deps:
            if _depends_on(d, a.id, set()):
                raise HTTPException(400, f"Dependency on {d.code} would create a cycle")
        a.depends_on = deps
        diff["dependencies"] = [d.code for d in deps]
    return diff


def _depends_on(act: Activity, target_id: int, seen: set[int]) -> bool:
    for d in act.depends_on:
        if d.id == target_id:
            return True
        if d.id not in seen:
            seen.add(d.id)
            if _depends_on(d, target_id, seen):
                return True
    return False


@router.post("/{project_id}/activities", response_model=ActivityOut)
def create_activity(
    project_id: int,
    body: ActivityIn,
    pr: Principal = Depends(require_global("projects.manage")),
    db: Session = Depends(get_db),
):
    get_or_404(db, Project, project_id)
    last = (
        db.scalar(
            select(Activity.sort_order)
            .where(Activity.project_id == project_id)
            .order_by(Activity.sort_order.desc())
            .limit(1)
        )
        or 0
    )
    code = body.code
    if not code:
        ph = db.get(Phase, body.phase_id) if body.phase_id else None
        prefix = f"P{(ph.sort_order + 1) if ph else 9}."
        code = next_code(db, Activity.code, prefix, width=0)
    a = Activity(project_id=project_id, code=code, title=body.title, sort_order=last + 1)
    db.add(a)
    db.flush()
    _apply_activity(db, a, body)
    audit(db, pr, "create", "activity", a.id, a.code)
    db.commit()
    index_object(db, "activity", a.id)
    return activity_out(a)


@router.put("/activities/{activity_id}", response_model=ActivityOut)
def update_activity(
    activity_id: int,
    body: ActivityIn,
    pr: Principal = Depends(require_global("projects.manage")),
    db: Session = Depends(get_db),
):
    a = get_or_404(db, Activity, activity_id)
    diff = _apply_activity(db, a, body)
    audit(db, pr, "update", "activity", a.id, a.code, details=diff)
    db.commit()
    db.refresh(a)
    index_object(db, "activity", a.id)
    return activity_out(a)


class ActivityPatch(BaseModel):
    status: Status | None = None
    progress: float | None = Field(default=None, ge=0, le=1)
    planned_start: date | None = None
    planned_finish: date | None = None


@router.patch("/activities/{activity_id}", response_model=ActivityOut)
def patch_activity(
    activity_id: int,
    body: ActivityPatch,
    pr: Principal = Depends(require_global("projects.manage")),
    db: Session = Depends(get_db),
):
    """Quick edits from the Gantt chart and plan table (drag to reschedule, status changes)."""
    a = get_or_404(db, Activity, activity_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("status") == "Completed":
        data["progress"] = 1.0
    diff = apply_changes(a, data)
    if a.planned_start and a.planned_finish and a.planned_finish < a.planned_start:
        raise HTTPException(400, "Planned finish is before planned start")
    audit(db, pr, "update", "activity", a.id, a.code, details=diff)
    db.commit()
    db.refresh(a)
    index_object(db, "activity", a.id)
    return activity_out(a)


@router.delete("/activities/{activity_id}", response_model=Ok)
def delete_activity(
    activity_id: int,
    pr: Principal = Depends(require_global("projects.manage")),
    db: Session = Depends(get_db),
):
    a = get_or_404(db, Activity, activity_id)
    audit(db, pr, "delete", "activity", a.id, a.code)
    cleanup_target(db, "activity", a.id)
    db.delete(a)
    db.commit()
    remove_object(db, "activity", activity_id)
    return Ok()


@router.get("/{project_id}/gantt")
def gantt(
    project_id: int,
    include_work_packages: bool = True,
    pr: Principal = Depends(require("projects.read")),
    db: Session = Depends(get_db),
):
    p = get_or_404(db, Project, project_id)
    acts = db.scalars(
        select(Activity).where(Activity.project_id == project_id).order_by(Activity.sort_order)
    ).all()
    gates = db.scalars(select(Gate).where(Gate.project_id == project_id).order_by(Gate.sort_order)).all()
    rows = [{"type": "activity", **activity_out(a).model_dump(mode="json")} for a in acts]
    if include_work_packages and pr.has_any("workpackages.read"):
        for w in db.scalars(
            select(WorkPackage).where(WorkPackage.project_id == project_id).order_by(WorkPackage.code)
        ):
            if not pr.can_read("workpackages.read", w.entity_id):
                continue
            rows.append(
                {
                    "type": "work_package",
                    "id": w.id,
                    "code": w.code,
                    "title": w.title,
                    "planned_start": w.planned_start,
                    "planned_finish": w.planned_finish,
                    "status": w.status,
                    "progress": w.progress,
                    "priority": w.priority,
                    "schedule_status": schedule_status(w.planned_start, w.planned_finish, w.status),
                    "phase": {"name": "Work packages"},
                }
            )
    dates = [d for r in rows for d in (r.get("planned_start"), r.get("planned_finish")) if d]
    dates += [g.planned_date for g in gates if g.planned_date]
    dates = [date.fromisoformat(d) if isinstance(d, str) else d for d in dates]
    return {
        "project": {
            "id": p.id,
            "name": p.name,
            "planned_start": p.planned_start,
            "planned_finish": p.planned_finish,
        },
        "start": min(dates) if dates else p.planned_start,
        "end": max(dates) if dates else p.planned_finish,
        "rows": rows,
        "gates": [
            {
                "id": g.id,
                "code": g.code,
                "planned_date": g.planned_date,
                "status": g.status,
                "decision": g.decision,
            }
            for g in gates
        ],
    }


# --- RACI -----------------------------------------------------------------------------------------------


@router.get("/{project_id}/raci")
def get_raci(
    project_id: int, pr: Principal = Depends(require("projects.read")), db: Session = Depends(get_db)
):
    cols = db.scalars(
        select(RaciColumn).where(RaciColumn.project_id == project_id).order_by(RaciColumn.sort_order)
    ).all()
    rows = db.scalars(
        select(RaciActivity).where(RaciActivity.project_id == project_id).order_by(RaciActivity.sort_order)
    ).all()
    cells = db.scalars(select(RaciCell).join(RaciActivity).where(RaciActivity.project_id == project_id)).all()
    return {
        "columns": [{"id": c.id, "name": c.name, "stakeholder_id": c.stakeholder_id} for c in cols],
        "rows": [{"id": r.id, "name": r.name} for r in rows],
        "cells": {f"{c.activity_id}:{c.column_id}": c.value for c in cells},
    }


class RaciIn(BaseModel):
    columns: list[dict]  # [{"id"?: int, "name": str, "stakeholder_id"?: int}]
    rows: list[dict]  # [{"id"?: int, "name": str}]
    cells: dict[str, str]  # {"rowIndex:colIndex": "R"} (indexes into the lists above)


@router.put("/{project_id}/raci", response_model=Ok)
def save_raci(
    project_id: int,
    body: RaciIn,
    pr: Principal = Depends(require_global("projects.manage")),
    db: Session = Depends(get_db),
):
    get_or_404(db, Project, project_id)
    valid = {"R", "A", "C", "I", "A/R", "-", ""}
    db.execute(
        delete(RaciCell).where(
            RaciCell.activity_id.in_(select(RaciActivity.id).where(RaciActivity.project_id == project_id))
        )
    )
    db.execute(delete(RaciActivity).where(RaciActivity.project_id == project_id))
    db.execute(delete(RaciColumn).where(RaciColumn.project_id == project_id))
    db.flush()
    cols, rows = [], []
    for i, c in enumerate(body.columns):
        col = RaciColumn(
            project_id=project_id,
            name=str(c["name"])[:200],
            stakeholder_id=c.get("stakeholder_id"),
            sort_order=i,
        )
        db.add(col)
        cols.append(col)
    for i, r in enumerate(body.rows):
        row = RaciActivity(project_id=project_id, name=str(r["name"])[:300], sort_order=i)
        db.add(row)
        rows.append(row)
    db.flush()
    for key, value in body.cells.items():
        if value not in valid:
            raise HTTPException(400, f"Invalid RACI value {value!r}")
        if not value:
            continue
        try:
            ri, ci = (int(x) for x in key.split(":"))
        except ValueError:
            raise HTTPException(400, f"Invalid cell key {key!r}") from None
        if 0 <= ri < len(rows) and 0 <= ci < len(cols):
            db.add(RaciCell(activity_id=rows[ri].id, column_id=cols[ci].id, value=value))
    audit(db, pr, "update", "raci", project_id, "RACI matrix")
    db.commit()
    return Ok()


# --- RAID -----------------------------------------------------------------------------------------------


class RaidOut(BaseModel):
    id: int
    project_id: int
    code: str
    type: str
    date_raised: date | None
    title: str
    impact: str | None
    probability: str | None
    severity: str | None
    owner: StakeholderBrief | None
    mitigation: str | None
    target_date: date | None
    status: str
    escalation_needed: bool
    resolution: str | None
    entity_id: int | None
    due_status: str | None
    updated_at: datetime


def raid_out(r: RaidRecord) -> RaidOut:
    return RaidOut(
        id=r.id,
        project_id=r.project_id,
        code=r.code,
        type=r.type,
        date_raised=r.date_raised,
        title=r.title,
        impact=r.impact,
        probability=r.probability,
        severity=r.severity,
        owner=StakeholderBrief.model_validate(r.owner) if r.owner else None,
        mitigation=r.mitigation,
        target_date=r.target_date,
        status=r.status,
        escalation_needed=r.escalation_needed,
        resolution=r.resolution,
        entity_id=r.entity_id,
        due_status=raid_due_status(r.target_date, r.status),
        updated_at=r.updated_at,
    )


class RaidIn(BaseModel):
    type: Literal["Risk", "Issue", "Decision", "Assumption"]
    date_raised: date | None = None
    title: str = Field(min_length=1)
    impact: Rating | None = None
    probability: Rating | None = None
    severity: Rating | None = None
    owner_id: int | None = None
    mitigation: str | None = None
    target_date: date | None = None
    status: Literal["Open", "In Progress", "Closed", "Accepted", "Escalated"] = "Open"
    escalation_needed: bool = False
    resolution: str | None = None
    entity_id: int | None = None


def _severity(impact: str | None, probability: str | None) -> str | None:
    if not impact or not probability:
        return None
    score = {"Low": 1, "Medium": 2, "High": 3}
    v = score[impact] * score[probability]
    return "High" if v >= 6 else "Medium" if v >= 3 else "Low"


@router.get("/{project_id}/raid", response_model=list[RaidOut])
def list_raid(
    project_id: int, pr: Principal = Depends(require("projects.read")), db: Session = Depends(get_db)
):
    rows = db.scalars(
        select(RaidRecord).where(RaidRecord.project_id == project_id).order_by(RaidRecord.id)
    ).all()
    return [raid_out(r) for r in rows if pr.can_read("projects.read", r.entity_id)]


@router.post("/{project_id}/raid", response_model=RaidOut)
def create_raid(
    project_id: int,
    body: RaidIn,
    pr: Principal = Depends(require_global("projects.manage")),
    db: Session = Depends(get_db),
):
    get_or_404(db, Project, project_id)
    prefix = body.type[0]
    codes = db.scalars(
        select(RaidRecord.code).where(RaidRecord.project_id == project_id, RaidRecord.code.like(f"{prefix}%"))
    ).all()
    n = max([int(c[1:]) for c in codes if c[1:].isdigit()] or [0]) + 1
    data = body.model_dump()
    if not data.get("severity"):
        data["severity"] = _severity(body.impact, body.probability)
    r = RaidRecord(project_id=project_id, code=f"{prefix}{n}", **data)
    if not r.date_raised:
        r.date_raised = date.today()
    db.add(r)
    db.flush()
    audit(db, pr, "create", "raid", r.id, r.code)
    db.commit()
    index_object(db, "raid", r.id)
    return raid_out(r)


@router.put("/raid/{raid_id}", response_model=RaidOut)
def update_raid(
    raid_id: int,
    body: RaidIn,
    pr: Principal = Depends(require_global("projects.manage")),
    db: Session = Depends(get_db),
):
    r = get_or_404(db, RaidRecord, raid_id)
    data = body.model_dump()
    if not data.get("severity"):
        data["severity"] = _severity(body.impact, body.probability)
    diff = apply_changes(r, data)
    audit(db, pr, "update", "raid", r.id, r.code, details=diff)
    db.commit()
    db.refresh(r)
    index_object(db, "raid", r.id)
    return raid_out(r)


@router.delete("/raid/{raid_id}", response_model=Ok)
def delete_raid(
    raid_id: int, pr: Principal = Depends(require_global("projects.manage")), db: Session = Depends(get_db)
):
    r = get_or_404(db, RaidRecord, raid_id)
    audit(db, pr, "delete", "raid", r.id, r.code)
    cleanup_target(db, "raid", r.id)
    db.delete(r)
    db.commit()
    remove_object(db, "raid", raid_id)
    return Ok()
