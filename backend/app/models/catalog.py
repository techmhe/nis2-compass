from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, TimestampMixin


class Chapter(TimestampMixin, Base):
    __tablename__ = "chapters"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(Integer, unique=True)
    title: Mapped[str] = mapped_column(String(300))
    target: Mapped[float] = mapped_column(Float, default=0.75)  # chapter target score (0..1)
    source: Mapped[str] = mapped_column(String(40), default="IR2024/2690")  # IR2024/2690 | national
    description: Mapped[str | None] = mapped_column(Text)

    requirements: Mapped[list["Requirement"]] = relationship(
        back_populates="chapter", order_by="Requirement.sort_order"
    )

    @property
    def label(self) -> str:
        return f"{self.number} {self.title}"


class ChapterTargetChange(Base):
    """Auditable history of chapter target changes (instructions: record date and reason for each change)."""

    __tablename__ = "chapter_target_changes"

    id: Mapped[int] = mapped_column(primary_key=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    old_target: Mapped[float | None] = mapped_column(Float)
    new_target: Mapped[float] = mapped_column(Float)
    reason: Mapped[str] = mapped_column(Text)
    changed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Requirement(TimestampMixin, Base):
    __tablename__ = "requirements"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # e.g. 6.7.2
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id"), index=True)
    section: Mapped[str] = mapped_column(String(400))
    text: Mapped[str] = mapped_column(Text)
    check_points: Mapped[str | None] = mapped_column(Text)
    legal_reference: Mapped[str | None] = mapped_column(String(400))
    iso_reference: Mapped[str | None] = mapped_column(String(400))
    is_core: Mapped[bool] = mapped_column(Boolean, default=False)
    guidance: Mapped[str | None] = mapped_column(Text)  # internal interview/assessment hints
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    chapter: Mapped[Chapter] = relationship(back_populates="requirements", lazy="joined")
