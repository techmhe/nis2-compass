"""Audits & reviews data model (Cbb Art. 18, IR 2024/2690 2.2 and 7, ISO/IEC 27001:2022 9.2/9.3, § 38 BSIG).

- AuditProgramme: the yearly audit programme (ISO 9.2.2 a).
- Audit + AuditFinding: individual audits (internal, external, certification, supplier, authority) and their
  findings, with a "create action plan item" bridge into the core action plan (app.models.ActionItem).
- EffectivenessReview: Cbb Art. 18 written evaluation of the effectiveness of the risk-management measures,
  approved through the generic 4-eyes approval workflow (see hooks.py).
- ManagementReview: ISO/IEC 27001:2022 9.3 management review with the clause 9.3.2 (a)-(i) inputs checklist and
  decisions/outputs that can each spawn a task.
"""

from datetime import date

from sqlalchemy import JSON, Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.models.org import Entity

AUDIT_TYPES = ["internal", "external", "certification", "supplier", "authority"]
AUDIT_STATUS = ["planned", "in_progress", "reported", "closed"]
FINDING_TYPES = ["major_nonconformity", "minor_nonconformity", "observation", "opportunity"]
FINDING_STATUS = ["open", "action_planned", "closed"]
REVIEW_STATUS = ["draft", "in_review", "approved"]
EFFECTIVENESS_RATINGS = ["effective", "partially_effective", "not_effective", "not_assessed"]

# ISO/IEC 27001:2022 clause 9.3.2 (a)-(i) management review inputs
MANAGEMENT_REVIEW_INPUT_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"]
MANAGEMENT_REVIEW_INPUT_LABELS = {
    "a": "Status of actions from previous management reviews",
    "b": "Changes in external and internal issues relevant to the ISMS",
    "c": "Feedback on information security performance, incl. nonconformities and corrective actions",
    "d": "Monitoring and measurement results",
    "e": "Audit results",
    "f": "Fulfilment of information security objectives",
    "g": "Feedback from interested parties",
    "h": "Results of risk assessment and status of the risk treatment plan",
    "i": "Opportunities for continual improvement",
}


class AuditProgramme(TimestampMixin, Base):
    """Yearly audit programme (ISO 9.2.2 a): which audits are planned and why."""

    __tablename__ = "aud_programmes"
    __table_args__ = (UniqueConstraint("year", name="uq_aud_programme_year"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(Integer, index=True)
    title: Mapped[str] = mapped_column(String(300))
    scope: Mapped[str | None] = mapped_column(Text)
    approved_by: Mapped[str | None] = mapped_column(String(200))
    approved_on: Mapped[date | None] = mapped_column(Date)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Audit(TimestampMixin, Base):
    """A single audit (AUD-<year>-<seq>)."""

    __tablename__ = "aud_audits"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    programme_id: Mapped[int | None] = mapped_column(
        ForeignKey("aud_programmes.id", ondelete="SET NULL"), index=True
    )
    type: Mapped[str] = mapped_column(
        String(20)
    )  # internal | external | certification | supplier | authority
    entity_id: Mapped[int | None] = mapped_column(
        ForeignKey("entities.id", ondelete="CASCADE"), index=True
    )  # None = group-wide
    scope: Mapped[str] = mapped_column(Text)
    requirement_chapter: Mapped[str | None] = mapped_column(
        String(200)
    )  # requirement / chapter scope, free text
    lead_auditor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    auditors: Mapped[str | None] = mapped_column(String(400))  # free text, e.g. external auditors
    planned_start: Mapped[date] = mapped_column(Date)
    planned_end: Mapped[date] = mapped_column(Date)
    actual_start: Mapped[date | None] = mapped_column(Date)
    actual_end: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="planned", index=True)
    summary: Mapped[str | None] = mapped_column(Text)
    conclusion: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    programme: Mapped[AuditProgramme | None] = relationship(lazy="joined")
    entity: Mapped[Entity | None] = relationship(lazy="joined")


class AuditFinding(TimestampMixin, Base):
    """A finding raised during an audit (major/minor nonconformity, observation, opportunity for improvement)."""

    __tablename__ = "aud_findings"

    id: Mapped[int] = mapped_column(primary_key=True)
    audit_id: Mapped[int] = mapped_column(ForeignKey("aud_audits.id", ondelete="CASCADE"), index=True)
    number: Mapped[str] = mapped_column(String(20))  # F1, F2 ... sequential within the audit
    type: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(Text)
    requirement_id: Mapped[int | None] = mapped_column(ForeignKey("requirements.id", ondelete="SET NULL"))
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)
    due_date: Mapped[date | None] = mapped_column(Date)
    action_item_id: Mapped[int | None] = mapped_column(ForeignKey("action_items.id", ondelete="SET NULL"))
    closure_note: Mapped[str | None] = mapped_column(Text)
    closed_at: Mapped[date | None] = mapped_column(Date)
    closed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    audit: Mapped[Audit] = relationship(lazy="joined")
    entity: Mapped[Entity | None] = relationship(lazy="joined")


class EffectivenessReview(TimestampMixin, Base):
    """Cbb Art. 18 written evaluation of the effectiveness of the risk-management measures, per entity and period."""

    __tablename__ = "aud_effectiveness_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int | None] = mapped_column(
        ForeignKey("entities.id", ondelete="CASCADE"), index=True
    )  # None = group
    period: Mapped[str] = mapped_column(String(10), index=True)  # e.g. "2026"
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    rows: Mapped[list] = mapped_column(JSON, default=list)  # [{chapter, rating, rationale}]
    inputs_summary: Mapped[dict | None] = mapped_column(JSON)  # last "collect inputs" snapshot
    conclusion: Mapped[str | None] = mapped_column(Text)
    approved_at: Mapped[date | None] = mapped_column(Date)
    approved_by: Mapped[str | None] = mapped_column(String(200))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    entity: Mapped[Entity | None] = relationship(lazy="joined")


class ManagementReview(TimestampMixin, Base):
    """ISO/IEC 27001:2022 9.3 management review."""

    __tablename__ = "aud_management_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    entity_id: Mapped[int | None] = mapped_column(
        ForeignKey("entities.id", ondelete="CASCADE"), index=True
    )  # None = group
    participants: Mapped[str | None] = mapped_column(Text)
    inputs: Mapped[list] = mapped_column(
        JSON, default=list
    )  # [{key, notes}] keys a..i, see MANAGEMENT_REVIEW_INPUT_KEYS
    decisions: Mapped[list] = mapped_column(JSON, default=list)  # [{text, owner, due, task_id}]
    board_decision_id: Mapped[int | None] = mapped_column(
        ForeignKey("gov_board_decisions.id", ondelete="SET NULL")
    )
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    entity: Mapped[Entity | None] = relationship(lazy="joined")
