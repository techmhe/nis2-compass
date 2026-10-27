from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ReportSnapshot(Base):
    """Frozen copy of a generated report (management report, SoA) for traceability over time."""

    __tablename__ = "report_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(30))  # management | soa
    title: Mapped[str] = mapped_column(String(300))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    round_id: Mapped[int | None] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSON)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
