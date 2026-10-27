"""Follow-up actions from exercises and supplier assessments: create action plan items or tasks with the same
checks and side effects (audit, index, notification) as the core routers."""

from datetime import date

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.util import next_code
from app.core.deps import Principal
from app.models import ActionItem, AssessmentRound, Entity, Requirement, Stakeholder, Task, User
from app.services.audit import audit
from app.services.indexing import index_object
from app.services.notify import notify


def create_action_item(
    db: Session,
    pr: Principal,
    *,
    entity_id: int,
    requirement_number: str,
    title: str,
    priority: str = "Medium",
    target_date: date | None = None,
    responsible_id: int | None = None,
    comments: str | None = None,
    acceptance_criterion: str | None = None,
) -> ActionItem:
    if not db.get(Entity, entity_id):
        raise HTTPException(404, "Entity not found")
    pr.ensure("findings.manage", entity_id, write=True)
    req = db.scalar(select(Requirement).where(Requirement.number == requirement_number))
    if not req:
        raise HTTPException(400, f"Requirement {requirement_number} not found in the catalogue")
    if responsible_id is not None and not db.get(Stakeholder, responsible_id):
        raise HTTPException(400, "Responsible stakeholder not found")
    round_id = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    item = ActionItem(
        code=next_code(db, ActionItem.code, "AP-"),
        round_id=round_id,
        entity_id=entity_id,
        requirement_id=req.id,
        title=title,
        priority=priority,
        target_date=target_date,
        responsible_id=responsible_id,
        comments=comments,
        acceptance_criterion=acceptance_criterion,
        status="Not Started",
    )
    db.add(item)
    db.flush()
    audit(db, pr, "create", "action_item", item.id, item.code, entity_id=entity_id)
    if responsible_id:
        st = db.get(Stakeholder, responsible_id)
        if st and st.user_id:
            notify(
                db,
                st.user_id,
                "assigned",
                f"Action plan item {item.code}: {title[:200]}",
                f"/action-plan?item={item.id}",
                actor_id=pr.id,
            )
    return item


def create_task(
    db: Session,
    pr: Principal,
    *,
    entity_id: int | None,
    title: str,
    description: str | None = None,
    assignee_id: int | None = None,
    due_date: date | None = None,
    priority: str = "Medium",
    labels: list[str] | None = None,
) -> Task:
    if (
        assignee_id not in (None, pr.id)
        and not pr.can_write("tasks.manage", entity_id)
        and not pr.can_write("assets.manage", entity_id)
    ):
        raise HTTPException(403, "Missing permission: tasks.manage")
    if assignee_id is not None and not db.get(User, assignee_id):
        raise HTTPException(400, "Assignee not found")
    max_order = db.scalar(select(func.max(Task.sort_order)).where(Task.status == "todo")) or 0
    t = Task(
        key=next_code(db, Task.key, "T-", width=0),
        title=title,
        description=description,
        status="todo",
        priority=priority,
        assignee_id=assignee_id,
        reporter_id=pr.id,
        due_date=due_date,
        entity_id=entity_id,
        sort_order=max_order + 1,
        labels=labels or ["continuity"],
        checklist=[],
    )
    db.add(t)
    db.flush()
    notify(
        db,
        t.assignee_id,
        "task_assigned",
        f"New task {t.key}: {t.title}",
        f"/tasks?task={t.id}",
        body=description,
        actor_id=pr.id,
    )
    audit(db, pr, "create", "task", t.id, t.key, entity_id=entity_id)
    return t


def reindex_after(db: Session, action_item_id: int | None = None, task_id: int | None = None) -> None:
    if action_item_id:
        index_object(db, "action_item", action_item_id)
    if task_id:
        index_object(db, "task", task_id)
