from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import cleanup_target, doc_links_for, get_or_404, next_code
from app.core.deps import Principal, get_principal, require
from app.db import get_db, utcnow
from app.models import (
    ActionItem,
    Answer,
    Assessment,
    AssessmentRound,
    Requirement,
    WorkPackage,
    work_package_findings,
)
from app.schemas.common import EntityBrief, Ok, RequirementBrief, StakeholderBrief
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object, remove_object
from app.services.scoring import due_status

router = APIRouter(prefix="/action-items", tags=["action plan"])

Priority = Literal["High", "Medium", "Low"]
Status = Literal["Not Started", "In Progress", "Completed", "Blocked", "Deferred"]


class ActionItemOut(BaseModel):
    id: int
    code: str
    round_id: int | None
    entity: EntityBrief
    requirement: RequirementBrief
    chapter: str
    requirement_text: str
    identified_gap: str | None
    finding_id: str | None
    title: str
    priority: str
    acceptance_criterion: str | None
    expected_evidence: str | None
    responsible: StakeholderBrief | None
    assessment_owner: str | None
    target_date: date | None
    status: str
    due_status: str | None
    comments: str | None
    work_packages: list[dict]
    updated_at: datetime


def _answer_for(db: Session, item: ActionItem) -> Answer | None:
    stmt = (
        select(Answer)
        .join(Assessment)
        .where(Assessment.entity_id == item.entity_id, Answer.requirement_id == item.requirement_id)
    )
    if item.round_id:
        stmt = stmt.where(Assessment.round_id == item.round_id)
    return db.scalars(stmt).first()


def out(db: Session, item: ActionItem, wp_map: dict[int, list[dict]] | None = None) -> ActionItemOut:
    ans = _answer_for(db, item)
    if wp_map is None:
        wp_map = _wp_map(db, [item.id])
    return ActionItemOut(
        id=item.id,
        code=item.code,
        round_id=item.round_id,
        entity=EntityBrief.model_validate(item.entity),
        requirement=RequirementBrief.model_validate(item.requirement),
        chapter=f"{item.requirement.chapter.number} {item.requirement.chapter.title}",
        requirement_text=item.requirement.text,
        identified_gap=ans.gap_description if ans else None,
        finding_id=ans.finding_id if ans else None,
        title=item.title,
        priority=item.priority,
        acceptance_criterion=item.acceptance_criterion,
        expected_evidence=item.expected_evidence,
        responsible=StakeholderBrief.model_validate(item.responsible) if item.responsible else None,
        assessment_owner=ans.responsible.name if ans and ans.responsible else None,
        target_date=item.target_date,
        status=item.status,
        due_status=due_status(item.target_date, item.status),
        comments=item.comments,
        work_packages=wp_map.get(item.id, []),
        updated_at=item.updated_at,
    )


def _wp_map(db: Session, ids: list[int]) -> dict[int, list[dict]]:
    rows = db.execute(
        select(work_package_findings.c.action_item_id, WorkPackage.id, WorkPackage.code, WorkPackage.title)
        .join(WorkPackage, WorkPackage.id == work_package_findings.c.work_package_id)
        .where(work_package_findings.c.action_item_id.in_(ids))
    ).all()
    m: dict[int, list[dict]] = {}
    for aid, wid, code, title in rows:
        m.setdefault(aid, []).append({"id": wid, "code": code, "title": title})
    return m


@router.get("", response_model=list[ActionItemOut])
def list_items(
    entity_id: int | None = None,
    status: str | None = None,
    pr: Principal = Depends(require("findings.read")),
    db: Session = Depends(get_db),
):
    stmt = select(ActionItem).order_by(ActionItem.code)
    if entity_id:
        stmt = stmt.where(ActionItem.entity_id == entity_id)
    if status:
        stmt = stmt.where(ActionItem.status == status)
    items = [i for i in db.scalars(stmt) if pr.can("findings.read", i.entity_id)]
    wp_map = _wp_map(db, [i.id for i in items])
    return [out(db, i, wp_map) for i in items]


@router.get("/unplanned")
def unplanned_findings(
    round_id: int | None = None,
    pr: Principal = Depends(require("findings.read")),
    db: Session = Depends(get_db),
):
    """Identified gaps (work package required) that are not yet in the action plan."""
    if round_id is None:
        round_id = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    planned = {(i.entity_id, i.requirement_id) for i in db.scalars(select(ActionItem))}
    rows = []
    for a in db.scalars(
        select(Answer).join(Assessment).where(Assessment.round_id == round_id, Answer.wp_required.is_(True))
    ):
        ent = a.assessment.entity
        if (ent.id, a.requirement_id) in planned or not pr.can("findings.read", ent.id):
            continue
        rows.append(
            {
                "answer_id": a.id,
                "assessment_id": a.assessment_id,
                "finding_id": a.finding_id,
                "entity": {"id": ent.id, "code": ent.code, "name": ent.name},
                "requirement": {
                    "id": a.requirement.id,
                    "number": a.requirement.number,
                    "section": a.requirement.section,
                },
                "chapter": a.requirement.chapter.number,
                "score": a.score,
                "gap_description": a.gap_description,
                "recommended_action": a.recommended_action,
                "target_date": a.target_date,
                "effort": a.effort,
                "responsible": a.responsible.name if a.responsible else None,
                "responsible_id": a.responsible_id,
                "sort": a.requirement.sort_order,
            }
        )
    rows.sort(key=lambda r: (r["sort"], r["entity"]["code"]))
    return rows


