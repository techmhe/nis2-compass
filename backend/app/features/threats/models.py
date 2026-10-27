from datetime import date

from sqlalchemy import (
    JSON,
    Column,
    Date,
    Float,
    ForeignKey,
    String,
    Table,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.features.inventory.models import Asset
from app.features.suppliers.models import Supplier
from app.models.org import Entity

SOURCES = ["CERT-Bund", "NCSC-NL", "BSI", "vendor_psirt", "supplier", "other"]
SEVERITIES = ["critical", "high", "medium", "low"]
RELEVANT = ["yes", "no", "unclear"]
YES_NO = ["yes", "no"]
ADVISORY_STATUS = ["new", "in_assessment", "assessed", "closed"]
VULN_STATUS = ["open", "in_progress", "mitigated", "remediated", "accepted"]

# Written-assessment deadline by severity (Cbb Art. 17): days from received_on
ASSESSMENT_DUE_DAYS = {"critical": 1, "high": 3, "medium": 10, "low": 30}
# Remediation deadline by severity (IR 2024/2690 6.10): days from discovered_on
REMEDIATION_DUE_DAYS = {"critical": 7, "high": 30, "medium": 90, "low": 180}

# advisory <-> asset (which assets the threat information concerns)
advisory_assets = Table(
    "thr_advisory_assets",
    Base.metadata,
    Column("advisory_id", ForeignKey("thr_advisories.id", ondelete="CASCADE"), primary_key=True),
    Column("asset_id", ForeignKey("inv_assets.id", ondelete="CASCADE"), primary_key=True),
)

# advisory <-> supplier (optional: the advisory concerns a supplier's product/service)
advisory_suppliers = Table(
    "thr_advisory_suppliers",
    Base.metadata,
    Column("advisory_id", ForeignKey("thr_advisories.id", ondelete="CASCADE"), primary_key=True),
    Column("supplier_id", ForeignKey("sup_suppliers.id", ondelete="CASCADE"), primary_key=True),
)

# vulnerability <-> asset
vulnerability_assets = Table(
    "thr_vulnerability_assets",
    Base.metadata,
    Column("vulnerability_id", ForeignKey("thr_vulnerabilities.id", ondelete="CASCADE"), primary_key=True),
    Column("asset_id", ForeignKey("inv_assets.id", ondelete="CASCADE"), primary_key=True),
)


class Advisory(TimestampMixin, Base):
    """Threat information received from a CSIRT, vendor PSIRT or supplier (Cbb Art. 17): logged, assessed in
    writing and, where relevant, turned into a vulnerability record and/or a follow-up task."""

    __tablename__ = "thr_advisories"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # ADV-0001
    title: Mapped[str] = mapped_column(String(300))
    source: Mapped[str] = mapped_column(String(20), default="other")
    reference: Mapped[str | None] = mapped_column(String(500))  # advisory id / URL
    received_on: Mapped[date] = mapped_column(Date)
    severity: Mapped[str] = mapped_column(String(10), default="medium")
    summary: Mapped[str | None] = mapped_column(Text)
    entity_scope: Mapped[str] = mapped_column(String(10), default="all")  # all | list
    entity_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    # written assessment (Cbb Art. 17)
    relevant: Mapped[str | None] = mapped_column(String(10))  # yes | no | unclear
    measures_need_adjustment: Mapped[str | None] = mapped_column(String(10))  # yes | no
    rationale: Mapped[str | None] = mapped_column(Text)
    assessed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    assessed_on: Mapped[date | None] = mapped_column(Date)
    assessment_due: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="new")

    vulnerability_ids: Mapped[list[int]] = mapped_column(
        JSON, default=list
    )  # vulnerabilities created from this
    task_ids: Mapped[list[int]] = mapped_column(JSON, default=list)  # tasks created from this

    assets: Mapped[list[Asset]] = relationship(secondary=advisory_assets, order_by=Asset.name)
    suppliers: Mapped[list[Supplier]] = relationship(secondary=advisory_suppliers, order_by=Supplier.name)


class Vulnerability(TimestampMixin, Base):
    """A concrete vulnerability tracked to remediation, optionally raised from an Advisory (IR 2024/2690 6.10)."""

    __tablename__ = "thr_vulnerabilities"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # VUL-0001
    title: Mapped[str] = mapped_column(String(300))
    cve_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    advisory_id: Mapped[int | None] = mapped_column(
        ForeignKey("thr_advisories.id", ondelete="SET NULL"), index=True
    )
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="SET NULL"), index=True)
    severity: Mapped[str] = mapped_column(String(10), default="medium")
    cvss: Mapped[float | None] = mapped_column(Float)
    discovered_on: Mapped[date] = mapped_column(Date)
    remediation_due: Mapped[date] = mapped_column(Date)
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    owner_stakeholder_id: Mapped[int | None] = mapped_column(
        ForeignKey("stakeholders.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(20), default="open")
    remediated_on: Mapped[date | None] = mapped_column(Date)
    exception_id: Mapped[int | None] = mapped_column(ForeignKey("ctl_exceptions.id", ondelete="SET NULL"))
    acceptance_justification: Mapped[str | None] = mapped_column(
        Text
    )  # required to accept without an exception
    notes: Mapped[str | None] = mapped_column(Text)
    task_ids: Mapped[list[int]] = mapped_column(JSON, default=list)

    entity: Mapped[Entity | None] = relationship(lazy="joined")
    assets: Mapped[list[Asset]] = relationship(secondary=vulnerability_assets, order_by=Asset.name)
