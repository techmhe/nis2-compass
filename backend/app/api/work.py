"""Work packages, tasks, comments and notifications."""

from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.api.util import check_target, cleanup_target, doc_links_for, get_or_404, next_code
from app.core.deps import Principal, get_principal, require
from app.db import get_db, utcnow
from app.models import ActionItem, Comment, Notification, Project, Task, User, WorkPackage
from app.schemas.common import CommentIn, CommentOut, EntityBrief, Ok, StakeholderBrief, UserBrief
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object, remove_object
from app.services.notify import notify
from app.services.scoring import schedule_status

router = APIRouter(tags=["work"])

Priority = Literal["High", "Medium", "Low"]
WPStatus = Literal["Not Started", "In Progress", "Completed", "Blocked", "Deferred", "Cancelled"]
TaskStatus = Literal["todo", "in_progress", "review", "done", "blocked"]


# --- work packages --------------------------------------------------------------------------------------


class WorkPackageOut(BaseModel):
    id: int
    project_id: int
    code: str
    title: str
    description: str | None
    entity: EntityBrief | None
    measure_area: str | None
    central_or_local: str
    priority: str
    owner: UserBrief | None
    owner_stakeholder: StakeholderBrief | None
    planned_start: date | None
    planned_finish: date | None
    acceptance_criterion: str | None
    expected_evidence: str | None
    dependency: str | None
    status: str
    progress: float
    progress_mode: str
    budget_eur: float | None
    comments: str | None
    activity_id: int | None
    schedule_status: str
    findings: list[dict]
    task_stats: dict
    updated_at: datetime


def _task_stats(db: Session, wp_ids: list[int]) -> dict[int, dict]:
    rows = db.execute(
        select(Task.work_package_id, Task.status, func.count())
        .where(Task.work_package_id.in_(wp_ids))
        .group_by(Task.work_package_id, Task.status)
    ).all()
    out: dict[int, dict] = {}
    for wid, st, n in rows:
        d = out.setdefault(wid, {"total": 0, "done": 0, "by_status": {}})
        d["total"] += n
        d["by_status"][st] = n
        if st == "done":
            d["done"] = n
    return out


def wp_out(w: WorkPackage, stats: dict[int, dict]) -> WorkPackageOut:
    ts = stats.get(w.id, {"total": 0, "done": 0, "by_status": {}})
    progress = w.progress
    if w.progress_mode == "tasks" and ts["total"]:
        progress = ts["done"] / ts["total"]
    if w.status == "Completed":
        progress = 1.0
    return WorkPackageOut(
        id=w.id,
        project_id=w.project_id,
        code=w.code,
        title=w.title,
        description=w.description,
        entity=EntityBrief.model_validate(w.entity) if w.entity else None,
        measure_area=w.measure_area,
        central_or_local=w.central_or_local,
        priority=w.priority,
        owner=UserBrief.model_validate(w.owner) if w.owner else None,
        owner_stakeholder=StakeholderBrief.model_validate(w.owner_stakeholder)
        if w.owner_stakeholder
        else None,
        planned_start=w.planned_start,
        planned_finish=w.planned_finish,
        acceptance_criterion=w.acceptance_criterion,
        expected_evidence=w.expected_evidence,
        dependency=w.dependency,
        status=w.status,
        progress=progress,
        progress_mode=w.progress_mode,
        budget_eur=w.budget_eur,
        comments=w.comments,
        activity_id=w.activity_id,
        schedule_status=schedule_status(w.planned_start, w.planned_finish, w.status),
        findings=[
            {
                "id": f.id,
                "code": f.code,
                "entity_code": f.entity.code,
                "requirement": f.requirement.number,
                "title": f.title,
                "status": f.status,
            }
            for f in w.findings
        ],
        task_stats=ts,
        updated_at=w.updated_at,
    )


