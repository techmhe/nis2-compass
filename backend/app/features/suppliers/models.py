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
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin

supplier_entities = Table(
    "sup_supplier_entities",
    Base.metadata,
    Column("supplier_id", ForeignKey("sup_suppliers.id", ondelete="CASCADE"), primary_key=True),
    Column("entity_id", ForeignKey("entities.id", ondelete="CASCADE"), primary_key=True),
)

supplier_incidents = Table(
    "sup_supplier_incidents",
    Base.metadata,
    Column("supplier_id", ForeignKey("sup_suppliers.id", ondelete="CASCADE"), primary_key=True),
    Column("incident_id", ForeignKey("incidents.id", ondelete="CASCADE"), primary_key=True),
)


class Supplier(TimestampMixin, Base):
    """Direct supplier or service provider (group-level master record, used by one or more entities)."""

    __tablename__ = "sup_suppliers"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # SUP-001
    name: Mapped[str] = mapped_column(String(300))
    legal_name: Mapped[str | None] = mapped_column(String(300))
    country: Mapped[str | None] = mapped_column(String(2))
    website: Mapped[str | None] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    services_products: Mapped[str | None] = mapped_column(
        Text
    )  # ICT products / services / processes (IR 5.2 b)
    category: Mapped[str | None] = mapped_column(String(100))  # MSP, cloud, OT maintenance, telecom ...
    access_type: Mapped[str] = mapped_column(
        String(20), default="none"
    )  # none | it_remote | ot_remote | cloud_data
    tier: Mapped[str | None] = mapped_column(String(20))  # critical | high | standard (effective tier)
    tier_overridden: Mapped[bool] = mapped_column(default=False)  # False: tier follows the derived suggestion
    tier_rationale: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | onboarding | offboarded
    contacts: Mapped[list] = mapped_column(JSON, default=list)  # [{name, role, email, phone}] (IR 5.2 a)
    relationship_owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("stakeholders.id", ondelete="SET NULL")
    )
    contract_reference: Mapped[str | None] = mapped_column(String(200))
    contract_end: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)

    certificates: Mapped[list["SupplierCertificate"]] = relationship(
        back_populates="supplier", cascade="all, delete-orphan", order_by="SupplierCertificate.valid_until"
    )
    clauses: Mapped[list["SupplierClause"]] = relationship(
        back_populates="supplier", cascade="all, delete-orphan", order_by="SupplierClause.clause"
    )
    assessments: Mapped[list["SupplierAssessment"]] = relationship(
        back_populates="supplier",
        cascade="all, delete-orphan",
        order_by="SupplierAssessment.assessed_on.desc()",
    )

    @property
    def entity_ids(self) -> list[int]:
        """Using entities (M:N). Used by the generic comment / document-link permission check: read = any of the
        entities (or a group supplier without entities), write = all of them."""
        from sqlalchemy import select
        from sqlalchemy.orm import object_session

        db = object_session(self)
        if db is None or self.id is None:
            return []
        return sorted(
            db.scalars(
                select(supplier_entities.c.entity_id).where(supplier_entities.c.supplier_id == self.id)
            )
        )


class SupplierCertificate(TimestampMixin, Base):
    __tablename__ = "sup_certificates"

    id: Mapped[int] = mapped_column(primary_key=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("sup_suppliers.id", ondelete="CASCADE"), index=True)
    cert_type: Mapped[str] = mapped_column(String(60))  # ISO/IEC 27001, TISAX, SOC 2 Type II, IEC 62443 ...
    scope: Mapped[str | None] = mapped_column(Text)
    issuer: Mapped[str | None] = mapped_column(String(200))
    valid_until: Mapped[date | None] = mapped_column(Date)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(Text)

    supplier: Mapped[Supplier] = relationship(back_populates="certificates")


class SupplierClause(TimestampMixin, Base):
    """Contract clause checklist per supplier for IR 2024/2690 Annex point 5.1.4 (a)–(h)."""

    __tablename__ = "sup_contract_clauses"
    __table_args__ = (
        UniqueConstraint("supplier_id", "clause", name="uq_sup_contract_clauses_supplier_clause"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("sup_suppliers.id", ondelete="CASCADE"), index=True)
    clause: Mapped[str] = mapped_column(String(2))  # a..h
    status: Mapped[str] = mapped_column(String(20), default="missing")  # agreed | partial | missing | na
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))
    reference: Mapped[str | None] = mapped_column(String(200))  # e.g. "MSA § 12.3, DPA annex 2"
    note: Mapped[str | None] = mapped_column(Text)

    supplier: Mapped[Supplier] = relationship(back_populates="clauses")


class SupplierAssessment(TimestampMixin, Base):
    __tablename__ = "sup_assessments"

    id: Mapped[int] = mapped_column(primary_key=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("sup_suppliers.id", ondelete="CASCADE"), index=True)
    assessed_on: Mapped[date] = mapped_column(Date)
    method: Mapped[str] = mapped_column(String(30))  # questionnaire | certificate_review | audit | on_site
    score: Mapped[float | None] = mapped_column(Float)  # 0..100
    rating: Mapped[str | None] = mapped_column(String(20))  # acceptable | conditional | not_acceptable
    summary: Mapped[str | None] = mapped_column(Text)
    findings: Mapped[list] = mapped_column(JSON, default=list)  # [{text, severity, action_item_id}]
    answers: Mapped[list] = mapped_column(
        JSON, default=list
    )  # questionnaire answers [{id, question, answer, comment}]
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("sup_questionnaire_templates.id", ondelete="SET NULL")
    )
    template_version: Mapped[int | None] = mapped_column(Integer)
    next_due: Mapped[date | None] = mapped_column(Date)
    assessor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    supplier: Mapped[Supplier] = relationship(back_populates="assessments")


class QuestionnaireTemplate(Base):
    """Versioned question set per tier. Editing creates a new version; old versions stay for traceability."""

    __tablename__ = "sup_questionnaire_templates"
    __table_args__ = (
        UniqueConstraint("tier", "version", name="uq_sup_questionnaire_templates_tier_version"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tier: Mapped[str] = mapped_column(String(20))
    version: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(300))
    questions: Mapped[list] = mapped_column(JSON, default=list)  # [{id, section, text, reference, weight}]
    change_note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
