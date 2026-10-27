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
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.models.catalog import Requirement
from app.models.org import Entity, Stakeholder

# Pick-list values taken verbatim from the GAP workbook (Lists sheet)
SCOPE_VALUES = ["In Scope", "Central at HQ", "Not Applicable"]
IMPL_VALUES = ["Yes", "Partial", "No", "N/A"]
EFF_VALUES = ["Effective", "Partial", "Not Tested", "Ineffective", "N/A"]
EFFORT_VALUES = ["Low", "Medium", "High"]
PRIORITY_VALUES = ["High", "Medium", "Low"]
ACTION_STATUS_VALUES = ["Not Started", "In Progress", "Completed", "Blocked", "Deferred"]


class AssessmentRound(TimestampMixin, Base):
    """An assessment campaign across entities (e.g. 'Round 1 - 2026'); enables progress tracking over rounds."""

    __tablename__ = "assessment_rounds"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="active")  # planned | active | closed
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    # snapshot of chapter targets at close time: {chapter_number: target}
    targets_snapshot: Mapped[dict | None] = mapped_column(JSON)

    assessments: Mapped[list["Assessment"]] = relationship(back_populates="round")


class Assessment(TimestampMixin, Base):
    """One entity's assessment within a round (= one entity sheet in the workbook)."""

    __tablename__ = "assessments"
    __table_args__ = (UniqueConstraint("round_id", "entity_id", name="uq_assessment_round_entity"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    round_id: Mapped[int] = mapped_column(ForeignKey("assessment_rounds.id", ondelete="CASCADE"), index=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="not_started")
    # not_started | in_progress | in_review | completed
    assessment_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    respondents: Mapped[str | None] = mapped_column(Text)
    assessors: Mapped[str | None] = mapped_column(Text)
    lead_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    summary: Mapped[str | None] = mapped_column(Text)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    round: Mapped[AssessmentRound] = relationship(back_populates="assessments", lazy="joined")
    entity: Mapped[Entity] = relationship(lazy="joined")


class Answer(TimestampMixin, Base):
    """One row of an entity sheet: the assessment of one requirement for one entity."""

    __tablename__ = "answers"
    __table_args__ = (UniqueConstraint("assessment_id", "requirement_id", name="uq_answer_req"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"), index=True)
    requirement_id: Mapped[int] = mapped_column(ForeignKey("requirements.id", ondelete="CASCADE"), index=True)

    scope: Mapped[str] = mapped_column(String(20), default="In Scope")
    implemented: Mapped[str | None] = mapped_column(String(20))
    documented: Mapped[str | None] = mapped_column(String(20))
    effectiveness: Mapped[str | None] = mapped_column(String(20))
    evidence: Mapped[str | None] = mapped_column(Text)
    gap_description: Mapped[str | None] = mapped_column(Text)
    recommended_action: Mapped[str | None] = mapped_column(Text)
    responsible_id: Mapped[int | None] = mapped_column(ForeignKey("stakeholders.id", ondelete="SET NULL"))
    target_date: Mapped[date | None] = mapped_column(Date)
    effort: Mapped[str | None] = mapped_column(String(10))
    notes: Mapped[str | None] = mapped_column(Text)  # internal interview notes
    review_status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | reviewed

    # calculated (kept in sync by services.scoring)
    score: Mapped[float | None] = mapped_column(Float)
    wp_required: Mapped[bool | None] = mapped_column(Boolean)
    finding_id: Mapped[str | None] = mapped_column(String(40), index=True)

    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    assessment: Mapped[Assessment] = relationship(lazy="joined")
    requirement: Mapped[Requirement] = relationship(lazy="joined")
    responsible: Mapped[Stakeholder | None] = relationship(lazy="joined")


class AnswerRevision(Base):
    __tablename__ = "answer_revisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    answer_id: Mapped[int] = mapped_column(ForeignKey("answers.id", ondelete="CASCADE"), index=True)
    changed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    changes: Mapped[dict] = mapped_column(JSON)  # {field: [old, new]}


class ActionItem(TimestampMixin, Base):
    """Consolidated Action Plan entry (AP-###) derived from a finding (entity + requirement)."""

    __tablename__ = "action_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # AP-001
    round_id: Mapped[int | None] = mapped_column(ForeignKey("assessment_rounds.id", ondelete="SET NULL"))
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    requirement_id: Mapped[int] = mapped_column(ForeignKey("requirements.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(Text)  # "Work Package" column in the action plan
    priority: Mapped[str] = mapped_column(String(10), default="Medium")
    acceptance_criterion: Mapped[str | None] = mapped_column(Text)
    expected_evidence: Mapped[str | None] = mapped_column(Text)
    responsible_id: Mapped[int | None] = mapped_column(ForeignKey("stakeholders.id", ondelete="SET NULL"))
    target_date: Mapped[date | None] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="Not Started", index=True)
    comments: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entity: Mapped[Entity] = relationship(lazy="joined")
    requirement: Mapped[Requirement] = relationship(lazy="joined")
    responsible: Mapped[Stakeholder | None] = relationship(lazy="joined")


class SavedView(Base):
    """Per-user saved filters for tables (assessment grid, tasks, documents...)."""

    __tablename__ = "saved_views"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    scope: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(120))
    filters: Mapped[dict] = mapped_column(JSON, default=dict)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