@router.get("/work-packages", response_model=list[WorkPackageOut])
def list_work_packages(
    project_id: int | None = None,
    pr: Principal = Depends(require("workpackages.read")),
    db: Session = Depends(get_db),
):
    stmt = select(WorkPackage).order_by(WorkPackage.code)
    if project_id:
        stmt = stmt.where(WorkPackage.project_id == project_id)
    wps = [w for w in db.scalars(stmt) if pr.can_read("workpackages.read", w.entity_id)]
    stats = _task_stats(db, [w.id for w in wps])
    return [wp_out(w, stats) for w in wps]


class WorkPackageIn(BaseModel):
    project_id: int | None = None
    title: str = Field(min_length=1)
    description: str | None = None
    entity_id: int | None = None
    measure_area: str | None = None
    central_or_local: Literal["Central", "Local"] = "Central"
    priority: Priority = "Medium"
    owner_id: int | None = None
    owner_stakeholder_id: int | None = None
    planned_start: date | None = None
    planned_finish: date | None = None
    acceptance_criterion: str | None = None
    expected_evidence: str | None = None
    dependency: str | None = None
    status: WPStatus = "Not Started"
    progress: float = Field(default=0, ge=0, le=1)
    progress_mode: Literal["tasks", "manual"] = "tasks"
    budget_eur: float | None = None
    comments: str | None = None
    activity_id: int | None = None
    finding_ids: list[int] | None = None  # action item ids


def _set_findings(db: Session, pr: Principal, w: WorkPackage, ids: list[int]) -> None:
    items = []
    for i in ids:
        it = get_or_404(db, ActionItem, i)
        pr.ensure("findings.read", it.entity_id)
        items.append(it)
    w.findings = items


