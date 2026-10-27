from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.models.auth import User
from app.models.org import Entity, Stakeholder

PROJECT_STATUS_VALUES = ["Not Started", "In Progress", "Completed", "Blocked", "Deferred", "Cancelled"]
MEASURE_AREAS = [
    "Governance",
    "Risk Management",
    "Incident Handling and Reporting",
    "Business Continuity",
    "Supply Chain Security",
    "Access Control",
    "Asset Management",
    "Awareness and Training",
    "Cryptography",
    "Vulnerability Management",
    "Logging and Monitoring",
    "Physical Security",
    "Supplier and MSP Governance",
]
RAID_TYPES = ["Risk", "Issue", "Decision", "Assumption"]
RAID_STATUS_VALUES = ["Open", "In Progress", "Closed", "Accepted", "Escalated"]
RATING_VALUES = ["High", "Medium", "Low"]
RACI_VALUES = ["R", "A", "C", "I", "A/R", "-"]
TASK_STATUS_VALUES = ["todo", "in_progress", "review", "done", "blocked"]


class Project(TimestampMixin, Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(20), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="In Progress")
    planned_start: Mapped[date | None] = mapped_column(Date)
    planned_finish: Mapped[date | None] = mapped_column(Date)
    sponsor: Mapped[str | None] = mapped_column(String(200))
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    description: Mapped[str | None] = mapped_column(Text)
    # free key/value overview fields from the 'Project Overview' sheet: [{"field": "...", "value": "..."}]
    overview: Mapped[list] = mapped_column(JSON, default=list)
    version_note: Mapped[str | None] = mapped_column(String(300))

    manager: Mapped[User | None] = relationship(lazy="joined")


class Phase(Base):
    __tablename__ = "phases"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))  # "1. Initiation"
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Gate(TimestampMixin, Base):
    __tablename__ = "gates"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40))  # "Gate 1"
    planned_date: Mapped[date | None] = mapped_column(Date)
    actual_date: Mapped[date | None] = mapped_column(Date)
    decision: Mapped[str | None] = mapped_column(Text)
    decision_owner_id: Mapped[int | None] = mapped_column(ForeignKey("stakeholders.id", ondelete="SET NULL"))
    required_input: Mapped[str | None] = mapped_column(Text)
    approval_criterion: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="Not Started")
    decision_reference: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    decision_owner: Mapped[Stakeholder | None] = relationship(lazy="joined")


activity_dependencies = Table(
    "activity_dependencies",
    Base.metadata,
    Column("activity_id", ForeignKey("activities.id", ondelete="CASCADE"), primary_key=True),
    Column("depends_on_id", ForeignKey("activities.id", ondelete="CASCADE"), primary_key=True),
)


