from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin

# service -> asset dependencies ("service X runs on / needs asset Y")
service_assets = Table(
    "inv_service_assets",
    Base.metadata,
    Column("service_id", ForeignKey("inv_services.id", ondelete="CASCADE"), primary_key=True),
    Column("asset_id", ForeignKey("inv_assets.id", ondelete="CASCADE"), primary_key=True),
)

# service -> supplier dependencies (e.g. a SaaS service or a managed service without an own asset record)
service_suppliers = Table(
    "inv_service_suppliers",
    Base.metadata,
    Column("service_id", ForeignKey("inv_services.id", ondelete="CASCADE"), primary_key=True),
    Column("supplier_id", ForeignKey("sup_suppliers.id", ondelete="CASCADE"), primary_key=True),
)

plan_services = Table(
    "inv_plan_services",
    Base.metadata,
    Column("plan_id", ForeignKey("inv_continuity_plans.id", ondelete="CASCADE"), primary_key=True),
    Column("service_id", ForeignKey("inv_services.id", ondelete="CASCADE"), primary_key=True),
)

exercise_services = Table(
    "inv_exercise_services",
    Base.metadata,
    Column("exercise_id", ForeignKey("inv_exercises.id", ondelete="CASCADE"), primary_key=True),
    Column("service_id", ForeignKey("inv_services.id", ondelete="CASCADE"), primary_key=True),
)

exercise_assets = Table(
    "inv_exercise_assets",
    Base.metadata,
    Column("exercise_id", ForeignKey("inv_exercises.id", ondelete="CASCADE"), primary_key=True),
    Column("asset_id", ForeignKey("inv_assets.id", ondelete="CASCADE"), primary_key=True),
)


class Service(TimestampMixin, Base):
    """Business service or process of an entity (entity_id NULL = shared group service)."""

    __tablename__ = "inv_services"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # SVC-001
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(20), default="service")  # service | process
    criticality: Mapped[int] = mapped_column(Integer, default=2)  # 1 low .. 4 critical
    nis2_relevant: Mapped[bool] = mapped_column(Boolean, default=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("stakeholders.id", ondelete="SET NULL"))
    rto_hours: Mapped[float | None] = mapped_column(Float)  # target recovery time objective
    rpo_hours: Mapped[float | None] = mapped_column(Float)  # target recovery point objective
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | planned | retired
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text)

    assets: Mapped[list["Asset"]] = relationship(
        secondary=service_assets, back_populates="services", order_by="Asset.name"
    )


class Asset(TimestampMixin, Base):
    __tablename__ = "inv_assets"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # AST-001
    external_id: Mapped[str | None] = mapped_column(
        String(120), index=True
    )  # CMDB / OT inventory id (import key)
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="SET NULL"), index=True)
    site: Mapped[str | None] = mapped_column(String(200))
    name: Mapped[str] = mapped_column(String(300))
    asset_type: Mapped[str] = mapped_column(
        String(20), default="IT"
    )  # IT | OT | cloud | data | facility | network
    description: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("stakeholders.id", ondelete="SET NULL"))
    confidentiality: Mapped[int | None] = mapped_column(Integer)  # 1 low .. 4 very high
    integrity: Mapped[int | None] = mapped_column(Integer)
    availability: Mapped[int | None] = mapped_column(Integer)
    criticality: Mapped[int | None] = mapped_column(Integer)  # 1 .. 4
    ot_zone: Mapped[str | None] = mapped_column(String(120))  # IEC 62443 zone (free text)
    ot_conduit: Mapped[str | None] = mapped_column(String(200))  # IEC 62443 conduit(s) (free text)
    supplier_id: Mapped[int | None] = mapped_column(
        ForeignKey("sup_suppliers.id", ondelete="SET NULL"), index=True
    )
    lifecycle: Mapped[str] = mapped_column(
        String(20), default="in_operation"
    )  # planned|in_operation|end_of_life|retired
    location: Mapped[str | None] = mapped_column(String(300))
    vendor_product: Mapped[str | None] = mapped_column(String(300))  # manufacturer / product / version
    crypto_algorithms: Mapped[str | None] = mapped_column(String(300))  # optional (Cbb art. 13)
    key_management_owner: Mapped[str | None] = mapped_column(String(200))  # optional
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text)

    services: Mapped[list[Service]] = relationship(secondary=service_assets, back_populates="assets")


