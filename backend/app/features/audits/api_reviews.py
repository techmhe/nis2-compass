"""Effectiveness reviews (Cbb Art. 18) and management reviews (ISO/IEC 27001:2022 9.3)."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import cleanup_target, doc_links_for, entity_ref, get_or_404
from app.core.deps import Principal, get_principal, require
from app.db import get_db
from app.features.audits.logic import collect_inputs
from app.features.audits.models import (
    MANAGEMENT_REVIEW_INPUT_KEYS,
    MANAGEMENT_REVIEW_INPUT_LABELS,
    EffectivenessReview,
    ManagementReview,
)
from app.features.audits.validation import BoundedDate, merge_update, partial_model
from app.features.inventory.actions import create_task
from app.models import Entity, User
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object, remove_object

router = APIRouter()


def _uname(db: Session, uid: int | None) -> str | None:
    u = db.get(User, uid) if uid else None
    return u.display_name if u else None


# --------------------------------------------------------------------------- effectiveness reviews


def review_out(db: Session, r: EffectivenessReview, pr: Principal) -> dict:
    from app.features.approvals.service import target_state

    editable = r.status != "approved" and pr.can_write("audits.manage", r.entity_id)
    return {
        "id": r.id,
        "entity": entity_ref(r.entity),
        "entity_id": r.entity_id,
        "period": r.period,
        "status": r.status,
        "rows": r.rows or [],
        "inputs_summary": r.inputs_summary,
        "conclusion": r.conclusion,
        "approved_at": r.approved_at,
        "approved_by": r.approved_by,
        "created_at": r.created_at,
        "can_edit": editable,
        "approval": target_state(db, "effectiveness_review", r.id)["state"],
        "documents": doc_links_for(db, pr, "effectiveness_review", r.id),
    }


class ReviewRow(BaseModel):
    chapter: int = Field(ge=1, le=99)
    rating: Literal["effective", "partially_effective", "not_effective", "not_assessed"] = "not_assessed"
    rationale: str | None = Field(default=None, max_length=20000)


class ReviewIn(BaseModel):
    entity_id: int | None = None
    period: str = Field(min_length=4, max_length=10)
    rows: list[ReviewRow] = Field(default_factory=list, max_length=50)
    conclusion: str | None = Field(default=None, max_length=20000)


ReviewPatch = partial_model(ReviewIn, "ReviewPatch")


@router.get("/effectiveness-reviews")
def list_reviews(
    entity_id: int | None = None,
    pr: Principal = Depends(require("audits.read")),
    db: Session = Depends(get_db),
):
    stmt = select(EffectivenessReview).order_by(
        EffectivenessReview.period.desc(), EffectivenessReview.id.desc()
    )
    if entity_id is not None:
        stmt = stmt.where(EffectivenessReview.entity_id == entity_id)
    return [review_out(db, r, pr) for r in db.scalars(stmt) if pr.can_read("audits.read", r.entity_id)]


@router.get("/effectiveness-reviews/{review_id}")
def get_review(
    review_id: int, pr: Principal = Depends(require("audits.read")), db: Session = Depends(get_db)
):
    r = get_or_404(db, EffectivenessReview, review_id, "Effectiveness review")
    pr.ensure("audits.read", r.entity_id)
    return review_out(db, r, pr)


@router.get("/effectiveness-reviews/{review_id}/collect-inputs")
def get_review_inputs(
    review_id: int, pr: Principal = Depends(require("audits.read")), db: Session = Depends(get_db)
):
    r = get_or_404(db, EffectivenessReview, review_id, "Effectiveness review")
    pr.ensure("audits.read", r.entity_id)
    return collect_inputs(db, r.entity_id)


@router.post("/effectiveness-reviews")
def create_review(body: ReviewIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr.ensure("audits.manage", body.entity_id, write=True)
    if body.entity_id is not None:
        get_or_404(db, Entity, body.entity_id, "Entity")
    r = EffectivenessReview(
        entity_id=body.entity_id,
        period=body.period,
        rows=[row.model_dump() for row in body.rows],
        conclusion=body.conclusion,
        status="draft",
        created_by_id=pr.id,
    )
    db.add(r)
    db.flush()
    audit(
        db,
        pr,
        "create",
        "effectiveness_review",
        r.id,
        f"{r.period} {r.entity.code if r.entity else 'Group'}",
        entity_id=r.entity_id,
    )
    db.commit()
    index_object(db, "effectiveness_review", r.id)
    return review_out(db, r, pr)


@router.put("/effectiveness-reviews/{review_id}")
@router.patch("/effectiveness-reviews/{review_id}")
def update_review(
    review_id: int, body: ReviewPatch, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    r = get_or_404(db, EffectivenessReview, review_id, "Effectiveness review")
    pr.ensure("audits.manage", r.entity_id, write=True)
    if r.status == "approved":
        raise HTTPException(400, "An approved review cannot be edited; create a new one for the next period")
    merged = merge_update(r, body, ReviewIn)
    pr.ensure("audits.manage", merged.entity_id, write=True)
    if merged.entity_id is not None:
        get_or_404(db, Entity, merged.entity_id, "Entity")
    diff = apply_changes(
        r, {**merged.model_dump(exclude={"rows"}), "rows": [row.model_dump() for row in merged.rows]}
    )
    if r.status == "in_review":
        r.status = "draft"  # substantive changes withdraw an in-review state
    audit(db, pr, "update", "effectiveness_review", r.id, r.period, entity_id=r.entity_id, details=diff)
    db.commit()
    db.refresh(r)
    index_object(db, "effectiveness_review", r.id)
    return review_out(db, r, pr)


@router.delete("/effectiveness-reviews/{review_id}")
def delete_review(review_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    r = get_or_404(db, EffectivenessReview, review_id, "Effectiveness review")
    pr.ensure("audits.manage", r.entity_id, write=True)
    if r.status == "approved":
        raise HTTPException(400, "An approved review cannot be deleted")
    audit(db, pr, "delete", "effectiveness_review", r.id, r.period, entity_id=r.entity_id)
    cleanup_target(db, "effectiveness_review", r.id)
    db.delete(r)
    db.commit()
    remove_object(db, "effectiveness_review", review_id)
    return {"ok": True}


# --------------------------------------------------------------------------- management reviews


def review_input_labels() -> list[dict]:
    return [{"key": k, "label": MANAGEMENT_REVIEW_INPUT_LABELS[k]} for k in MANAGEMENT_REVIEW_INPUT_KEYS]


def mgmt_review_out(db: Session, m: ManagementReview, pr: Principal) -> dict:
    return {
        "id": m.id,
        "date": m.date,
        "entity": entity_ref(m.entity),
        "entity_id": m.entity_id,
        "participants": m.participants,
        "inputs": m.inputs or [],
        "decisions": m.decisions or [],
        "board_decision_id": m.board_decision_id,
        "created_at": m.created_at,
        "can_edit": pr.can_write("audits.manage", m.entity_id),
        "documents": doc_links_for(db, pr, "management_review", m.id),
    }


class ReviewInput(BaseModel):
    key: str = Field(max_length=40)
    notes: str | None = Field(default=None, max_length=20000)

    @field_validator("key")
    @classmethod
    def _known_key(cls, v: str) -> str:
        if v not in MANAGEMENT_REVIEW_INPUT_KEYS:
            raise ValueError("Unknown management review input")
        return v


class ReviewDecision(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    owner: str | None = Field(default=None, max_length=200)
    due: date | None = None
    task_id: int | None = None


class MgmtReviewIn(BaseModel):
    date: BoundedDate
    entity_id: int | None = None
    participants: str | None = Field(default=None, max_length=20000)
    inputs: list[ReviewInput] = Field(default_factory=list, max_length=20)
    decisions: list[ReviewDecision] = Field(default_factory=list, max_length=100)
    board_decision_id: int | None = None

    @field_validator("date")
    @classmethod
    def _not_future(cls, v):
        if v > date.today():
            raise ValueError("The review date cannot be in the future")
        return v


MgmtReviewPatch = partial_model(MgmtReviewIn, "MgmtReviewPatch")


def _check_board_decision(db: Session, board_decision_id: int | None) -> None:
    if board_decision_id is None:
        return
    try:
        from app.features.governance.models import BoardDecision
    except ImportError:
        raise HTTPException(422, "The governance module is not installed") from None
    if not db.get(BoardDecision, board_decision_id):
        raise HTTPException(422, "Unknown management body decision")


@router.get("/management-reviews/input-checklist")
def input_checklist(pr: Principal = Depends(require("audits.read"))):
    return review_input_labels()


@router.get("/management-reviews")
def list_mgmt_reviews(
    entity_id: int | None = None,
    pr: Principal = Depends(require("audits.read")),
    db: Session = Depends(get_db),
):
    stmt = select(ManagementReview).order_by(ManagementReview.date.desc(), ManagementReview.id.desc())
    if entity_id is not None:
        stmt = stmt.where(ManagementReview.entity_id == entity_id)
    return [mgmt_review_out(db, m, pr) for m in db.scalars(stmt) if pr.can_read("audits.read", m.entity_id)]


@router.get("/management-reviews/{review_id}")
def get_mgmt_review(
    review_id: int, pr: Principal = Depends(require("audits.read")), db: Session = Depends(get_db)
):
    m = get_or_404(db, ManagementReview, review_id, "Management review")
    pr.ensure("audits.read", m.entity_id)
    return mgmt_review_out(db, m, pr)


@router.post("/management-reviews")
def create_mgmt_review(
    body: MgmtReviewIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    pr.ensure("audits.manage", body.entity_id, write=True)
    if body.entity_id is not None:
        get_or_404(db, Entity, body.entity_id, "Entity")
    _check_board_decision(db, body.board_decision_id)
    m = ManagementReview(
        date=body.date,
        entity_id=body.entity_id,
        participants=body.participants,
        inputs=[i.model_dump(mode="json") for i in body.inputs],
        decisions=[d.model_dump(mode="json") for d in body.decisions],
        board_decision_id=body.board_decision_id,
        created_by_id=pr.id,
    )
    db.add(m)
    db.flush()
    audit(
        db,
        pr,
        "create",
        "management_review",
        m.id,
        f"Management review {m.date.isoformat()}",
        entity_id=m.entity_id,
    )
    db.commit()
    index_object(db, "management_review", m.id)
    return mgmt_review_out(db, m, pr)


@router.put("/management-reviews/{review_id}")
@router.patch("/management-reviews/{review_id}")
def update_mgmt_review(
    review_id: int,
    body: MgmtReviewPatch,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    m = get_or_404(db, ManagementReview, review_id, "Management review")
    pr.ensure("audits.manage", m.entity_id, write=True)
    merged = merge_update(m, body, MgmtReviewIn)
    pr.ensure("audits.manage", merged.entity_id, write=True)
    if merged.entity_id is not None:
        get_or_404(db, Entity, merged.entity_id, "Entity")
    _check_board_decision(db, merged.board_decision_id)
    data = {
        **merged.model_dump(exclude={"inputs", "decisions"}),
        "inputs": [i.model_dump(mode="json") for i in merged.inputs],
        "decisions": [d.model_dump(mode="json") for d in merged.decisions],
    }
    diff = apply_changes(m, data)
    audit(
        db,
        pr,
        "update",
        "management_review",
        m.id,
        f"Management review {m.date.isoformat()}",
        entity_id=m.entity_id,
        details=diff,
    )
    db.commit()
    db.refresh(m)
    index_object(db, "management_review", m.id)
    return mgmt_review_out(db, m, pr)


@router.delete("/management-reviews/{review_id}")
def delete_mgmt_review(review_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    m = get_or_404(db, ManagementReview, review_id, "Management review")
    pr.ensure("audits.manage", m.entity_id, write=True)
    audit(
        db,
        pr,
        "delete",
        "management_review",
        m.id,
        f"Management review {m.date.isoformat()}",
        entity_id=m.entity_id,
    )
    cleanup_target(db, "management_review", m.id)
    db.delete(m)
    db.commit()
    remove_object(db, "management_review", review_id)
    return {"ok": True}


class DecisionTaskIn(BaseModel):
    assignee_id: int | None = None


@router.post("/management-reviews/{review_id}/decisions/{index}/create-task")
def create_decision_task(
    review_id: int,
    index: int,
    body: DecisionTaskIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    m = get_or_404(db, ManagementReview, review_id, "Management review")
    pr.ensure("audits.manage", m.entity_id, write=True)
    decisions = list(m.decisions or [])
    if index < 0 or index >= len(decisions):
        raise HTTPException(404, "Decision not found")
    d = decisions[index]
    if d.get("task_id"):
        raise HTTPException(409, "A task was already created for this decision")
    if body.assignee_id is not None:
        u = db.get(User, body.assignee_id)
        if not u or not u.is_active:
            raise HTTPException(422, "Assignee must be an active user")
    due = None
    if d.get("due"):
        due = date.fromisoformat(d["due"]) if isinstance(d["due"], str) else d["due"]
    t = create_task(
        db,
        pr,
        entity_id=m.entity_id,
        title=d["text"][:300],
        description=f"Decision of the management review of {m.date.isoformat()}"
        + (f" (owner: {d['owner']})" if d.get("owner") else ""),
        assignee_id=body.assignee_id,
        due_date=due,
    )
    decisions[index] = {**d, "task_id": t.id}
    m.decisions = decisions
    audit(
        db,
        pr,
        "update",
        "management_review",
        m.id,
        f"Management review {m.date.isoformat()}",
        entity_id=m.entity_id,
        details={"decision_task": [None, t.key]},
    )
    db.commit()
    return mgmt_review_out(db, m, pr)
