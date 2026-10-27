from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin
from app.models.auth import User


class Entity(TimestampMixin, Base):
    """A legal entity of the group that is assessed (code is the short key)."""

    __tablename__ = "entities"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)  # sheet/tab key
    name: Mapped[str] = mapped_column(String(200))  # full legal name (display name)
    finding_prefix: Mapped[str] = mapped_column(String(20))
    country: Mapped[str | None] = mapped_column(String(2))  # ISO country code: DE, NL ...
    is_headquarters: Mapped[bool] = mapped_column(Boolean, default=False)
    legal_form: Mapped[str | None] = mapped_column(String(60))  # GmbH, B.V. ...
    size_class: Mapped[str | None] = mapped_column(String(10))  # micro | small | medium | large
    activity_sector: Mapped[str | None] = mapped_column(String(300))
    nis2_classification: Mapped[str | None] = mapped_column(
        String(40)
    )  # essential | important | not_in_scope | tbd
    competent_authority: Mapped[str | None] = mapped_column(String(300))
    csirt: Mapped[str | None] = mapped_column(String(300))
    registration_status: Mapped[str | None] = mapped_column(
        String(40)
    )  # not_registered | submitted | confirmed
    registration_date: Mapped[date | None] = mapped_column(Date)
    registration_reference: Mapped[str | None] = mapped_column(String(200))
    employees: Mapped[int | None] = mapped_column(Integer)
    annual_turnover_meur: Mapped[float | None]
    address: Mapped[str | None] = mapped_column(Text)
    contact_name: Mapped[str | None] = mapped_column(String(200))
    contact_email: Mapped[str | None] = mapped_column(String(320))
    notes: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Stakeholder(TimestampMixin, Base):
    """Named responsibility holder: a role (e.g. 'Information Security Officer') or a person.

    Used for 'Responsible' / 'Owner' pick-lists across assessments, action plan, master plan and RACI.
    Can be linked to a user so the item shows up in that user's personal task view.
    """

    __tablename__ = "stakeholders"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    kind: Mapped[str] = mapped_column(String(20), default="role")  # role | person | external
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    email: Mapped[str | None] = mapped_column(String(320))
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="SET NULL"))
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    user: Mapped[User | None] = relationship(lazy="joined")