class Activity(TimestampMixin, Base):
    """Master Plan activity (P1.1 ...)."""

    __tablename__ = "activities"
    __table_args__ = (UniqueConstraint("project_id", "code", name="uq_activity_code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    phase_id: Mapped[int | None] = mapped_column(ForeignKey("phases.id", ondelete="SET NULL"))
    code: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(Text)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("stakeholders.id", ondelete="SET NULL"))
    support: Mapped[str | None] = mapped_column(Text)
    planned_start: Mapped[date | None] = mapped_column(Date)
    planned_finish: Mapped[date | None] = mapped_column(Date)
    actual_finish: Mapped[date | None] = mapped_column(Date)
    deliverable: Mapped[str | None] = mapped_column(Text)
    gate_id: Mapped[int | None] = mapped_column(ForeignKey("gates.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="Not Started")
    priority: Mapped[str] = mapped_column(String(10), default="Medium")
    progress: Mapped[float] = mapped_column(Float, default=0.0)  # 0..1
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_milestone: Mapped[bool] = mapped_column(default=False)

    phase: Mapped[Phase | None] = relationship(lazy="joined")
    owner: Mapped[Stakeholder | None] = relationship(lazy="joined")
    gate: Mapped[Gate | None] = relationship(lazy="joined")
    depends_on: Mapped[list["Activity"]] = relationship(
        secondary=activity_dependencies,
        primaryjoin=id == activity_dependencies.c.activity_id,
        secondaryjoin=id == activity_dependencies.c.depends_on_id,
        lazy="selectin",
    )


work_package_findings = Table(
    "work_package_findings",
    Base.metadata,
    Column("work_package_id", ForeignKey("work_packages.id", ondelete="CASCADE"), primary_key=True),
    Column("action_item_id", ForeignKey("action_items.id", ondelete="CASCADE"), primary_key=True),
)


class WorkPackage(TimestampMixin, Base):
    """Remediation work package (WP-###); may bundle findings from several entities."""

    __tablename__ = "work_packages"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    entity_id: Mapped[int | None] = mapped_column(
        ForeignKey("entities.id", ondelete="SET NULL")
    )  # NULL = group
    measure_area: Mapped[str | None] = mapped_column(String(100))
    central_or_local: Mapped[str] = mapped_column(String(10), default="Central")
    priority: Mapped[str] = mapped_column(String(10), default="Medium")
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    owner_stakeholder_id: Mapped[int | None] = mapped_column(
        ForeignKey("stakeholders.id", ondelete="SET NULL")
    )
    planned_start: Mapped[date | None] = mapped_column(Date)
    planned_finish: Mapped[date | None] = mapped_column(Date, index=True)
    acceptance_criterion: Mapped[str | None] = mapped_column(Text)
    expected_evidence: Mapped[str | None] = mapped_column(Text)
    dependency: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="Not Started", index=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    progress_mode: Mapped[str] = mapped_column(String(10), default="tasks")  # tasks | manual
    budget_eur: Mapped[float | None] = mapped_column(Float)
    comments: Mapped[str | None] = mapped_column(Text)
    activity_id: Mapped[int | None] = mapped_column(ForeignKey("activities.id", ondelete="SET NULL"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entity: Mapped[Entity | None] = relationship(lazy="joined")
    owner: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[owner_id])
    owner_stakeholder: Mapped[Stakeholder | None] = relationship(lazy="joined")
    findings: Mapped[list["ActionItem"]] = relationship(  # noqa: F821
        "ActionItem", secondary=work_package_findings, lazy="selectin"
    )


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(20), unique=True)  # T-123
    title: Mapped[str] = mapped_column(String(400))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="todo", index=True)
    priority: Mapped[str] = mapped_column(String(10), default="Medium")
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    reporter_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    start_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date, index=True)
    estimate_hours: Mapped[float | None] = mapped_column(Float)
    labels: Mapped[list[str]] = mapped_column(JSON, default=list)
    checklist: Mapped[list] = mapped_column(JSON, default=list)  # [{"text": str, "done": bool}]
    sort_order: Mapped[float] = mapped_column(Float, default=0.0)  # position within kanban column
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))
    work_package_id: Mapped[int | None] = mapped_column(
        ForeignKey("work_packages.id", ondelete="SET NULL"), index=True
    )
    activity_id: Mapped[int | None] = mapped_column(ForeignKey("activities.id", ondelete="SET NULL"))
    action_item_id: Mapped[int | None] = mapped_column(ForeignKey("action_items.id", ondelete="SET NULL"))
    answer_id: Mapped[int | None] = mapped_column(ForeignKey("answers.id", ondelete="SET NULL"))
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="SET NULL"))

    assignee: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[assignee_id])
    reporter: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[reporter_id])
    work_package: Mapped[WorkPackage | None] = relationship(lazy="joined")
    entity: Mapped[Entity | None] = relationship(lazy="joined")


class RaciActivity(Base):
    __tablename__ = "raci_activities"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class RaciColumn(Base):
    __tablename__ = "raci_columns"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    stakeholder_id: Mapped[int | None] = mapped_column(ForeignKey("stakeholders.id", ondelete="SET NULL"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class RaciCell(Base):
    __tablename__ = "raci_cells"
    __table_args__ = (UniqueConstraint("activity_id", "column_id", name="uq_raci_cell"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("raci_activities.id", ondelete="CASCADE"))
    column_id: Mapped[int] = mapped_column(ForeignKey("raci_columns.id", ondelete="CASCADE"))
    value: Mapped[str] = mapped_column(String(5))


class RaidRecord(TimestampMixin, Base):
    """Risks, issues, decisions (and assumptions) register."""

    __tablename__ = "raid_records"
    __table_args__ = (UniqueConstraint("project_id", "code", name="uq_raid_code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(20))  # R1, I1, D1, A1
    type: Mapped[str] = mapped_column(String(20))
    date_raised: Mapped[date | None] = mapped_column(Date)
    title: Mapped[str] = mapped_column(Text)  # "Description" in the workbook
    impact: Mapped[str | None] = mapped_column(String(10))
    probability: Mapped[str | None] = mapped_column(String(10))
    severity: Mapped[str | None] = mapped_column(String(10))
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("stakeholders.id", ondelete="SET NULL"))
    mitigation: Mapped[str | None] = mapped_column(Text)
    target_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="Open")
    escalation_needed: Mapped[bool] = mapped_column(default=False)
    resolution: Mapped[str | None] = mapped_column(Text)
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="SET NULL"))

    owner: Mapped[Stakeholder | None] = relationship(lazy="joined")