@router.post("/work-packages", response_model=WorkPackageOut)
def create_work_package(
    body: WorkPackageIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    pr.ensure("workpackages.manage", body.entity_id, write=True)
    project_id = body.project_id or db.scalar(select(Project.id).order_by(Project.id))
    if not project_id:
        raise HTTPException(400, "No project exists")
    w = WorkPackage(
        project_id=project_id,
        code=next_code(db, WorkPackage.code, "WP-"),
        **body.model_dump(exclude={"finding_ids", "project_id"}),
    )
    db.add(w)
    db.flush()
    if body.finding_ids:
        _set_findings(db, pr, w, body.finding_ids)
    audit(db, pr, "create", "work_package", w.id, w.code, entity_id=w.entity_id)
    notify(
        db,
        w.owner_id,
        "wp_assigned",
        f"You own work package {w.code}: {w.title[:120]}",
        f"/work-packages/{w.id}",
        actor_id=pr.id,
    )
    db.commit()
    index_object(db, "work_package", w.id)
    return wp_out(w, _task_stats(db, [w.id]))


@router.get("/work-packages/{wp_id}")
def get_work_package(
    wp_id: int, pr: Principal = Depends(require("workpackages.read")), db: Session = Depends(get_db)
):
    w = get_or_404(db, WorkPackage, wp_id)
    pr.ensure("workpackages.read", w.entity_id)
    tasks = db.scalars(
        select(Task).where(Task.work_package_id == w.id).order_by(Task.sort_order, Task.id)
    ).all()
    return {
        "work_package": wp_out(w, _task_stats(db, [w.id])),
        "tasks": [task_out(t) for t in tasks],
        "documents": doc_links_for(db, pr, "work_package", w.id),
        "can_edit": pr.can_write("workpackages.manage", w.entity_id),
    }


@router.put("/work-packages/{wp_id}", response_model=WorkPackageOut)
def update_work_package(
    wp_id: int, body: WorkPackageIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    w = get_or_404(db, WorkPackage, wp_id)
    pr.ensure("workpackages.manage", w.entity_id, write=True)
    pr.ensure("workpackages.manage", body.entity_id, write=True)
    old_owner = w.owner_id
    data = body.model_dump(exclude={"finding_ids", "project_id"})
    if data["status"] == "Completed" and w.status != "Completed":
        w.completed_at = utcnow()
    diff = apply_changes(w, data)
    if body.finding_ids is not None:
        _set_findings(db, pr, w, body.finding_ids)
    if w.owner_id != old_owner:
        notify(
            db,
            w.owner_id,
            "wp_assigned",
            f"You own work package {w.code}: {w.title[:120]}",
            f"/work-packages/{w.id}",
            actor_id=pr.id,
        )
    audit(db, pr, "update", "work_package", w.id, w.code, entity_id=w.entity_id, details=diff)
    db.commit()
    db.refresh(w)  # reload relationships (owner, entity, findings) changed via their foreign keys
    index_object(db, "work_package", w.id)
    return wp_out(w, _task_stats(db, [w.id]))


@router.delete("/work-packages/{wp_id}", response_model=Ok)
def delete_work_package(wp_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    w = get_or_404(db, WorkPackage, wp_id)
    pr.ensure("workpackages.manage", w.entity_id, write=True)
    audit(db, pr, "delete", "work_package", w.id, w.code, entity_id=w.entity_id)
    cleanup_target(db, "work_package", w.id)
    db.delete(w)
    db.commit()
    remove_object(db, "work_package", wp_id)
    return Ok()


# --- tasks ----------------------------------------------------------------------------------------------


class TaskOut(BaseModel):
    id: int
    key: str
    title: str
    description: str | None
    status: str
    priority: str
    assignee: UserBrief | None
    reporter: UserBrief | None
    start_date: date | None
    due_date: date | None
    estimate_hours: float | None
    labels: list[str]
    checklist: list
    sort_order: float
    completed_at: datetime | None
    project_id: int | None
    work_package: dict | None
    activity_id: int | None
    action_item_id: int | None
    answer_id: int | None
    entity: EntityBrief | None
    created_at: datetime
    updated_at: datetime
    overdue: bool


def task_out(t: Task) -> TaskOut:
    return TaskOut(
        id=t.id,
        key=t.key,
        title=t.title,
        description=t.description,
        status=t.status,
        priority=t.priority,
        assignee=UserBrief.model_validate(t.assignee) if t.assignee else None,
        reporter=UserBrief.model_validate(t.reporter) if t.reporter else None,
        start_date=t.start_date,
        due_date=t.due_date,
        estimate_hours=t.estimate_hours,
        labels=t.labels or [],
        checklist=t.checklist or [],
        sort_order=t.sort_order,
        completed_at=t.completed_at,
        project_id=t.project_id,
        work_package={"id": t.work_package.id, "code": t.work_package.code, "title": t.work_package.title}
        if t.work_package
        else None,
        activity_id=t.activity_id,
        action_item_id=t.action_item_id,
        answer_id=t.answer_id,
        entity=EntityBrief.model_validate(t.entity) if t.entity else None,
        created_at=t.created_at,
        updated_at=t.updated_at,
        overdue=bool(t.due_date and t.due_date < date.today() and t.status != "done"),
    )


def _can_see_task(pr: Principal, t: Task) -> bool:
    return t.assignee_id == pr.id or t.reporter_id == pr.id or pr.can_read("tasks.read", t.entity_id)


def _can_edit_task(pr: Principal, t: Task) -> bool:
    return t.assignee_id == pr.id or t.reporter_id == pr.id or pr.can_write("tasks.manage", t.entity_id)


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(
    assignee_id: int | None = None,
    mine: bool = False,
    work_package_id: int | None = None,
    status: list[str] | None = Query(default=None),
    entity_id: int | None = None,
    q: str | None = Query(default=None, max_length=200),
    include_done: bool = True,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    stmt = select(Task).order_by(Task.sort_order, Task.id)
    if mine:
        stmt = stmt.where(Task.assignee_id == pr.id)
    elif assignee_id:
        stmt = stmt.where(Task.assignee_id == assignee_id)
    if work_package_id:
        stmt = stmt.where(Task.work_package_id == work_package_id)
    if status:
        stmt = stmt.where(Task.status.in_(status))
    if not include_done:
        stmt = stmt.where(Task.status != "done")
    if entity_id:
        stmt = stmt.where(Task.entity_id == entity_id)
    if q:
        like = f"%{q[:100]}%"
        stmt = stmt.where(or_(Task.title.ilike(like), Task.key.ilike(like), Task.description.ilike(like)))
    return [task_out(t) for t in db.scalars(stmt) if _can_see_task(pr, t)]


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=400)
    description: str | None = Field(default=None, max_length=50000)
    status: TaskStatus = "todo"
    priority: Priority = "Medium"
    assignee_id: int | None = None
    start_date: date | None = None
    due_date: date | None = None
    estimate_hours: float | None = Field(default=None, ge=0, le=10000)
    labels: list[str] = []
    checklist: list[dict] = []
    project_id: int | None = None
    work_package_id: int | None = None
    activity_id: int | None = None
    action_item_id: int | None = None
    answer_id: int | None = None
    entity_id: int | None = None


def _ensure_wp_link(pr: Principal, wp: WorkPackage) -> None:
    if not (
        pr.can_write("tasks.manage", wp.entity_id)
        or pr.can_write("workpackages.manage", wp.entity_id)
        or wp.owner_id == pr.id
    ):
        raise HTTPException(403, "No permission to add tasks to this work package")


def _clean_checklist(items: list[dict]) -> list[dict]:
    return [{"text": str(i.get("text", ""))[:500], "done": bool(i.get("done"))} for i in items[:100]]


@router.post("/tasks", response_model=TaskOut)
def create_task(body: TaskIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    data = body.model_dump()
    # the entity is always derived from linked objects; linking requires write access to them
    if body.work_package_id:
        wp = get_or_404(db, WorkPackage, body.work_package_id)
        _ensure_wp_link(pr, wp)
        data["entity_id"] = wp.entity_id
        data["project_id"] = wp.project_id
    if body.answer_id:
        from app.models import Answer

        ans = get_or_404(db, Answer, body.answer_id)
        pr.ensure("assessments.edit", ans.assessment.entity_id, write=True)
        data["entity_id"] = ans.assessment.entity_id
    if body.action_item_id:
        it = get_or_404(db, ActionItem, body.action_item_id)
        pr.ensure("findings.manage", it.entity_id, write=True)
        data["entity_id"] = it.entity_id
    if body.activity_id:
        from app.models import Activity

        get_or_404(db, Activity, body.activity_id)
        pr.ensure("projects.manage", None, write=True)
    if (
        data["entity_id"] is not None
        and not (body.work_package_id or body.answer_id or body.action_item_id)
        and not pr.can_read("entities.read", data["entity_id"])
    ):
        raise HTTPException(403, "No access to this entity")
    # anybody may create a task for themselves; assigning others needs tasks.manage (or edit rights on the
    # linked answer / work package)
    others = body.assignee_id not in (None, pr.id)
    if others and not (
        pr.can_write("tasks.manage", data["entity_id"])
        or body.answer_id
        or body.work_package_id
        or body.action_item_id
    ):
        raise HTTPException(403, "Missing permission: tasks.manage")
    data["checklist"] = _clean_checklist(body.checklist)
    data["labels"] = [str(label)[:40] for label in body.labels[:20]]
    max_order = db.scalar(select(func.max(Task.sort_order)).where(Task.status == body.status)) or 0
    t = Task(key=next_code(db, Task.key, "T-", width=0), reporter_id=pr.id, sort_order=max_order + 1, **data)
    if t.status == "done":
        t.completed_at = utcnow()
    db.add(t)
    db.flush()
    notify(
        db,
        t.assignee_id,
        "task_assigned",
        f"New task {t.key}: {t.title}",
        f"/tasks?task={t.id}",
        body=t.description,
        actor_id=pr.id,
    )
    audit(db, pr, "create", "task", t.id, t.key, entity_id=t.entity_id)
    db.commit()
    index_object(db, "task", t.id)
    return task_out(t)


@router.get("/tasks/{task_id}")
def get_task(task_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    t = get_or_404(db, Task, task_id)
    if not _can_see_task(pr, t):
        raise HTTPException(403, "No access")
    return {
        "task": task_out(t),
        "documents": doc_links_for(db, pr, "task", t.id),
        "can_edit": _can_edit_task(pr, t),
        "links": _task_links(db, pr, t),
    }


def _task_links(db: Session, pr: Principal, t: Task) -> dict:
    """Resolved labels for linked objects, only where the caller may read them."""
    from app.models import Activity, Answer

    links: dict = {"answer": None, "action_item": None, "activity": None}
    if t.answer_id:
        a = db.get(Answer, t.answer_id)
        if a and pr.can("assessments.read", a.assessment.entity_id):
            links["answer"] = {
                "id": a.id,
                "assessment_id": a.assessment_id,
                "requirement_id": a.requirement_id,
                "number": a.requirement.number,
                "section": a.requirement.section,
                "entity_code": a.assessment.entity.code,
            }
    if t.action_item_id:
        it = db.get(ActionItem, t.action_item_id)
        if it and pr.can("findings.read", it.entity_id):
            links["action_item"] = {
                "id": it.id,
                "code": it.code,
                "title": it.title,
                "entity_code": it.entity.code,
            }
    if t.activity_id:
        act = db.get(Activity, t.activity_id)
        if act and pr.has_any("projects.read"):
            links["activity"] = {
                "id": act.id,
                "code": act.code,
                "title": act.title,
                "project_id": act.project_id,
            }
    return links


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, max_length=400)
    description: str | None = Field(default=None, max_length=50000)
    status: TaskStatus | None = None
    priority: Priority | None = None
    assignee_id: int | None = None
    start_date: date | None = None
    due_date: date | None = None
    estimate_hours: float | None = None
    labels: list[str] | None = None
    checklist: list[dict] | None = None
    work_package_id: int | None = None
    sort_order: float | None = None


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def patch_task(
    task_id: int, body: TaskPatch, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    t = get_or_404(db, Task, task_id)
    if not _can_edit_task(pr, t):
        raise HTTPException(403, "No permission to edit this task")
    data = body.model_dump(exclude_unset=True)
    if (
        "assignee_id" in data
        and data["assignee_id"] not in (None, pr.id, t.assignee_id)
        and not pr.can_write("tasks.manage", t.entity_id)
        and t.reporter_id != pr.id
    ):
        raise HTTPException(403, "Missing permission to reassign")
    if "checklist" in data:
        data["checklist"] = _clean_checklist(data["checklist"] or [])
    if data.get("work_package_id") and data["work_package_id"] != t.work_package_id:
        wp = get_or_404(db, WorkPackage, data["work_package_id"])
        _ensure_wp_link(pr, wp)
        data["entity_id"] = wp.entity_id
    if "status" in data:
        if data["status"] == "done" and t.status != "done":
            t.completed_at = utcnow()
        elif data["status"] != "done":
            t.completed_at = None
    old_assignee, old_status = t.assignee_id, t.status
    diff = apply_changes(t, data)
    if t.assignee_id != old_assignee:
        notify(
            db,
            t.assignee_id,
            "task_assigned",
            f"Task assigned to you: {t.key} {t.title}",
            f"/tasks?task={t.id}",
            actor_id=pr.id,
        )
    if t.status != old_status and t.reporter_id and t.reporter_id != pr.id:
        notify(
            db,
            t.reporter_id,
            "task_status",
            f"{t.key} moved to {t.status.replace('_', ' ')}",
            f"/tasks?task={t.id}",
            actor_id=pr.id,
        )
    if diff and set(diff) - {"sort_order"}:
        audit(db, pr, "update", "task", t.id, t.key, entity_id=t.entity_id, details=diff)
    db.commit()
    db.refresh(t)  # reload assignee / work package / entity after foreign-key changes
    index_object(db, "task", t.id)
    return task_out(t)


@router.delete("/tasks/{task_id}", response_model=Ok)
def delete_task(task_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    t = get_or_404(db, Task, task_id)
    if not (t.reporter_id == pr.id or pr.can_write("tasks.manage", t.entity_id)):
        raise HTTPException(403, "No permission to delete this task")
    audit(db, pr, "delete", "task", t.id, t.key, entity_id=t.entity_id)
    cleanup_target(db, "task", t.id)
    db.delete(t)
    db.commit()
    remove_object(db, "task", task_id)
    return Ok()


# --- comments -------------------------------------------------------------------------------------------


@router.get("/comments", response_model=list[CommentOut])
def list_comments(
    target_type: str, target_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    check_target(db, pr, target_type, target_id)
    return db.scalars(
        select(Comment)
        .where(Comment.target_type == target_type, Comment.target_id == target_id)
        .order_by(Comment.created_at)
    ).all()


@router.post("/comments", response_model=CommentOut)
def add_comment(
    target_type: str,
    target_id: int,
    body: CommentIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    text = body.body.strip()
    if not text or len(text) > 20000:
        raise HTTPException(400, "Comment must be 1-20000 characters")
    obj = check_target(db, pr, target_type, target_id, write="contribute")
    c = Comment(target_type=target_type, target_id=target_id, author_id=pr.id, body=text)
    db.add(c)
    # notify owners/assignees and @mentioned users (by e-mail address)
    recipients = set()
    if target_type == "task":
        recipients |= {obj.assignee_id, obj.reporter_id}
    if target_type == "work_package":
        recipients.add(obj.owner_id)
    import re

    for email in re.findall(r"@([\w.+-]+@[\w-]+\.[\w.-]+)", text):
        uid = db.scalar(select(User.id).where(func.lower(User.email) == email.lower()))
        recipients.add(uid)
    link = {
        "task": f"/tasks?task={target_id}",
        "work_package": f"/work-packages/{target_id}",
        "action_item": f"/action-plan?item={target_id}",
        "document": f"/documents/{target_id}",
        "incident": f"/incidents/{target_id}",
        "risk": f"/risks/{target_id}",
    }.get(target_type)
    from app.api.util import can_access_target
    from app.core.deps import build_principal

    for uid in recipients:
        u = db.get(User, uid) if uid else None
        if not u or not u.is_active or not can_access_target(db, build_principal(u), target_type, target_id):
            continue
        notify(db, uid, "comment", f"{pr.user.display_name} commented", link, body=text[:500], actor_id=pr.id)
    db.commit()
    return c


@router.delete("/comments/{comment_id}", response_model=Ok)
def delete_comment(comment_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    c = get_or_404(db, Comment, comment_id)
    if c.author_id != pr.id and not pr.has_any("settings.manage"):
        raise HTTPException(403, "Only the author can delete a comment")
    db.delete(c)
    db.commit()
    return Ok()


# --- notifications --------------------------------------------------------------------------------------


@router.get("/notifications")
def list_notifications(
    unread_only: bool = False, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    stmt = (
        select(Notification)
        .where(Notification.user_id == pr.id)
        .order_by(Notification.created_at.desc())
        .limit(100)
    )
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    rows = db.scalars(stmt).all()
    unread = (
        db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == pr.id, Notification.is_read.is_(False)
            )
        )
        or 0
    )
    return {
        "unread": unread,
        "items": [
            {
                "id": n.id,
                "kind": n.kind,
                "title": n.title,
                "body": n.body,
                "link": n.link,
                "is_read": n.is_read,
                "created_at": n.created_at,
            }
            for n in rows
        ],
    }


@router.post("/notifications/read", response_model=Ok)
def mark_read(
    ids: list[int] | None = None, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    stmt = update(Notification).where(Notification.user_id == pr.id)
    if ids:
        stmt = stmt.where(Notification.id.in_(ids))
    db.execute(stmt.values(is_read=True))
    db.commit()
    return Ok()
