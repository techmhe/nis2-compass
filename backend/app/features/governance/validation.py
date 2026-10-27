"""Input validation helpers: bounded dates, partial updates (PATCH semantics) and owner checks."""

from datetime import date
from typing import Annotated, Any

from fastapi.exceptions import RequestValidationError
from pydantic import AfterValidator, BaseModel, ValidationError, create_model
from pydantic.fields import FieldInfo
from sqlalchemy.orm import Session

from app.core.deps import user_can
from app.services.notify import owner_user as notify_owner_user

MIN_DATE = date(1990, 1, 1)
MAX_DATE = date(2100, 12, 31)


def _bounded(d: date | None) -> date | None:
    if d is None:
        return d
    if d < MIN_DATE or d > MAX_DATE:
        raise ValueError(f"Date must be between {MIN_DATE.isoformat()} and {MAX_DATE.isoformat()}")
    return d


BoundedDate = Annotated[date, AfterValidator(_bounded)]


def not_future(d: date | None, what: str) -> None:
    if d and d > date.today():
        raise RequestValidationError(
            [
                {
                    "loc": ("body", what),
                    "msg": f"{what.replace('_', ' ').capitalize()} cannot be in the future",
                    "type": "value_error",
                }
            ]
        )


def partial_model(model: type[BaseModel], name: str) -> type[BaseModel]:
    """Copy of `model` with every field optional and defaulting to None, for PATCH-style updates.
    Only the fields actually sent (exclude_unset) are applied; the merged result is re-validated with `model`."""
    fields: dict[str, Any] = {}
    for n, f in model.model_fields.items():
        fi = FieldInfo.merge_field_infos(f, default=None)
        fi.default_factory = None
        fields[n] = (f.annotation | None, fi)
    return create_model(name, **fields)


def merge_update(
    obj: Any, patch: BaseModel, full: type[BaseModel], extra_current: dict | None = None
) -> BaseModel:
    """Merge the sent fields of `patch` into the current state of `obj` and validate the result with `full`.
    Omitted fields keep their current value; explicit nulls for required fields are rejected (422)."""
    current = {k: getattr(obj, k) for k in full.model_fields if hasattr(obj, k)}
    if extra_current:
        current.update(extra_current)
    data = patch.model_dump(exclude_unset=True)
    try:
        return full.model_validate({**current, **data})
    except ValidationError as e:
        raise RequestValidationError(e.errors()) from None


def user_can_read_gov(db: Session, user_id: int | None, entity_id: int | None) -> bool:
    return user_can(db, user_id, "governance.read", entity_id)


def owner_user_id(db: Session, owner_user: int | None, owner_stakeholder: int | None) -> int | None:
    """The user behind an obligation owner (direct user, else the stakeholder's linked user)."""
    return notify_owner_user(db, owner_user, owner_stakeholder)
