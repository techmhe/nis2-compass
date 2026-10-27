"""Governance data model.

- RequirementLegal: per requirement and jurisdiction (DE / NL / EU) whether it is binding law, a benchmark that
  concretises a binding duty, or guidance only, with the legal basis provision.
- EntityProfile: NIS2 entity type per legal entity and whether IR (EU) 2024/2690 applies (digital providers).
- Registration + RegistrationChange: § 33 BSIG / Cbw Art. 44 + Cbb Art. 27 registration data with the two-week
  change reporting duty (§ 33(5) BSIG, Cbw Art. 44(2)).
- Obligation: recurring and one-off governance duties (obligation calendar).
- BoardMember, BoardDecision, TrainingRecord, TrainingRule: management body register (§ 38 BSIG, Cbw Art. 24).
"""

from datetime import date, datetime, time

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.models.org import Entity

JURISDICTIONS = ["DE", "NL", "EU"]
LEGAL_STATUS = ["binding", "benchmark", "guidance"]
REG_STATUS = ["not_registered", "draft", "submitted", "confirmed"]
RECURRENCE = ["none", "monthly", "quarterly", "semiannual", "annual", "biennial"]
OBLIGATION_STATUS = ["open", "done", "cancelled"]
DECISION_TYPES = ["approve_measures", "approve_policy", "accept_risk", "budget", "oversight_review", "other"]


class RequirementLegal(TimestampMixin, Base):
    __tablename__ = "gov_requirement_legal"
    __table_args__ = (UniqueConstraint("requirement_id", "jurisdiction", name="uq_gov_requirement_legal"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    requirement_id: Mapped[int] = mapped_column(ForeignKey("requirements.id", ondelete="CASCADE"), index=True)
    jurisdiction: Mapped[str] = mapped_column(String(4))  # DE | NL | EU
    status: Mapped[str] = mapped_column(String(12))  # binding | benchmark | guidance
    basis_provision_id: Mapped[int | None] = mapped_column(ForeignKey("provisions.id", ondelete="SET NULL"))
    basis_label: Mapped[str | None] = mapped_column(String(300))
    note: Mapped[str | None] = mapped_column(Text)
    is_auto: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class EntityProfile(TimestampMixin, Base):
    __tablename__ = "gov_entity_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), unique=True)
    nis2_entity_type: Mapped[str | None] = mapped_column(String(300))
    ir_2024_2690_applicable: Mapped[bool] = mapped_column(Boolean, default=False)
    rationale: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[date | None] = mapped_column(Date)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    entity: Mapped[Entity] = relationship(lazy="joined")


class Registration(TimestampMixin, Base):
    __tablename__ = "gov_registrations"
    __table_args__ = (UniqueConstraint("entity_id", "jurisdiction", name="uq_gov_registration"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    jurisdiction: Mapped[str] = mapped_column(String(4))  # DE | NL
    portal: Mapped[str | None] = mapped_column(String(100))  # BSI portal | MijnNCSC
    status: Mapped[str] = mapped_column(String(20), default="draft")
    registration_number: Mapped[str | None] = mapped_column(String(200))
    submitted_at: Mapped[date | None] = mapped_column(Date)
    registered_at: Mapped[date | None] = mapped_column(Date)
    legal_name: Mapped[str | None] = mapped_column(String(300))
    legal_form: Mapped[str | None] = mapped_column(String(100))
    register_number: Mapped[str | None] = mapped_column(String(100))  # HRB / KvK
    address: Mapped[str | None] = mapped_column(Text)
    entity_type: Mapped[str | None] = mapped_column(String(200))  # essential / important (+ annex)
    contact_point: Mapped[str | None] = mapped_column(String(300))  # 24/7 contact point
    contact_point_phone: Mapped[str | None] = mapped_column(String(100))
    contact_point_email: Mapped[str | None] = mapped_column(String(320))
    contact_person: Mapped[str | None] = mapped_column(String(200))
    contact_person_phone: Mapped[str | None] = mapped_column(String(100))
    contact_person_email: Mapped[str | None] = mapped_column(String(320))
    public_ip_ranges: Mapped[list] = mapped_column(JSON, default=list)
    domain_names: Mapped[list] = mapped_column(JSON, default=list)
    sectors: Mapped[list] = mapped_column(JSON, default=list)
    member_states: Mapped[list] = mapped_column(JSON, default=list)
    authorities: Mapped[list] = mapped_column(JSON, default=list)
    scope_rationale: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)

    entity: Mapped[Entity] = relationship(lazy="joined")


class RegistrationChange(Base):
    __tablename__ = "gov_registration_changes"

    id: Mapped[int] = mapped_column(primary_key=True)
    registration_id: Mapped[int] = mapped_column(
        ForeignKey("gov_registrations.id", ondelete="CASCADE"), index=True
    )
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    field: Mapped[str] = mapped_column(String(60))
    field_label: Mapped[str] = mapped_column(String(120))
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    known_at: Mapped[date] = mapped_column(Date)
    due_at: Mapped[date] = mapped_column(Date)
    reported_at: Mapped[date | None] = mapped_column(Date)
    reported_reference: Mapped[str | None] = mapped_column(String(200))
    reported_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    registration: Mapped[Registration] = relationship(lazy="joined")


class Obligation(TimestampMixin, Base):
    __tablename__ = "gov_obligations"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(400))
    description: Mapped[str | None] = mapped_column(Text)
    legal_ref: Mapped[str | None] = mapped_column(String(200))
    due_date: Mapped[date] = mapped_column(Date, index=True)
    recurrence: Mapped[str] = mapped_column(String(20), default="none")
    owner_stakeholder_id: Mapped[int | None] = mapped_column(
        ForeignKey("stakeholders.id", ondelete="SET NULL")
    )
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="open")
    completed_at: Mapped[date | None] = mapped_column(Date)
    completed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    completion_note: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(
        String(40), default="manual"
    )  # seed | manual | board_member | training
    source_type: Mapped[str | None] = mapped_column(String(40))
    source_id: Mapped[int | None] = mapped_column(Integer)
    previous_id: Mapped[int | None] = mapped_column(ForeignKey("gov_obligations.id", ondelete="SET NULL"))

    entity: Mapped[Entity | None] = relationship(lazy="joined")


class BoardMember(TimestampMixin, Base):
    __tablename__ = "gov_board_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    function: Mapped[str | None] = mapped_column(String(200))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    email: Mapped[str | None] = mapped_column(String(320))
    appointed_at: Mapped[date | None] = mapped_column(Date)
    left_at: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)

    entity: Mapped[Entity] = relationship(lazy="joined")


