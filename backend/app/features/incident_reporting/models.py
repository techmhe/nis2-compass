from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.models.org import Entity

ROOT_CAUSE_CATEGORIES = {
    "phishing": "Phishing or social engineering",
    "credential_compromise": "Compromised credentials",
    "malware": "Malware or ransomware",
    "vulnerability": "Exploited vulnerability or missing patch",
    "misconfiguration": "Misconfiguration",
    "supplier": "Supplier or service provider failure",
    "human_error": "Human error",
    "system_failure": "Hardware or software failure",
    "dos": "Denial of service",
    "physical": "Physical or environmental event",
    "insider": "Malicious insider",
    "other": "Other",
}
REGIMES = ["nis2", "gdpr", "cra"]
RESULTS = ["significant", "not_significant", "undetermined"]


class IncidentProfile(TimestampMixin, Base):
    """Reporting attributes of an incident that the core incident record does not hold."""

    __tablename__ = "inc_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), unique=True)
    affected_entity_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    root_cause_category: Mapped[str | None] = mapped_column(String(40), index=True)
    financial_loss_eur: Mapped[float | None] = mapped_column(Float)
    personal_data_breach: Mapped[bool | None] = mapped_column(Boolean)  # GDPR Art. 33
    product_affected: Mapped[bool | None] = mapped_column(
        Boolean
    )  # CRA Art. 14 (product with digital elements)
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # set when resolved/closed
    supplier_ids: Mapped[list[int]] = mapped_column(JSON, default=list)  # involved suppliers (IR 5.1.4(d))
    follow_up_task_ids: Mapped[list[int]] = mapped_column(JSON, default=list)  # tasks from lessons learned


class IncidentAssessment(Base):
    """Significance assessment of an incident for one affected entity under its national regime."""

    __tablename__ = "inc_assessments"

    id: Mapped[int] = mapped_column(primary_key=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"))
    jurisdiction: Mapped[str] = mapped_column(String(2))  # DE | NL
    sector_profile: Mapped[str] = mapped_column(String(30), default="default")
    answers: Mapped[dict] = mapped_column(JSON, default=dict)  # {criterion_key: yes|no|unknown}
    suggested_result: Mapped[str] = mapped_column(String(20))
    result: Mapped[str] = mapped_column(String(20))
    rationale: Mapped[str | None] = mapped_column(Text)
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    entity: Mapped[Entity] = relationship(lazy="joined")


class ReportTrack(TimestampMixin, Base):
    """Reporting obligation of one affected entity towards one authority (NIS-2, GDPR or CRA)."""

    __tablename__ = "inc_report_tracks"
    __table_args__ = (
        UniqueConstraint("incident_id", "entity_id", "regime", "authority", name="uq_inc_track"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"))
    regime: Mapped[str] = mapped_column(String(10))  # nis2 | gdpr | cra
    jurisdiction: Mapped[str | None] = mapped_column(String(2))  # DE | NL (nis2 / gdpr)
    authority: Mapped[str] = mapped_column(String(200))
    aware_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )  # overrides the incident's aware_at
    reference: Mapped[str | None] = mapped_column(String(200))  # case number at the authority
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | withdrawn
    notes: Mapped[str | None] = mapped_column(Text)

    entity: Mapped[Entity] = relationship(lazy="joined")


class ReportStage(TimestampMixin, Base):
    """Recorded state of one stage of a track (the due date itself is computed)."""

    __tablename__ = "inc_report_stages"
    __table_args__ = (UniqueConstraint("track_id", "stage", name="uq_inc_stage"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    track_id: Mapped[int] = mapped_column(ForeignKey("inc_report_tracks.id", ondelete="CASCADE"), index=True)
    stage: Mapped[str] = mapped_column(
        String(20)
    )  # early_warning | notification | intermediate | progress | final
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reference: Mapped[str | None] = mapped_column(String(200))
    checklist: Mapped[dict] = mapped_column(JSON, default=dict)  # {item_key: bool}
    note: Mapped[str | None] = mapped_column(Text)
    requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )  # intermediate report request
    due_override: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )  # deadline set by the authority
