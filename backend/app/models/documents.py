from datetime import date, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
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
from app.models.org import Entity

DOC_TYPES = [
    "Policy",
    "Guideline",
    "Procedure",
    "Standard",
    "Concept",
    "Evidence",
    "Record",
    "Report",
    "Contract",
    "Certificate",
    "Presentation",
    "Template",
    "Other",
]
DOC_STATUS = ["Draft", "In Review", "Approved", "Retired"]
CLASSIFICATIONS = ["Public", "Internal", "Confidential", "Restricted"]


class Folder(TimestampMixin, Base):
    __tablename__ = "folders"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Document(TimestampMixin, Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(400))
    description: Mapped[str | None] = mapped_column(Text)
    doc_type: Mapped[str] = mapped_column(String(40), default="Other")
    status: Mapped[str] = mapped_column(String(20), default="Draft")
    classification: Mapped[str] = mapped_column(String(20), default="Internal")
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="SET NULL"), index=True)
    folder_id: Mapped[int | None] = mapped_column(ForeignKey("folders.id", ondelete="SET NULL"))
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    version_label: Mapped[str | None] = mapped_column(String(40))
    approved_at: Mapped[date | None] = mapped_column(Date)
    approved_by: Mapped[str | None] = mapped_column(String(200))
    next_review_date: Mapped[date | None] = mapped_column(Date)
    external_url: Mapped[str | None] = mapped_column(String(1000))
    current_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("document_versions.id", ondelete="SET NULL", use_alter=True)
    )
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    entity: Mapped[Entity | None] = relationship(lazy="joined")
    owner: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[owner_id])
    current_version: Mapped["DocumentVersion | None"] = relationship(
        lazy="joined", foreign_keys=[current_version_id], post_update=True
    )


class DocumentVersion(Base):
    __tablename__ = "document_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    filename: Mapped[str] = mapped_column(String(400))
    storage_key: Mapped[str] = mapped_column(String(100))  # random name on disk
    mime_type: Mapped[str] = mapped_column(String(200))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    extracted_text: Mapped[str | None] = mapped_column(Text)
    extraction_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|ok|empty|failed
    page_count: Mapped[int | None] = mapped_column(Integer)
    change_note: Mapped[str | None] = mapped_column(Text)
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    uploaded_by: Mapped[User | None] = relationship(lazy="joined")


class DocumentLink(Base):
    """Links a document to any other object (requirement, answer, action item, work package, task, provision...)."""

    __tablename__ = "document_links"
    __table_args__ = (UniqueConstraint("document_id", "target_type", "target_id", name="uq_document_link"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    target_type: Mapped[str] = mapped_column(String(30), index=True)
    target_id: Mapped[int] = mapped_column(Integer, index=True)
    note: Mapped[str | None] = mapped_column(String(400))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    document: Mapped[Document] = relationship(lazy="joined")


class DocumentAcknowledgement(Base):
    """Policy acknowledgement by users (IR 2024/2690 1.1.1(f): communicated and acknowledged)."""

    __tablename__ = "document_acknowledgements"
    __table_args__ = (UniqueConstraint("document_id", "version_id", "user_id", name="uq_doc_ack"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    version_id: Mapped[int | None] = mapped_column(ForeignKey("document_versions.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    acknowledged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    extra: Mapped[dict | None] = mapped_column(JSON)
