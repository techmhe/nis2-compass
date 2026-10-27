"""Generic 4-eyes approval workflow: request, approve / reject / request changes, withdraw, inbox and history.

Rule: requester != approver. The requester needs write access to the object, the approver read access.
Approving pins the version of the object (document version, answer revision, risk assessment); a later change
makes the approval state read "changed after approval"."""

from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import get_or_404
from app.core.deps import Principal, get_principal
from app.db import get_db
from app.features.approvals import service as svc
from app.features.approvals.models import ApprovalRequest
from app.models import Entity
from app.schemas.common import EntityBrief, UserBrief

router = APIRouter(prefix="/approvals", tags=["approvals"])


class ApprovalOut(BaseModel):
    id: int
    target_type: str
    target_id: int
    target_label: str
    target_url: str | None
    target_version: str | None
    target_version_label: str | None
    entity: EntityBrief | None
    requested_by: UserBrief | None
    approver: UserBrief | None
    due_date: date | None
    status: str
    request_note: str | None
    decision_note: str | None
    decided_at: datetime | None
    created_at: datetime
    meta: dict | None
    overdue: bool
    stale: bool  # approved, but the object changed afterwards (or was deleted)
    can_decide: bool
    can_withdraw: bool
    accessible: bool  # False: the caller can no longer read the object; label and notes are hidden


def out(db: Session, pr: Principal, r: ApprovalRequest, cache: dict | None = None) -> ApprovalOut:
    """Serialise a request. Parties who lost access to the object only see that a request exists."""
    cache = {} if cache is None else cache
    ak = ("access", r.target_type, r.target_id)
    if ak not in cache:
        cache[ak] = svc.can_read_target(db, pr, r.target_type, r.target_id)
    ok = cache[ak]
    ent = db.get(Entity, r.entity_id) if r.entity_id else None
    return ApprovalOut(
        id=r.id,
        target_type=r.target_type,
        target_id=r.target_id,
        target_label=r.target_label if ok else "Object you no longer have access to",
        target_url=r.target_url if ok else None,
        target_version=r.target_version if ok else None,
        target_version_label=r.target_version_label if ok else None,
        entity=EntityBrief.model_validate(ent) if ent else None,
        requested_by=UserBrief.model_validate(r.requested_by) if r.requested_by else None,
        approver=UserBrief.model_validate(r.approver) if r.approver else None,
        due_date=r.due_date,
        status=r.status,
        request_note=r.request_note if ok else None,
        decision_note=r.decision_note if ok else None,
        decided_at=r.decided_at,
        created_at=r.created_at,
        meta=r.meta if ok else None,
        overdue=r.status == "pending" and r.due_date is not None and r.due_date < date.today(),
        stale=svc.is_stale(db, r, cache),
        can_decide=ok
        and r.status == "pending"
        and r.approver_user_id == pr.id
        and r.requested_by_id != pr.id,
        can_withdraw=r.status == "pending" and r.requested_by_id == pr.id,
        accessible=ok,
    )


def _visible(db: Session, pr: Principal, r: ApprovalRequest, cache: dict) -> bool:
    if pr.id in (r.approver_user_id, r.requested_by_id):
        return True
    k = (r.target_type, r.target_id)
    if k not in cache:
        cache[k] = svc.can_read_target(db, pr, r.target_type, r.target_id)
    return cache[k]


STATUS_FILTERS = {
    "pending": ["pending"],
    "open": ["pending", "changes_requested"],
    "decided": ["approved", "rejected", "changes_requested"],
    "closed": ["approved", "rejected", "changes_requested", "withdrawn"],
}


