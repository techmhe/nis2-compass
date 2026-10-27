from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.models.org import Entity

INCIDENT_STATUS = ["Open", "Contained", "Resolved", "Closed"]
INCIDENT_SEVERITY = ["Low", "Medium", "High", "Critical"]


class Incident(TimestampMixin, Base):
    """Security incident register with NIS2 Art. 23 / § 32 BSIG / Cbw art. 25-29 reporting clock."""

    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # INC-001
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="SET NULL"), index=True)
    title: Mapped[str] = mapped_column(String(400))
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(100))
    severity: Mapped[str] = mapped_column(String(20), default="Medium")
    status: Mapped[str] = mapped_column(String(20), default="Open")
    is_significant: Mapped[bool | None] = mapped_column(Boolean)  # triggers reporting obligations
    significance_rationale: Mapped[str | None] = mapped_column(Text)
    detected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    aware_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # reporting clock starts here
    early_warning_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notification_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    intermediate_report_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    final_report_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    authority: Mapped[str | None] = mapped_column(String(300))
    authority_reference: Mapped[str | None] = mapped_column(String(200))
    suspected_malicious: Mapped[bool | None] = mapped_column(Boolean)
    cross_border_impact: Mapped[bool | None] = mapped_column(Boolean)
    impact: Mapped[str | None] = mapped_column(Text)
    indicators_of_compromise: Mapped[str | None] = mapped_column(Text)
    root_cause: Mapped[str | None] = mapped_column(Text)
    measures: Mapped[str | None] = mapped_column(Text)
    lessons_learned: Mapped[str | None] = mapped_column(Text)
    handler_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    timeline: Mapped[list] = mapped_column(JSON, default=list)  # [{"at": iso, "text": str, "by": str}]

    entity: Mapped[Entity | None] = relationship(lazy="joined")
