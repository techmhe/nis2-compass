from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, Boolean, Computed, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.auth import User


class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (Index("ix_comments_target", "target_type", "target_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    target_type: Mapped[str] = mapped_column(String(30))
    target_id: Mapped[int] = mapped_column(Integer)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    author: Mapped[User | None] = relationship(lazy="joined")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_target", "target_type", "target_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    actor_label: Mapped[str | None] = mapped_column(String(320))
    action: Mapped[str] = mapped_column(String(60), index=True)  # create | update | delete | login ...
    target_type: Mapped[str | None] = mapped_column(String(30))
    target_id: Mapped[int | None] = mapped_column(Integer)
    target_label: Mapped[str | None] = mapped_column(String(400))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    details: Mapped[dict | None] = mapped_column(JSON)
    ip: Mapped[str | None] = mapped_column(String(64))


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))  # task_assigned | mention | due_soon | comment ...
    title: Mapped[str] = mapped_column(String(400))
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(400))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    dedupe_key: Mapped[str | None] = mapped_column(String(200), index=True)


class Setting(Base):
    """Key/value application settings editable in the admin UI (secrets stored encrypted)."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SearchChunk(Base):
    """Unified search / retrieval index over every searchable object (documents, answers, requirements,
    provisions, tasks, work packages, RAID records ...). Used by global search and by the AI assistant."""

    __tablename__ = "search_chunks"
    __table_args__ = (
        Index("ix_search_source", "source_type", "source_id"),
        Index("ix_search_tsv", "tsv", postgresql_using="gin"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source_type: Mapped[str] = mapped_column(String(30))
    source_id: Mapped[int] = mapped_column(Integer)
    chunk_no: Mapped[int] = mapped_column(Integer, default=0)
    entity_id: Mapped[int | None] = mapped_column(Integer, index=True)
    title: Mapped[str] = mapped_column(String(600))
    content: Mapped[str] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(String(400))
    meta: Mapped[dict | None] = mapped_column(JSON)
    tsv = mapped_column(
        TSVECTOR,
        Computed(
            "setweight(to_tsvector('english', coalesce(title,'')), 'A') || "
            "setweight(to_tsvector('german', coalesce(title,'')), 'A') || "
            "setweight(to_tsvector('english', coalesce(content,'')), 'B') || "
            "setweight(to_tsvector('simple', coalesce(content,'')), 'C')",
            persisted=True,
        ),
    )
    embedding = mapped_column(Vector(), nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(200))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