class ItemIn(BaseModel):
    entity_id: int
    requirement_id: int
    title: str = Field(min_length=1, max_length=4000)
    priority: Priority = "Medium"
    acceptance_criterion: str | None = None
    expected_evidence: str | None = None
    responsible_id: int | None = None
    target_date: date | None = None
    status: Status = "Not Started"
    comments: str | None = None


def _current_round(db: Session) -> int | None:
    return db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))


@router.post("", response_model=ActionItemOut)
def create_item(body: ItemIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr.ensure("findings.manage", body.entity_id, write=True)
    get_or_404(db, Requirement, body.requirement_id)
    item = ActionItem(
        code=next_code(db, ActionItem.code, "AP-"), round_id=_current_round(db), **body.model_dump()
    )
    db.add(item)
    db.flush()
    audit(db, pr, "create", "action_item", item.id, item.code, entity_id=item.entity_id)
    db.commit()
    index_object(db, "action_item", item.id)
    return out(db, item)


class FromFindingsIn(BaseModel):
    answer_ids: list[int] = Field(min_length=1, max_length=300)
    priority: Priority = "Medium"


@router.post("/from-findings", response_model=list[ActionItemOut])
def create_from_findings(
    body: FromFindingsIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    """Create action plan items from assessment findings, pre-filled with the recommended action."""
    created = []
    for aid in body.answer_ids:
        a = get_or_404(db, Answer, aid)
        ent_id = a.assessment.entity_id
        pr.ensure("findings.manage", ent_id, write=True)
        if db.scalar(
            select(ActionItem).where(
                ActionItem.entity_id == ent_id, ActionItem.requirement_id == a.requirement_id
            )
        ):
            continue
        item = ActionItem(
            code=next_code(db, ActionItem.code, "AP-"),
            round_id=a.assessment.round_id,
            entity_id=ent_id,
            requirement_id=a.requirement_id,
            title=a.recommended_action or f"Close gap for {a.requirement.number}: {a.requirement.section}",
            priority=body.priority,
            target_date=a.target_date,
            responsible_id=a.responsible_id,
        )
        db.add(item)
        db.flush()
        created.append(item)
        audit(
            db,
            pr,
            "create",
            "action_item",
            item.id,
            item.code,
            entity_id=ent_id,
            details={"from_answer": aid},
        )
    db.commit()
    for i in created:
        index_object(db, "action_item", i.id, commit=False)
    db.commit()
    return [out(db, i) for i in created]


class ItemUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=4000)
    priority: Priority | None = None
    acceptance_criterion: str | None = None
    expected_evidence: str | None = None
    responsible_id: int | None = None
    target_date: date | None = None
    status: Status | None = None
    comments: str | None = None


@router.get("/{item_id}")
def get_item(item_id: int, pr: Principal = Depends(require("findings.read")), db: Session = Depends(get_db)):
    item = get_or_404(db, ActionItem, item_id)
    pr.ensure("findings.read", item.entity_id)
    ans = _answer_for(db, item)
    return {
        "item": out(db, item),
        "answer_id": ans.id if ans else None,
        "assessment_id": ans.assessment_id if ans else None,
        "documents": doc_links_for(db, pr, "action_item", item.id),
    }


@router.patch("/{item_id}", response_model=ActionItemOut)
def update_item(
    item_id: int, body: ItemUpdate, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    item = get_or_404(db, ActionItem, item_id)
    pr.ensure("findings.manage", item.entity_id, write=True)
    data = body.model_dump(exclude_unset=True)
    if data.get("status") == "Completed" and item.status != "Completed":
        item.completed_at = utcnow()
    diff = apply_changes(item, data)
    audit(db, pr, "update", "action_item", item.id, item.code, entity_id=item.entity_id, details=diff)
    db.commit()
    index_object(db, "action_item", item.id)
    return out(db, item)


@router.delete("/{item_id}", response_model=Ok)
def delete_item(item_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = get_or_404(db, ActionItem, item_id)
    pr.ensure("findings.manage", item.entity_id, write=True)
    if db.scalar(select(work_package_findings).where(work_package_findings.c.action_item_id == item.id)):
        raise HTTPException(409, "Item is linked to a work package; unlink it first")
    audit(db, pr, "delete", "action_item", item.id, item.code, entity_id=item.entity_id)
    cleanup_target(db, "action_item", item.id)
    db.delete(item)
    db.commit()
    remove_object(db, "action_item", item_id)
    return Ok()
