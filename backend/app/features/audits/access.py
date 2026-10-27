"""Recipients for audit notifications."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import build_principal
from app.models import User


def audit_managers(db: Session, entity_id: int | None) -> list[int]:
    """Active users holding audits.manage for this entity (group-wide for group-level objects)."""
    return [
        u.id
        for u in db.scalars(select(User).where(User.is_active.is_(True)))
        if build_principal(u).can_write("audits.manage", entity_id)
    ]
