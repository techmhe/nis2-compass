from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditEvent

_SKIP = {"created_at", "updated_at", "password_hash", "extracted_text"}


def _plain(v: Any) -> Any:
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    if isinstance(v, (list, dict)):
        return v
    return str(v)


def apply_changes(obj: Any, data: dict[str, Any]) -> dict[str, list]:
    """Set attributes on obj and return a {field: [old, new]} diff of what actually changed."""
    diff: dict[str, list] = {}
    for k, v in data.items():
        old = getattr(obj, k)
        if old != v:
            setattr(obj, k, v)
            if k not in _SKIP:
                diff[k] = [_plain(old), _plain(v)]
    return diff


def audit(
    db: Session,
    actor,  # Principal | None
    action: str,
    target_type: str | None = None,
    target_id: int | None = None,
    label: str | None = None,
    entity_id: int | None = None,
    details: dict | None = None,
    ip: str | None = None,
) -> None:
    user = getattr(actor, "user", None)
    db.add(
        AuditEvent(
            actor_id=user.id if user else None,
            actor_label=user.email if user else "system",
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_label=(label or "")[:400] or None,
            entity_id=entity_id,
            details=details,
            ip=ip,
        )
    )
