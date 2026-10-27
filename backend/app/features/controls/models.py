from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.models.org import Entity

RECURRENCES = ["monthly", "quarterly", "semi_annual", "annual", "custom"]
OCCURRENCE_STATUS = ["planned", "done", "skipped"]  # "overdue" is derived: planned and past the due date
RESULTS = ["effective", "partially_effective", "not_effective"]
EXCEPTION_SCOPES = ["entity", "requirement", "control"]
EXCEPTION_STATUS = ["requested", "approved", "rejected", "revoked"]  # "expired" is derived from expires_at


class ControlActivity(TimestampMixin, Base):
    """Template of a recurring control activity (access review, restore test, policy review ...).

    Group-level object: occurrences are generated per entity in scope and period."""

    __tablename__ = "ctl_activities"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # CA-001
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    requirement_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    legal_refs: Mapped[str | None] = mapped_column(String(400))  # e.g. "IR 11.3; Cbb Art. 15(3)"
    entity_scope: Mapped[str] = mapped_column(String(10), default="all")  # all | list
    entity_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    recurrence: Mapped[str] = mapped_column(String(20), default="annual")
    rrule: Mapped[str | None] = mapped_column(String(200))  # RRULE-lite for recurrence == custom
    anchor_month: Mapped[int] = mapped_column(
        Integer, default=12
    )  # month the period ends in (annual/semi/quarterly)
    owner_stakeholder_id: Mapped[int | None] = mapped_column(
        ForeignKey("stakeholders.id", ondelete="SET NULL")
    )
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    required_evidence: Mapped[str | None] = mapped_column(Text)
    evidence_validity_days: Mapped[int] = mapped_column(Integer, default=365)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ControlOccurrence(TimestampMixin, Base):
    """One execution of a control activity for one entity and period."""

    __tablename__ = "ctl_occurrences"
    __table_args__ = (
        UniqueConstraint("activity_id", "entity_id", "period_key", name="uq_ctl_occurrence_period"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("ctl_activities.id", ondelete="CASCADE"), index=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    period_key: Mapped[str] = mapped_column(
        String(20)
    )  # 2026-09 | 2026-Q3 | 2026-H2 | 2026 | 2026-W40 | 2026-09-15
    period_label: Mapped[str] = mapped_column(String(60))
    due_date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="planned")
    performed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    performed_at: Mapped[date | None] = mapped_column(Date)
    result: Mapped[str | None] = mapped_column(String(30))
    notes: Mapped[str | None] = mapped_column(Text)
    action_item_id: Mapped[int | None] = mapped_column(ForeignKey("action_items.id", ondelete="SET NULL"))

    activity: Mapped[ControlActivity] = relationship(lazy="joined")
    entity: Mapped[Entity] = relationship(lazy="joined")


class ControlException(TimestampMixin, Base):
    """Documented deviation (waiver) from a requirement or control with compensating measures and an expiry."""

    __tablename__ = "ctl_exceptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # EX-001
    title: Mapped[str] = mapped_column(String(300))
    scope_type: Mapped[str] = mapped_column(String(20), default="requirement")
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    requirement_id: Mapped[int | None] = mapped_column(ForeignKey("requirements.id", ondelete="SET NULL"))
    activity_id: Mapped[int | None] = mapped_column(ForeignKey("ctl_activities.id", ondelete="SET NULL"))
    reason: Mapped[str] = mapped_column(Text)
    compensating_measures: Mapped[str | None] = mapped_column(Text)
    requested_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="requested")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[date] = mapped_column(Date)

    entity: Mapped[Entity | None] = relationship(lazy="joined")


# --- KPIs --------------------------------------------------------------------------------------------------

KPI_FREQUENCIES = ["monthly", "quarterly", "annual"]
KPI_DIRECTIONS = ["higher", "lower"]


class MetricDefinition(TimestampMixin, Base):
    """KPI definition (group-level catalogue)."""

    __tablename__ = "kpi_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    unit: Mapped[str] = mapped_column(String(20), default="%")  # % | count | days | hours | EUR
    direction: Mapped[str] = mapped_column(String(10), default="higher")
    description: Mapped[str | None] = mapped_column(Text)
    legal_refs: Mapped[str | None] = mapped_column(String(400))
    default_target: Mapped[float | None] = mapped_column(Float)
    frequency: Mapped[str] = mapped_column(String(20), default="quarterly")
    computation: Mapped[str | None] = mapped_column(
        String(40)
    )  # key of a built-in computation; None = manual
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class MetricInstance(TimestampMixin, Base):
    """A KPI measured for one entity (or group-wide when entity_id is NULL)."""

    __tablename__ = "kpi_instances"
    __table_args__ = (UniqueConstraint("definition_id", "entity_id", name="uq_kpi_instance"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    definition_id: Mapped[int] = mapped_column(
        ForeignKey("kpi_definitions.id", ondelete="CASCADE"), index=True
    )
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    target: Mapped[float | None] = mapped_column(Float)
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    definition: Mapped[MetricDefinition] = relationship(lazy="joined")
    entity: Mapped[Entity | None] = relationship(lazy="joined")


class MetricValue(TimestampMixin, Base):
    __tablename__ = "kpi_values"
    __table_args__ = (UniqueConstraint("instance_id", "period", name="uq_kpi_value_period"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("kpi_instances.id", ondelete="CASCADE"), index=True)
    period: Mapped[str] = mapped_column(String(10))  # 2026-09 | 2026-Q3 | 2026
    period_end: Mapped[date] = mapped_column(Date)
    value: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual | computed | import
    note: Mapped[str | None] = mapped_column(Text)
    recorded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