@router.get("", response_model=list[ApprovalOut])
def list_approvals(
    mine: Literal["waiting", "requested", "all"] = "waiting",
    status: Literal[
        "pending",
        "open",
        "decided",
        "closed",
        "approved",
        "rejected",
        "changes_requested",
        "withdrawn",
        "any",
    ]
    | None = None,
    target_type: str | None = Query(default=None, max_length=30),
    entity_id: int | None = None,
    limit: int = Query(default=300, ge=1, le=1000),
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    stmt = select(ApprovalRequest)
    if mine == "waiting":
        stmt = stmt.where(ApprovalRequest.approver_user_id == pr.id)
        status = status or "pending"
    elif mine == "requested":
        stmt = stmt.where(ApprovalRequest.requested_by_id == pr.id)
    if status and status != "any":
        stmt = stmt.where(ApprovalRequest.status.in_(STATUS_FILTERS.get(status, [status])))
    if target_type:
        stmt = stmt.where(ApprovalRequest.target_type == target_type)
    if entity_id is not None:
        stmt = stmt.where(ApprovalRequest.entity_id == entity_id)
    stmt = stmt.order_by(ApprovalRequest.created_at.desc(), ApprovalRequest.id.desc())
    vis_cache: dict = {}
    ver_cache: dict = {}
    res = []
    for r in db.scalars(stmt):
        if mine == "all" and not _visible(db, pr, r, vis_cache):
            continue
        res.append(out(db, pr, r, ver_cache))
        if len(res) >= limit:
            break
    if mine == "waiting":  # most urgent first: overdue, then due date, then oldest
        res.sort(key=lambda a: (a.status != "pending", a.due_date or date.max, a.created_at))
    return res


@router.get("/summary")
def summary(pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    today = date.today()
    waiting = list(
        db.scalars(
            select(ApprovalRequest).where(
                ApprovalRequest.approver_user_id == pr.id, ApprovalRequest.status == "pending"
            )
        )
    )
    requested = db.scalars(
        select(ApprovalRequest.id).where(
            ApprovalRequest.requested_by_id == pr.id, ApprovalRequest.status == "pending"
        )
    ).all()
    return {
        "waiting": len(waiting),
        "waiting_overdue": sum(1 for r in waiting if r.due_date and r.due_date < today),
        "requested_pending": len(requested),
    }


@router.get("/target")
def target_approvals(
    target_type: str = Query(max_length=30),
    target_id: int = Query(),
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    """Approval state and history of one object (for the approval panel on object pages)."""
    svc.load_target(db, pr, target_type, target_id)
    st = svc.target_state(db, target_type, target_id)
    try:
        svc.load_target(db, pr, target_type, target_id, write=True)
        can_write = True
    except HTTPException:
        can_write = False
    cache: dict = {}
    pending = st["current"] is not None and st["current"].status == "pending"
    return {
        "state": st["state"],
        "current": out(db, pr, st["current"], cache) if st["current"] else None,
        "last_approved": out(db, pr, st["last_approved"], cache) if st["last_approved"] else None,
        "history": [out(db, pr, r, cache) for r in st["history"]],
        "current_version_label": st["current_version_label"],
        "can_request": can_write and not pending,
        "noun": svc.get_adapter(target_type).noun,
    }


@router.get("/approvers", response_model=list[UserBrief])
def approvers(
    target_type: str = Query(max_length=30),
    target_id: int = Query(),
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    """Users who may approve the object: active, not the caller, with read access to it."""
    svc.load_target(db, pr, target_type, target_id, write=True)
    return [UserBrief.model_validate(u) for u in svc.approver_candidates(db, pr, target_type, target_id)]


class ApprovalIn(BaseModel):
    target_type: str = Field(min_length=1, max_length=30)
    target_id: int
    approver_user_id: int
    due_date: date | None = None
    request_note: str | None = Field(default=None, max_length=5000)


@router.post("", response_model=ApprovalOut)
def request_approval(body: ApprovalIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    r = svc.create_request(
        db, pr, body.target_type, body.target_id, body.approver_user_id, body.due_date, body.request_note
    )
    db.commit()
    return out(db, pr, r)


def _get_visible(db: Session, pr: Principal, approval_id: int) -> ApprovalRequest:
    r = get_or_404(db, ApprovalRequest, approval_id, "Approval request")
    if not _visible(db, pr, r, {}):
        raise HTTPException(404, "Approval request not found")
    return r


@router.get("/{approval_id}", response_model=ApprovalOut)
def get_approval(approval_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    return out(db, pr, _get_visible(db, pr, approval_id))


class DecisionIn(BaseModel):
    decision: Literal["approved", "rejected", "changes_requested"]
    note: str | None = Field(default=None, max_length=5000)


@router.post("/{approval_id}/decide", response_model=ApprovalOut)
def decide(
    approval_id: int, body: DecisionIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    r = _get_visible(db, pr, approval_id)
    svc.decide(db, pr, r, body.decision, body.note)
    db.commit()
    return out(db, pr, r)


@router.post("/{approval_id}/withdraw", response_model=ApprovalOut)
def withdraw(approval_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    r = _get_visible(db, pr, approval_id)
    svc.withdraw(db, pr, r)
    db.commit()
    return out(db, pr, r)


def _register_reminders():
    from app.services.notify import register_reminder_job

    register_reminder_job(svc.run_approval_reminders)


_register_reminders()
