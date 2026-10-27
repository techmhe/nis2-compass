from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import get_or_404
from app.core.deps import Principal, require, require_global
from app.core.jurisdictions import JURISDICTIONS, SECTORS, SIZE_CLASSES, entity_options
from app.db import get_db
from app.models import Answer, Assessment, Entity
from app.schemas.common import ORM, Ok
from app.services.audit import apply_changes, audit
from app.services.entities import provision_entity
from app.services.indexing import index_object
from app.services.scoring import recalc

router = APIRouter(prefix="/entities", tags=["entities"])


class EntityOut(ORM):
    id: int
    code: str
    name: str
    finding_prefix: str
    country: str | None
    is_headquarters: bool
    legal_form: str | None
    size_class: str | None
    activity_sector: str | None
    nis2_classification: str | None
    competent_authority: str | None
    csirt: str | None
    registration_status: str | None
    registration_date: date | None
    registration_reference: str | None
    employees: int | None
    annual_turnover_meur: float | None
    address: str | None
    contact_name: str | None
    contact_email: str | None
    notes: str | None
    sort_order: int
    is_active: bool


class EntityIn(BaseModel):
    code: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9_\-]+$")
    name: str = Field(min_length=1, max_length=200)
    finding_prefix: str = Field(min_length=1, max_length=20)
    country: str | None = Field(default=None, max_length=2)
    is_headquarters: bool = False
    legal_form: str | None = Field(default=None, max_length=60)
    size_class: str | None = None
    activity_sector: str | None = None
    nis2_classification: str | None = Field(default=None, pattern="^(essential|important|not_in_scope|tbd)$")
    competent_authority: str | None = None
    csirt: str | None = None
    registration_status: str | None = Field(default=None, pattern="^(not_registered|submitted|confirmed)$")
    registration_date: date | None = None
    registration_reference: str | None = None
    employees: int | None = None
    annual_turnover_meur: float | None = None
    address: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    notes: str | None = None
    sort_order: int = 0
    is_active: bool = True

    @field_validator("country")
    @classmethod
    def _known_country(cls, v: str | None) -> str | None:
        if v is not None and v not in JURISDICTIONS:
            raise ValueError(f"Unsupported country, expected one of {', '.join(JURISDICTIONS)}")
        return v

    @field_validator("size_class")
    @classmethod
    def _known_size_class(cls, v: str | None) -> str | None:
        if v is not None and v not in SIZE_CLASSES:
            raise ValueError(f"Unknown size class, expected one of {', '.join(SIZE_CLASSES)}")
        return v

    @field_validator("activity_sector")
    @classmethod
    def _known_sector(cls, v: str | None) -> str | None:
        if v is not None and v not in SECTORS:
            raise ValueError("Unknown sector, see GET /api/entities/options for the allowed keys")
        return v


PUBLIC_FIELDS = {
    "id",
    "code",
    "name",
    "finding_prefix",
    "country",
    "is_headquarters",
    "sort_order",
    "is_active",
}


def _entity_out(pr: Principal, e: Entity) -> EntityOut:
    """Entities outside the caller's scope show only their name and code (needed for labels and pickers)."""
    out = EntityOut.model_validate(e)
    if pr.can_read("entities.read", e.id):
        return out
    return EntityOut.model_validate(
        {k: v if k in PUBLIC_FIELDS else None for k, v in out.model_dump().items()}
    )


@router.get("", response_model=list[EntityOut])
def list_entities(pr: Principal = Depends(require("entities.read")), db: Session = Depends(get_db)):
    return [_entity_out(pr, e) for e in db.scalars(select(Entity).order_by(Entity.sort_order, Entity.name))]


@router.get("/options")
def options(pr: Principal = Depends(require("entities.read"))):
    return entity_options()


@router.get("/{entity_id}", response_model=EntityOut)
def get_entity(
    entity_id: int, pr: Principal = Depends(require("entities.read")), db: Session = Depends(get_db)
):
    if not pr.can_read("entities.read", entity_id):
        raise HTTPException(404, "Entity not found")
    return get_or_404(db, Entity, entity_id)


@router.post("", response_model=EntityOut)
def create_entity(
    body: EntityIn, pr: Principal = Depends(require_global("entities.manage")), db: Session = Depends(get_db)
):
    if db.scalar(select(Entity).where(Entity.code == body.code)):
        raise HTTPException(409, "Entity code exists")
    e = Entity(**body.model_dump())
    db.add(e)
    db.flush()
    provision_entity(db, e)
    audit(db, pr, "create", "entity", e.id, e.name, entity_id=e.id)
    db.commit()
    index_object(db, "entity", e.id)
    return e


@router.put("/{entity_id}", response_model=EntityOut)
def update_entity(
    entity_id: int,
    body: EntityIn,
    pr: Principal = Depends(require("entities.manage")),
    db: Session = Depends(get_db),
):
    e = get_or_404(db, Entity, entity_id)
    pr.ensure("entities.manage", e.id, write=True)
    old_prefix = e.finding_prefix
    diff = apply_changes(e, body.model_dump(exclude_unset=True))
    if e.finding_prefix != old_prefix:
        for a in db.scalars(select(Answer).join(Assessment).where(Assessment.entity_id == e.id)):
            recalc(a, e.finding_prefix)
    audit(db, pr, "update", "entity", e.id, e.name, entity_id=e.id, details=diff)
    db.commit()
    index_object(db, "entity", e.id)
    return e


@router.delete("/{entity_id}", response_model=Ok)
def delete_entity(
    entity_id: int, pr: Principal = Depends(require_global("entities.manage")), db: Session = Depends(get_db)
):
    e = get_or_404(db, Entity, entity_id)
    audit(db, pr, "delete", "entity", e.id, e.name, entity_id=e.id)
    db.delete(e)
    db.commit()
    from app.services.indexing import remove_object

    remove_object(db, "entity", entity_id)
    return Ok()
