from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin

LINK_RELATIONS = ["benchmark", "legal_basis", "national_equivalent", "iso_mapping", "related"]


class Regulation(TimestampMixin, Base):
    __tablename__ = "regulations"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    title: Mapped[str] = mapped_column(Text)
    short_title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(
        String(40)
    )  # eu_directive | eu_regulation | national_law | standard ...
    jurisdiction: Mapped[str] = mapped_column(String(10))
    language: Mapped[str] = mapped_column(String(5))
    version_date: Mapped[date | None] = mapped_column(Date)
    source_url: Mapped[str | None] = mapped_column(String(1000))
    status_note: Mapped[str | None] = mapped_column(Text)
    license_note: Mapped[str | None] = mapped_column(Text)
    is_builtin: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Provision(Base):
    """A node in a regulation's structure (chapter, article/section, paragraph, point, control...)."""

    __tablename__ = "provisions"
    __table_args__ = (UniqueConstraint("regulation_id", "key", name="uq_provision_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    regulation_id: Mapped[int] = mapped_column(ForeignKey("regulations.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("provisions.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(80))
    ref: Mapped[str] = mapped_column(String(120))
    heading: Mapped[str | None] = mapped_column(Text)
    text: Mapped[str | None] = mapped_column(Text)
    depth: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)  # document order within regulation

    regulation: Mapped[Regulation] = relationship(lazy="joined")


class RequirementProvision(Base):
    __tablename__ = "requirement_provisions"
    __table_args__ = (UniqueConstraint("requirement_id", "provision_id", name="uq_req_provision"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    requirement_id: Mapped[int] = mapped_column(ForeignKey("requirements.id", ondelete="CASCADE"), index=True)
    provision_id: Mapped[int] = mapped_column(ForeignKey("provisions.id", ondelete="CASCADE"), index=True)
    relation: Mapped[str] = mapped_column(String(30), default="related")
    note: Mapped[str | None] = mapped_column(Text)
    is_auto: Mapped[bool] = mapped_column(default=True)  # created by the seeder (vs. manually curated)

    provision: Mapped[Provision] = relationship(lazy="joined")