class Bia(TimestampMixin, Base):
    """Business impact analysis of an entity for a period (IR 4.1.3)."""

    __tablename__ = "inv_bias"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    period: Mapped[str] = mapped_column(String(40))  # e.g. "2026"
    title: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | approved
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # 4-eyes principle: the approver must differ from the creator and the last editor
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_review: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)

    items: Mapped[list["BiaItem"]] = relationship(
        back_populates="bia", cascade="all, delete-orphan", order_by="BiaItem.sort_order"
    )


class BiaItem(TimestampMixin, Base):
    __tablename__ = "inv_bia_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    bia_id: Mapped[int] = mapped_column(ForeignKey("inv_bias.id", ondelete="CASCADE"), index=True)
    service_id: Mapped[int | None] = mapped_column(ForeignKey("inv_services.id", ondelete="SET NULL"))
    process_name: Mapped[str | None] = mapped_column(
        String(300)
    )  # when the item is a process without service record
    # {"operational": {"4h": 0..4, "24h": .., "72h": .., "1w": ..}, "financial": {...}, ...}
    impacts: Mapped[dict] = mapped_column(JSON, default=dict)
    mtpd_hours: Mapped[float | None] = mapped_column(Float)  # manual override; else derived from impacts
    rto_hours: Mapped[float | None] = mapped_column(Float)
    rpo_hours: Mapped[float | None] = mapped_column(Float)
    dependencies: Mapped[str | None] = mapped_column(
        Text
    )  # additional dependencies (people, external) free text
    min_staffing: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    bia: Mapped[Bia] = relationship(back_populates="items")


class ContinuityPlan(TimestampMixin, Base):
    __tablename__ = "inv_continuity_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # PLAN-001
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="SET NULL"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    plan_type: Mapped[str] = mapped_column(
        String(30), default="BCP"
    )  # BCP | DRP | crisis | incident_response
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("stakeholders.id", ondelete="SET NULL"))
    version: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | approved | retired
    last_tested: Mapped[date | None] = mapped_column(Date)
    test_interval_months: Mapped[int] = mapped_column(Integer, default=12)
    next_test_due: Mapped[date | None] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(Text)

    services: Mapped[list[Service]] = relationship(secondary=plan_services, order_by="Service.name")


class Exercise(TimestampMixin, Base):
    """Continuity exercise or backup restore test (IR 4.1, 4.2.6; Cbb art. 9)."""

    __tablename__ = "inv_exercises"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # EX-001
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="SET NULL"), index=True)
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("inv_continuity_plans.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(300))
    exercise_type: Mapped[str] = mapped_column(
        String(30)
    )  # tabletop | restore_test | failover | crisis_drill
    exercise_date: Mapped[date] = mapped_column(Date)
    participants: Mapped[str | None] = mapped_column(Text)
    objectives: Mapped[str | None] = mapped_column(Text)
    result: Mapped[str | None] = mapped_column(String(20))  # None = planned | passed | partially | failed
    achieved_rto_hours: Mapped[float | None] = mapped_column(Float)  # measured time to restore
    achieved_rpo_hours: Mapped[float | None] = mapped_column(Float)  # measured data loss window
    deviations: Mapped[str | None] = mapped_column(Text)
    lessons_learned: Mapped[str | None] = mapped_column(Text)
    action_item_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    task_ids: Mapped[list[int]] = mapped_column(JSON, default=list)

    services: Mapped[list[Service]] = relationship(secondary=exercise_services, order_by="Service.name")
    assets: Mapped[list[Asset]] = relationship(secondary=exercise_assets, order_by="Asset.name")
