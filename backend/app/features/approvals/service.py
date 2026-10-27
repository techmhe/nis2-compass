"""Approval workflow core: target adapters, version pinning, access rules and state machine.

Access rules (4-eyes):
- the requester needs write access to the object (`write_perm`, group-level objects need a group-wide grant);
- the approver must be a different person with read access AND the approver permission of the object type
  (`approve_perm`, checked like a write permission: for the object's entity, group-wide for group objects), or
  satisfy the adapter's own `check_approver` rule (risk acceptance: management body rule, see risks/hooks.py).
  The approver rule is enforced when requesting, in the approver list and again when deciding.

Other feature modules plug their own object types in with `register_approval_target` (see risks/hooks.py for
the risk acceptance adapter). Object types registered for comments/document links (app.api.util.TARGETS) are
supported generically: their version is the object's `updated_at` timestamp.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import TARGETS, check_target, get_or_404, target_entity_id
from app.core.deps import Principal, build_principal
from app.db import utcnow
from app.features.approvals.models import ApprovalRequest
from app.models import Answer, AnswerRevision, Document, User
from app.services.audit import audit
from app.services.indexing import index_object
from app.services.notify import notify, remind_due


@dataclass
class ApprovalTarget:
    """How the approval workflow treats one object type."""

    model: type
    read_perm: str
    write_perm: str
    noun: str  # "document", "assessment answer", "risk acceptance"
    label: Callable[[Any], str]
    url: Callable[[Any], str | None]
    # (machine key, human label) of the object's current version; a different key later = "changed after approval"
    version: Callable[[Session, Any], tuple[str | None, str | None]]
    entity_id: Callable[[Any], int | None] = target_entity_id
    # own access rules (True) or app.api.util.check_target (False, for types registered there)
    custom_access: bool = False
    # extra validation when an approval is requested; may return meta flags stored on the request
    validate_request: Callable[[Session, Principal, Any], dict | None] | None = None
    # side effects of a decision (approved / rejected / changes_requested), e.g. set Document.status
    on_decision: Callable[[Session, Principal, ApprovalRequest, Any], None] | None = None
    # side effects of a withdrawal
    on_withdraw: Callable[[Session, Principal, ApprovalRequest, Any], None] | None = None
    # permission the approver needs for the object's entity (group-wide for group objects); None = write_perm
    approve_perm: str | None = None
    # custom approver rule (replaces approve_perm): (db, approver principal, obj, request meta) -> error or None
    check_approver: Callable[[Session, Principal, Any, dict | None], str | None] | None = None


ADAPTERS: dict[str, ApprovalTarget] = {}


def register_approval_target(target_type: str, adapter: ApprovalTarget) -> None:
    ADAPTERS[target_type] = adapter


# --- built-in adapters --------------------------------------------------------------------------------------


def _doc_version(db: Session, d: Document) -> tuple[str | None, str | None]:
    v = d.current_version
    if v is None:
        return "none", "no file uploaded"
    label = f"v{v.version_no}" + (f" ({d.version_label})" if d.version_label else "")
    return f"ver:{v.id}", label


def _doc_decision(db: Session, pr: Principal, req: ApprovalRequest, d: Document) -> None:
    if req.status != "approved":
        if d.status == "In Review":
            d.status = "Draft"
        return
    d.status = "Approved"
    d.approved_at = date.today()
    d.approved_by = pr.user.display_name[:200]
    audit(
        db,
        pr,
        "approve",
        "document",
        d.id,
        d.title,
        entity_id=d.entity_id,
        details={"approval_id": req.id, "version": req.target_version_label},
    )
    db.flush()
    index_object(db, "document", d.id, commit=False)


def _doc_validate(db: Session, pr: Principal, d: Document) -> dict | None:
    if d.status == "Retired":
        raise HTTPException(400, "Retired documents cannot be approved")
    if d.status == "Draft":
        d.status = "In Review"
    return None


def _doc_withdraw(db: Session, pr: Principal, req: ApprovalRequest, d: Document) -> None:
    if d.status == "In Review":
        d.status = "Draft"


def _answer_version(db: Session, a: Answer) -> tuple[str | None, str | None]:
    rev = db.scalar(
        select(AnswerRevision)
        .where(AnswerRevision.answer_id == a.id)
        .order_by(AnswerRevision.id.desc())
        .limit(1)
    )
    if rev:
        return f"rev:{rev.id}", f"state of {rev.changed_at:%d %b %Y %H:%M}"
    return f"ts:{a.updated_at.isoformat() if a.updated_at else ''}", "initial state"


def _answer_decision(db: Session, pr: Principal, req: ApprovalRequest, a: Answer) -> None:
    if req.status != "approved" or a.review_status == "reviewed":
        return
    old = a.review_status
    a.review_status = "reviewed"
    db.add(AnswerRevision(answer_id=a.id, changed_by_id=pr.id, changes={"review_status": [old, "reviewed"]}))
    db.flush()
    # the review flag set by the approval itself is not a content change: pin the new revision
    req.target_version, req.target_version_label = _answer_version(db, a)


def _answer_label(a: Answer) -> str:
    section = re.sub(r"^[\d.]+\s*", "", a.requirement.section or "")
    return f"{a.assessment.entity.code} {a.requirement.number} {section}".strip()


ADAPTERS["document"] = ApprovalTarget(
    model=Document,
    read_perm="documents.read",
    write_perm="documents.upload",
    noun="document",
    label=lambda d: d.title,
    url=lambda d: f"/documents/{d.id}",
    version=_doc_version,
    validate_request=_doc_validate,
    on_decision=_doc_decision,
    on_withdraw=_doc_withdraw,
    approve_perm="documents.manage",
)
ADAPTERS["answer"] = ApprovalTarget(
    model=Answer,
    read_perm="assessments.read",
    write_perm="assessments.edit",
    noun="assessment answer",
    label=_answer_label,
    url=lambda a: f"/assessments/{a.assessment_id}?req={a.requirement_id}",
    version=_answer_version,
    on_decision=_answer_decision,
    approve_perm="assessments.manage",
)


def _generic_label(obj) -> str:
    code = getattr(obj, "code", None) or getattr(obj, "key", None) or getattr(obj, "number", None)
    title = (
        getattr(obj, "title", None)
        or getattr(obj, "name", None)
        or getattr(obj, "section", None)
        or getattr(obj, "decision", None)
        or ""
    )
    return (f"{code} {title}" if code else str(title) or f"#{obj.id}")[:400]


_GENERIC_URLS = {
    "requirement": lambda o: f"/catalog/{o.id}",
    "action_item": lambda o: f"/action-plan?item={o.id}",
    "work_package": lambda o: f"/work-packages/{o.id}",
    "task": lambda o: f"/tasks?task={o.id}",
    "incident": lambda o: f"/incidents/{o.id}",
    "activity": lambda o: f"/projects/{o.project_id}/plan?activity={o.id}",
    "gate": lambda o: f"/projects/{o.project_id}/gates",
    "raid": lambda o: f"/projects/{o.project_id}/raid?record={o.id}",
    "provision": lambda o: f"/regulations/{o.regulation_id}?p={o.id}",
}


def _generic_version(db: Session, obj) -> tuple[str | None, str | None]:
    ts = getattr(obj, "updated_at", None)
    return (f"ts:{ts.isoformat()}", f"state of {ts:%d %b %Y %H:%M}") if ts else (None, None)


def get_adapter(target_type: str) -> ApprovalTarget:
    if target_type in ADAPTERS:
        return ADAPTERS[target_type]
    if target_type in TARGETS:
        model, rperm, wperm = TARGETS[target_type]
        url = _GENERIC_URLS.get(target_type, lambda o: None)
        return ApprovalTarget(
            model=model,
            read_perm=rperm,
            write_perm=wperm,
            noun=target_type.replace("_", " "),
            label=_generic_label,
            url=url,
            version=_generic_version,
        )
    raise HTTPException(400, "Unknown approval target type")


# --- access ---------------------------------------------------------------------------------------------------


def load_target(db: Session, pr: Principal, target_type: str, target_id: int, write: bool = False):
    """Load the target and check read (or write) access for the principal. Raises 403/404."""
    ad = get_adapter(target_type)
    if not ad.custom_access and target_type in TARGETS:
        obj = check_target(db, pr, target_type, target_id, write=write)
        # requesting approval is a write: group-level objects need a group-wide grant (not "any entity")
        if write and not pr.can_write(ad.write_perm, ad.entity_id(obj)):
            raise HTTPException(403, "No write access")
        return ad, obj
    obj = get_or_404(db, ad.model, target_id, ad.noun.capitalize())
    ent = ad.entity_id(obj)
    if not pr.can_read(ad.read_perm, ent):
        raise HTTPException(403, "No access")
    if write and not pr.can_write(ad.write_perm, ent):
        raise HTTPException(403, "No write access")
    return ad, obj


def can_read_target(db: Session, pr: Principal, target_type: str, target_id: int) -> bool:
    try:
        load_target(db, pr, target_type, target_id)
        return True
    except HTTPException:
        return False


def approver_error(
    db: Session, ad: ApprovalTarget, target_type: str, obj, apr: Principal, meta: dict | None = None
) -> str | None:
    """Why this principal may not approve the object (None = may approve)."""
    name = apr.user.display_name
    if not can_read_target(db, apr, target_type, obj.id):
        return f"{name} has no access to this {ad.noun} and cannot approve it"
    if ad.check_approver:
        return ad.check_approver(db, apr, obj, meta)
    perm = ad.approve_perm or ad.write_perm
    if not apr.can_write(perm, ad.entity_id(obj)):
        scope = "for this entity" if ad.entity_id(obj) is not None else "group-wide"
        return f"{name} cannot approve this {ad.noun}: the permission {perm} {scope} is required"
    return None


def approver_candidates(db: Session, pr: Principal, target_type: str, target_id: int) -> list[User]:
    ad, obj = load_target(db, pr, target_type, target_id)
    out = []
    for u in db.scalars(select(User).where(User.is_active.is_(True)).order_by(User.display_name)):
        if u.id == pr.id:
            continue
        if approver_error(db, ad, target_type, obj, build_principal(u)) is None:
            out.append(u)
    return out


# --- state ------------------------------------------------------------------------------------------------------


def history(db: Session, target_type: str, target_id: int) -> list[ApprovalRequest]:
    return list(
        db.scalars(
            select(ApprovalRequest)
            .where(ApprovalRequest.target_type == target_type, ApprovalRequest.target_id == target_id)
            .order_by(ApprovalRequest.created_at.desc(), ApprovalRequest.id.desc())
        )
    )


def current_version(db: Session, target_type: str, target_id: int) -> tuple[bool, str | None, str | None]:
    """(exists, version key, version label) of the target right now."""
    try:
        ad = get_adapter(target_type)
    except HTTPException:
        return False, None, None
    obj = db.get(ad.model, target_id)
    if obj is None:
        return False, None, None
    key, label = ad.version(db, obj)
    return True, key, label


def is_stale(db: Session, req: ApprovalRequest, cache: dict | None = None) -> bool:
    """An approved request whose target has changed since (or no longer exists)."""
    if req.status != "approved":
        return False
    k = (req.target_type, req.target_id)
    if cache is not None and k in cache:
        exists, key, _ = cache[k]
    else:
        exists, key, label = current_version(db, req.target_type, req.target_id)
        if cache is not None:
            cache[k] = (exists, key, label)
    return (not exists) or (req.target_version is not None and key != req.target_version)


def target_state(db: Session, target_type: str, target_id: int) -> dict:
    reqs = history(db, target_type, target_id)
    relevant = next((r for r in reqs if r.status != "withdrawn"), None)
    state = "none"
    if relevant:
        state = relevant.status
        if relevant.status == "approved" and is_stale(db, relevant):
            state = "changed_after_approval"
    last_approved = next((r for r in reqs if r.status == "approved"), None)
    _, _, version_label = current_version(db, target_type, target_id)
    return {
        "state": state,
        "current": relevant,
        "last_approved": last_approved,
        "history": reqs,
        "current_version_label": version_label,
    }


# --- workflow -----------------------------------------------------------------------------------------------


def create_request(
    db: Session,
    pr: Principal,
    target_type: str,
    target_id: int,
    approver_user_id: int,
    due_date: date | None = None,
    note: str | None = None,
) -> ApprovalRequest:
    ad, obj = load_target(db, pr, target_type, target_id, write=True)
    if approver_user_id == pr.id:
        raise HTTPException(
            400, "You cannot approve your own request. Choose a different approver (4-eyes principle)."
        )
    approver = db.get(User, approver_user_id)
    if approver is None or not approver.is_active:
        raise HTTPException(400, "The chosen approver does not exist or is inactive")
    if due_date and due_date < date.today():
        raise HTTPException(400, "The due date lies in the past")
    if db.scalar(
        select(ApprovalRequest.id).where(
            ApprovalRequest.target_type == target_type,
            ApprovalRequest.target_id == target_id,
            ApprovalRequest.status == "pending",
        )
    ):
        raise HTTPException(409, f"An approval of this {ad.noun} is already pending. Withdraw it first.")
    meta = ad.validate_request(db, pr, obj) if ad.validate_request else None
    err = approver_error(db, ad, target_type, obj, build_principal(approver), meta)
    if err:
        raise HTTPException(400, err)
    key, vlabel = ad.version(db, obj)
    label = ad.label(obj)
    req = ApprovalRequest(
        target_type=target_type,
        target_id=target_id,
        target_version=key,
        target_version_label=vlabel,
        target_label=label[:400],
        target_url=ad.url(obj) if ad.url else None,
        entity_id=ad.entity_id(obj),
        requested_by_id=pr.id,
        approver_user_id=approver.id,
        due_date=due_date,
        status="pending",
        request_note=(note or "").strip() or None,
        meta=meta or None,
    )
    db.add(req)
    db.flush()
    audit(
        db,
        pr,
        "approval_requested",
        target_type,
        target_id,
        label,
        entity_id=req.entity_id,
        details={"approval_id": req.id, "approver": approver.email, "version": vlabel, "due_date": due_date},
    )
    flag = " (requires management body decision)" if (meta or {}).get("requires_management_body") else ""
    notify(
        db,
        approver.id,
        "approval_request",
        f"Approval requested: {label}{flag}"[:400],
        f"/approvals?request={req.id}",
        body=f"{pr.user.display_name} asks you to approve this {ad.noun}"
        + (f" by {due_date:%d %b %Y}" if due_date else "")
        + (f".\n\n{req.request_note}" if req.request_note else "."),
        actor_id=pr.id,
    )
    return req


DECISION_LABEL = {"approved": "Approved", "rejected": "Rejected", "changes_requested": "Changes requested"}


def decide(
    db: Session, pr: Principal, req: ApprovalRequest, decision: str, note: str | None
) -> ApprovalRequest:
    if decision not in DECISION_LABEL:
        raise HTTPException(400, "Unknown decision")
    if req.status != "pending":
        raise HTTPException(409, "This request has already been decided or withdrawn")
    if req.approver_user_id != pr.id:
        raise HTTPException(403, "Only the requested approver can decide")
    if req.requested_by_id == pr.id:
        raise HTTPException(403, "You cannot decide on your own request")
    note = (note or "").strip() or None
    if decision != "approved" and not note:
        raise HTTPException(
            400, "Explain your decision: a note is required when rejecting or requesting changes"
        )
    ad, obj = load_target(db, pr, req.target_type, req.target_id)
    err = approver_error(db, ad, req.target_type, obj, pr, req.meta)  # permissions may have changed since
    if err:
        raise HTTPException(403, err)
    key, vlabel = ad.version(db, obj)
    if decision == "approved" and req.target_version is not None and key != req.target_version:
        raise HTTPException(
            409,
            f"The {ad.noun} changed after the request ({req.target_version_label} requested, "
            f"now {vlabel}). Request changes or ask for a new approval request.",
        )
    req.status = decision
    req.decision_note = note
    req.decided_at = utcnow()
    if ad.on_decision:
        ad.on_decision(db, pr, req, obj)
    audit(
        db,
        pr,
        f"approval_{decision}",
        req.target_type,
        req.target_id,
        req.target_label,
        entity_id=req.entity_id,
        details={"approval_id": req.id, "version": req.target_version_label, "note": note},
    )
    notify(
        db,
        req.requested_by_id,
        "approval_decision",
        f"{DECISION_LABEL[decision]}: {req.target_label}"[:400],
        req.target_url or f"/approvals?request={req.id}",
        body=f"{pr.user.display_name}: {DECISION_LABEL[decision].lower()}" + (f"\n\n{note}" if note else ""),
        actor_id=pr.id,
    )
    return req


def withdraw(db: Session, pr: Principal, req: ApprovalRequest) -> ApprovalRequest:
    if req.status != "pending":
        raise HTTPException(409, "Only pending requests can be withdrawn")
    if req.requested_by_id != pr.id:
        raise HTTPException(403, "Only the requester can withdraw the request")
    req.status = "withdrawn"
    req.decided_at = utcnow()
    try:
        ad = get_adapter(req.target_type)
        obj = db.get(ad.model, req.target_id)
        if obj is not None and ad.on_withdraw:
            ad.on_withdraw(db, pr, req, obj)
    except HTTPException:
        pass
    audit(
        db,
        pr,
        "approval_withdrawn",
        req.target_type,
        req.target_id,
        req.target_label,
        entity_id=req.entity_id,
        details={"approval_id": req.id},
    )
    notify(
        db,
        req.approver_user_id,
        "approval_withdrawn",
        f"Approval request withdrawn: {req.target_label}"[:400],
        "/approvals",
        actor_id=pr.id,
    )
    return req


def withdraw_for_deleted_target(db: Session, target_type: str, target_id: int) -> None:
    """Call when a target object is deleted: pending requests are closed as withdrawn."""
    for r in db.scalars(
        select(ApprovalRequest).where(
            ApprovalRequest.target_type == target_type,
            ApprovalRequest.target_id == target_id,
            ApprovalRequest.status == "pending",
        )
    ):
        r.status = "withdrawn"
        r.decided_at = utcnow()
        r.decision_note = "Closed automatically: the object was deleted"


def run_approval_reminders(db: Session) -> int:
    """Remind approvers of overdue pending requests (once per request and week). Call from the reminder loop."""
    today = date.today()
    n = 0
    for r in db.scalars(
        select(ApprovalRequest).where(
            ApprovalRequest.status == "pending",
            ApprovalRequest.due_date.is_not(None),
            ApprovalRequest.due_date < today,
        )
    ):
        n += remind_due(
            db,
            r.approver_user_id,
            key=f"approval:{r.id}",
            due=r.due_date,
            today=today,
            what=f"Approval: {r.target_label}",
            link=f"/approvals?request={r.id}",
        )
    db.commit()
    return n
