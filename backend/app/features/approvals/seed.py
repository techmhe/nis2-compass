"""Demo approvals of documents (risk acceptance approvals are seeded by the risks module)."""

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.features.approvals.models import ApprovalRequest
from app.models import Document, User


def _doc_version(d: Document) -> tuple[str, str]:
    v = d.current_version
    if v is None:
        return "none", "no file uploaded"
    return f"ver:{v.id}", f"v{v.version_no}" + (f" ({d.version_label})" if d.version_label else "")


def seed(db: Session, demo: bool) -> None:
    if not demo or db.scalar(
        select(func.count(ApprovalRequest.id)).where(ApprovalRequest.target_type == "document")
    ):
        return
    users = {u.email: u for u in db.scalars(select(User).where(User.email.like("%@demo.local")))}
    docs = {d.title: d for d in db.scalars(select(Document))}
    isb, pm, it, nl = (
        users.get(e) for e in ("isb@demo.local", "pm@demo.local", "it@demo.local", "nl.contact@demo.local")
    )
    if not (isb and pm and it and nl):
        return
    today = date.today()

    def add(
        title: str,
        requester: User,
        approver: User,
        status: str,
        note: str,
        decision: str | None = None,
        days_ago: int = 0,
        due_in: int = 7,
    ) -> None:
        d = docs.get(title)
        if d is None:
            return
        key, label = _doc_version(d)
        created = utcnow() - timedelta(days=days_ago)
        db.add(
            ApprovalRequest(
                target_type="document",
                target_id=d.id,
                target_version=key,
                target_version_label=label,
                target_label=d.title,
                target_url=f"/documents/{d.id}",
                entity_id=d.entity_id,
                requested_by_id=requester.id,
                approver_user_id=approver.id,
                due_date=today + timedelta(days=due_in),
                status=status,
                request_note=note,
                decision_note=decision,
                decided_at=None if status == "pending" else created + timedelta(days=2),
                created_at=created,
            )
        )
        if status == "approved":
            d.approved_by = approver.display_name
            d.approved_at = (created + timedelta(days=2)).date()

    add(
        "Information Security Policy",
        it,
        isb,
        "approved",
        "Annual review of the group policy (IR 1.1.2). Changes: scope now includes the Dutch subsidiaries.",
        "Approved on behalf of the management board.",
        days_ago=60,
        due_in=-45,
    )
    add(
        "Incident Response Procedure",
        it,
        isb,
        "pending",
        "Updated reporting deadlines (24 h / 72 h / 1 month) and the NCSC contact for the Dutch entities.",
        days_ago=3,
        due_in=5,
    )
    add(
        "Beleid informatiebeveiliging NL",
        nl,
        isb,
        "changes_requested",
        "Local policy for the Dutch entities, please approve before the board meeting.",
        "Please add the reference to the group policy and the board approval required by Cbw Art. 24.",
        days_ago=12,
        due_in=-5,
    )
    db.flush()
