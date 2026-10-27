from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.models.auth import User

APPROVAL_STATUS = ["pending", "approved", "rejected", "changes_requested", "withdrawn"]
DECISIONS = ["approved", "rejected", "changes_requested"]


class ApprovalRequest(TimestampMixin, Base):
    """A 4-eyes approval of one object (document version, assessment answer, risk acceptance ...).

    The request pins the version of the target at request time (`target_version`). When the target changes after
    an approval, the approval state of the object reads "changed after approval"."""

    __tablename__ = "approval_requests"
    __table_args__ = (Index("ix_approval_requests_target", "target_type", "target_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    target_type: Mapped[str] = mapped_column(String(30))
    target_id: Mapped[int] = mapped_column(Integer)
    target_version: Mapped[str | None] = mapped_column(String(100))  # machine key of the pinned version
    target_version_label: Mapped[str | None] = mapped_column(String(200))  # e.g. "v3 (2.1)"
    target_label: Mapped[str] = mapped_column(String(400))  # snapshot of the object title
    target_url: Mapped[str | None] = mapped_column(String(400))
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="SET NULL"), index=True)
    requested_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    approver_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    request_note: Mapped[str | None] = mapped_column(Text)
    decision_note: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # module-specific flags, e.g. {"above_appetite": true, "requires_management_body": true, "residual_level": "high"}
    meta: Mapped[dict | None] = mapped_column(JSON)

    requested_by: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[requested_by_id])
    approver: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[approver_user_id])
