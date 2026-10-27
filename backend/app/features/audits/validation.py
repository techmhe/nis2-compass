"""Input validation helpers: bounded dates and partial updates (PATCH semantics).

Self-contained copy of the pattern used by app.features.governance.validation, so this module stays independent
of the governance module."""

from datetime import date
from typing import Annotated, Any

from fastapi.exceptions import RequestValidationError
from pydantic import AfterValidator, BaseModel, ValidationError, create_model
from pydantic.fields import FieldInfo

MIN_DATE = date(1990, 1, 1)
MAX_DATE = date(2100, 12, 31)


def _bounded(d: date | None) -> date | None:
    if d is None:
        return d
    if d < MIN_DATE or d > MAX_DATE:
        raise ValueError(f"Date must be between {MIN_DATE.isoformat()} and {MAX_DATE.isoformat()}")
    return d


BoundedDate = Annotated[date, AfterValidator(_bounded)]


def partial_model(model: type[BaseModel], name: str) -> type[BaseModel]:
    """Copy of `model` with every field optional and defaulting to None, for PATCH-style updates."""
    fields: dict[str, Any] = {}
    for n, f in model.model_fields.items():
        fi = FieldInfo.merge_field_infos(f, default=None)
        fi.default_factory = None
        fields[n] = (f.annotation | None, fi)
    return create_model(name, **fields)


def merge_update(
    obj: Any, patch: BaseModel, full: type[BaseModel], extra_current: dict | None = None
) -> BaseModel:
    """Merge the sent fields of `patch` into the current state of `obj` and validate the result with `full`."""
    current = {k: getattr(obj, k) for k in full.model_fields if hasattr(obj, k)}
    if extra_current:
        current.update(extra_current)
    data = patch.model_dump(exclude_unset=True)
    try:
        return full.model_validate({**current, **data})
    except ValidationError as e:
        raise RequestValidationError(e.errors()) from None
