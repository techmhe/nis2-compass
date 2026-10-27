"""First-run setup (no authentication): creates the first admin and the group's companies on an empty system."""

import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import MeOut, me_payload, start_session
from app.config import get_settings
from app.core.deps import build_principal, client_ip
from app.core.jurisdictions import JURISDICTIONS, SECTORS, SIZE_CLASSES, entity_options
from app.core.security import hash_password, password_problems
from app.db import get_db
from app.models import Entity, Role, RoleAssignment, User
from app.services.audit import audit
from app.services.entities import provision_entity
from app.services.indexing import index_object
from app.services.setup import lock_setup, setup_needed

router = APIRouter(prefix="/setup", tags=["setup"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AdminIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=200)
    email: str = Field(max_length=320)
    password: str = Field(max_length=500)

    @field_validator("display_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("Invalid e-mail address")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        problems = password_problems(v)
        if problems:
            raise ValueError("Password needs " + ", ".join(problems))
        return v


class CompanyIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9_\-]+$")
    legal_form: str = Field(min_length=1, max_length=60)
    country: str
    sector: str
    size_class: str
    is_headquarters: bool = False

    @field_validator("country")
    @classmethod
    def _country(cls, v: str) -> str:
        if v not in JURISDICTIONS:
            raise ValueError(f"Unsupported country, expected one of {', '.join(JURISDICTIONS)}")
        return v

    @field_validator("sector")
    @classmethod
    def _sector(cls, v: str) -> str:
        if v not in SECTORS:
            raise ValueError("Unknown sector, see GET /api/setup/options for the allowed keys")
        return v

    @field_validator("size_class")
    @classmethod
    def _size_class(cls, v: str) -> str:
        if v not in SIZE_CLASSES:
            raise ValueError(f"Unknown size class, expected one of {', '.join(SIZE_CLASSES)}")
        return v


class SetupIn(BaseModel):
    admin: AdminIn
    companies: list[CompanyIn] = Field(min_length=1, max_length=50)


def _check_companies(companies: list[CompanyIn]) -> None:
    """Rules across companies; reported with the field path like the per-field ones."""
    errors = []
    seen: set[str] = set()
    for i, c in enumerate(companies):
        if c.code.lower() in seen:
            errors.append({"loc": ("body", "companies", i, "code"), "msg": "Company code is used twice"})
        seen.add(c.code.lower())
    hqs = [i for i, c in enumerate(companies) if c.is_headquarters]
    if not hqs:
        errors.append({"loc": ("body", "companies"), "msg": "Exactly one company must be the headquarters"})
    for i in hqs[1:]:
        errors.append(
            {
                "loc": ("body", "companies", i, "is_headquarters"),
                "msg": "Only one company can be the headquarters",
            }
        )
    if errors:
        raise RequestValidationError(errors)


@router.get("/status")
def status(db: Session = Depends(get_db)):
    return {"needed": setup_needed(db)}


@router.get("/options")
def options():
    """Field choices plus the two auth facts the page shows; /api/auth/config answers 503 until setup is done."""
    s = get_settings()
    return entity_options() | {
        "password_min_length": s.password_min_length,
        "local_enabled": s.local_auth_enabled,
    }


@router.post("", response_model=MeOut)
def run_setup(body: SetupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    if not setup_needed(db):  # cheap, so that a finished system never pays for the slow hash below
        raise HTTPException(409, "setup already completed")
    _check_companies(body.companies)
    password_hash = hash_password(body.admin.password)  # slow; keep it out of the locked section
    lock_setup(db)
    if not setup_needed(db):
        db.rollback()
        raise HTTPException(409, "setup already completed")
    ip = client_ip(request)
    admin = User(
        email=body.admin.email,
        display_name=body.admin.display_name,
        password_hash=password_hash,
        auth_source="local",
        must_change_password=False,
    )
    db.add(admin)
    db.flush()
    db.add(RoleAssignment(user_id=admin.id, role_id=db.scalar(select(Role.id).where(Role.key == "admin"))))
    db.flush()
    pr = build_principal(admin)
    entities = []
    for i, c in enumerate(body.companies):
        j = JURISDICTIONS[c.country]
        e = Entity(
            code=c.code,
            name=c.name,
            finding_prefix=c.code,
            country=c.country,
            is_headquarters=c.is_headquarters,
            legal_form=c.legal_form,
            size_class=c.size_class,
            activity_sector=c.sector,
            nis2_classification="tbd",
            competent_authority=j.competent_authority,
            csirt=j.csirt,
            sort_order=i,
        )
        db.add(e)
        provision_entity(db, e)
        audit(db, pr, "create", "entity", e.id, e.name, entity_id=e.id, ip=ip)
        entities.append(e)
    audit(db, pr, "setup", "user", admin.id, admin.email, details={"companies": len(entities)}, ip=ip)
    db.commit()
    for e in entities:
        index_object(db, "entity", e.id)
    start_session(db, request, response, admin, "local")
    return me_payload(db, pr)
