from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.models.auth import User
from app.models.org import Entity, Stakeholder

TREATMENTS = ["reduce", "avoid", "accept", "transfer"]
RISK_STATUS = ["identified", "assessed", "in_treatment", "accepted", "closed"]
LEVELS = ["low", "medium", "high", "very_high"]
RISK_CATEGORIES = [
    "Cyber attack",
    "Technical failure",
    "Human error",
    "Physical and environmental",
    "Supplier and third party",
    "Organisational and legal",
]
ACCEPTANCE_CATEGORIES = [
    "Within risk appetite",
    "Treatment cost disproportionate to the risk",
    "Temporary until planned treatment is completed",
    "No relevance to the services provided",
]
LINK_TYPES = ["gap", "control", "affected", "treatment"]


class RiskMethod(TimestampMixin, Base):
    """Risk assessment methodology (Cbb Art. 7, IR 2.1.2): scales, matrix thresholds, appetite and acceptance
    criteria. entity_id NULL = group default; an entity row overrides the default for that entity."""

    __tablename__ = "risk_methods"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    # five entries each: {"label": "...", "description": "..."}; index 0 = value 1
    likelihood_scale: Mapped[list] = mapped_column(JSON)
    impact_scale: Mapped[list] = mapped_column(JSON)
    # lowest score (likelihood x impact, 1..25) of each level above "low"
    threshold_medium: Mapped[int] = mapped_column(Integer, default=5)
    threshold_high: Mapped[int] = mapped_column(Integer, default=10)
    threshold_very_high: Mapped[int] = mapped_column(Integer, default=16)
    # highest residual level that may be accepted without a management body decision
    appetite_level: Mapped[str] = mapped_column(String(20), default="medium")
    acceptance_criteria: Mapped[str | None] = mapped_column(Text)
    review_cycle_months: Mapped[int] = mapped_column(Integer, default=12)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    entity: Mapped[Entity | None] = relationship(lazy="joined")


class Threat(TimestampMixin, Base):
    """Threat catalogue (all-hazards): BSI elementary threats G 0.x plus OT threats. Titles only."""

    __tablename__ = "risk_threats"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    title: Mapped[str] = mapped_column(String(300))
    category: Mapped[str] = mapped_column(String(60))
    source: Mapped[str | None] = mapped_column(String(120))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Risk(TimestampMixin, Base):
    """An information security risk (RSK-###) of one entity or of the group (entity_id NULL)."""

    __tablename__ = "risks"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(400))
    scenario: Mapped[str | None] = mapped_column(Text)
    threat_id: Mapped[int | None] = mapped_column(ForeignKey("risk_threats.id", ondelete="SET NULL"))
    category: Mapped[str | None] = mapped_column(String(60))
    owner_stakeholder_id: Mapped[int | None] = mapped_column(
        ForeignKey("stakeholders.id", ondelete="SET NULL")
    )
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    inherent_likelihood: Mapped[int | None] = mapped_column(Integer)
    inherent_impact: Mapped[int | None] = mapped_column(Integer)
    existing_controls: Mapped[str | None] = mapped_column(Text)
    residual_likelihood: Mapped[int | None] = mapped_column(Integer)
    residual_impact: Mapped[int | None] = mapped_column(Integer)
    treatments: Mapped[list[str]] = mapped_column(JSON, default=list)
    treatment_justification: Mapped[str | None] = mapped_column(Text)
    acceptance_category: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default="identified", index=True)
    next_review_date: Mapped[date | None] = mapped_column(Date)
    last_reviewed_at: Mapped[date | None] = mapped_column(Date)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_by: Mapped[str | None] = mapped_column(String(200))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    entity: Mapped[Entity | None] = relationship(lazy="joined")
    threat: Mapped[Threat | None] = relationship(lazy="joined")
    owner_stakeholder: Mapped[Stakeholder | None] = relationship(lazy="joined")
    owner_user: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[owner_user_id])


class RiskLink(Base):
    """Links a risk to other objects: the gap it came from (answer), existing controls (answers), affected objects
    (any registered target: answers, documents, assets, suppliers ...) and treatment actions (action items, WPs)."""

    __tablename__ = "risk_links"
    __table_args__ = (
        UniqueConstraint("risk_id", "link_type", "target_type", "target_id", name="uq_risk_link"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    risk_id: Mapped[int] = mapped_column(ForeignKey("risks.id", ondelete="CASCADE"), index=True)
    link_type: Mapped[str] = mapped_column(String(20))
    target_type: Mapped[str] = mapped_column(String(30), index=True)
    target_id: Mapped[int] = mapped_column(Integer, index=True)
    note: Mapped[str | None] = mapped_column(String(400))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