class BoardDecision(TimestampMixin, Base):
    __tablename__ = "gov_board_decisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    decided_on: Mapped[date] = mapped_column(Date)
    decision_type: Mapped[str] = mapped_column(String(30))
    subject: Mapped[str] = mapped_column(String(400))
    description: Mapped[str | None] = mapped_column(Text)
    participants: Mapped[str | None] = mapped_column(Text)
    linked: Mapped[list] = mapped_column(JSON, default=list)  # [{type, id, label}]
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    entity: Mapped[Entity] = relationship(lazy="joined")


class TrainingRecord(TimestampMixin, Base):
    __tablename__ = "gov_trainings"

    id: Mapped[int] = mapped_column(primary_key=True)
    person_name: Mapped[str] = mapped_column(String(200))
    person_role: Mapped[str | None] = mapped_column(String(200))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    board_member_ids: Mapped[list] = mapped_column(JSON, default=list)
    entity_ids: Mapped[list] = mapped_column(JSON, default=list)
    title: Mapped[str] = mapped_column(String(300))
    provider: Mapped[str | None] = mapped_column(String(200))
    delivery: Mapped[str] = mapped_column(String(20), default="external")  # internal | external
    training_date: Mapped[date] = mapped_column(Date)
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    topics: Mapped[list] = mapped_column(JSON, default=list)
    legal_refs: Mapped[list] = mapped_column(JSON, default=list)
    # NL certificate (Cbb Art. 22): name, dates, topics, provider, language
    has_certificate: Mapped[bool] = mapped_column(Boolean, default=False)
    cert_holder_name: Mapped[str | None] = mapped_column(String(200))
    cert_issued_on: Mapped[date | None] = mapped_column(Date)
    cert_dates: Mapped[str | None] = mapped_column(String(200))
    cert_topics: Mapped[str | None] = mapped_column(Text)
    cert_provider: Mapped[str | None] = mapped_column(String(200))
    cert_language: Mapped[str | None] = mapped_column(String(10))
    notes: Mapped[str | None] = mapped_column(Text)

    @property
    def entity_id(self) -> int | None:
        """Scope for comments / document links: the single entity, or group level for multi-entity records."""
        ents = self.entity_ids or []
        return ents[0] if len(ents) == 1 else None


class TrainingRule(TimestampMixin, Base):
    __tablename__ = "gov_training_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    jurisdiction: Mapped[str] = mapped_column(String(4), unique=True)
    label: Mapped[str] = mapped_column(String(300))
    is_statutory: Mapped[bool] = mapped_column(Boolean, default=False)
    legal_ref: Mapped[str | None] = mapped_column(String(200))
    initial_months: Mapped[int] = mapped_column(Integer, default=12)
    count_from: Mapped[date | None] = mapped_column(
        Date
    )  # the initial period starts no earlier than this date
    cadence_months: Mapped[int | None] = mapped_column(Integer)  # None = one-off
    requires_certificate: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(Text)
