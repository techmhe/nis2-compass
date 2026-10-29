"""First-run setup (no authentication): creates the first admin and the group's companies on an empty system."""

import hmac
import re
from datetime import date, timedelta

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
from app.models import Entity, Project, Role, RoleAssignment, Stakeholder, User
from app.services.audit import audit
from app.services.entities import provision_entity
from app.services.indexing import index_object
from app.services.project_plan import (
    Assessment,
    Capacity,
    PlanError,
    PlanInputs,
    Schedule,
    StartingPoint,
    earliest_end,
    schedule,
    template,
)
from app.services.project_setup import (
    DEFAULT_NAME,
    MANDATORY,
    RoleChoice,
    create_default_project,
    create_project,
    offered_roles,
    template_role_names,
)
from app.services.setup import expected_setup_token, lock_setup, setup_needed
from app.services.workbook import parse_project_workbook

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


class RoleIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    rename_to: str | None = Field(default=None, min_length=1, max_length=100)
    selected: bool = True
    email: str | None = Field(default=None, max_length=320)
    custom: bool = False

    @field_validator("name", "rename_to")
    @classmethod
    def _stripped(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("Name is required")
        return v.strip() if v is not None else None

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        return v.strip().lower() or None if v is not None else None


class ProjectIn(BaseModel):
    name: str = Field(default=DEFAULT_NAME, min_length=1, max_length=200)
    start: date
    end: date | None = None
    capacity: Capacity
    assessment: Assessment
    starting_point: StartingPoint
    external_support: bool
    gates: dict[str, date] = {}
    roles: list[RoleIn] | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required")
        return v


class PreviewIn(ProjectIn):
    companies: int = Field(ge=1, le=50)


class SetupIn(BaseModel):
    setup_token: str = Field(max_length=200)
    admin: AdminIn
    companies: list[CompanyIn] = Field(min_length=1, max_length=50)
    project: ProjectIn | None = None


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


def _check_roles(db: Session, roles: list[RoleIn], at: tuple, errors: list[dict]) -> list[RoleChoice]:
    """Names unique across all stakeholders (case-insensitive), mandatory roles kept, e-mails only with OIDC."""
    oidc = get_settings().oidc_enabled
    listed = {r.name.lower() for r in roles if not r.custom}
    # names create_project would create itself (e.g. "Assigned Work-Package Owners") count as taken too
    taken = {n.lower() for n in db.scalars(select(Stakeholder.name))} | template_role_names()
    taken -= listed
    mandatory = {m.lower(): m for m in MANDATORY}
    present = {r.name.lower() for r in roles if not r.custom}
    for m in MANDATORY:
        if m.lower() not in present:
            errors.append({"loc": (*at, "roles"), "msg": f"The role {m} is required"})
    emails: set[str] = set()
    out = []
    for i, r in enumerate(roles):
        is_mandatory = not r.custom and r.name.lower() in mandatory
        selected = r.selected or is_mandatory
        if is_mandatory and not r.selected:
            errors.append({"loc": (*at, "roles", i, "name"), "msg": f"{r.name} cannot be removed"})
        if is_mandatory and r.rename_to and r.rename_to.lower() != r.name.lower():
            errors.append({"loc": (*at, "roles", i, "rename_to"), "msg": f"{r.name} cannot be renamed"})
        final = r.name if r.custom else (r.rename_to or r.name)
        if selected or not r.custom:
            if final.lower() in taken:
                field = "rename_to" if r.rename_to and not r.custom else "name"
                errors.append({"loc": (*at, "roles", i, field), "msg": "Role name is already in use"})
            taken.add(final.lower())
        if r.email:
            if not oidc:
                errors.append(
                    {"loc": (*at, "roles", i, "email"), "msg": "E-mail addresses need OIDC sign-in"}
                )
            elif not EMAIL_RE.match(r.email):
                errors.append({"loc": (*at, "roles", i, "email"), "msg": "Invalid e-mail address"})
            elif selected and r.email in emails:
                errors.append({"loc": (*at, "roles", i, "email"), "msg": "E-mail address is used twice"})
            elif selected:
                emails.add(r.email)
        out.append(RoleChoice(r.name, r.rename_to, r.selected, r.email, r.custom))
    return out


def _check_project(
    db: Session, p: ProjectIn, companies: int, at: tuple
) -> tuple[PlanInputs, Schedule, list[RoleChoice] | None]:
    """Everything the spec rejects with a 422 on the plan; `at` is the loc prefix of the project fields."""
    errors: list[dict] = []
    today = date.today()
    ok = True
    if p.start < today - timedelta(days=365):
        errors.append({"loc": (*at, "start"), "msg": "The start date is more than a year in the past"})
        ok = False
    elif p.start > today + timedelta(days=730):
        errors.append({"loc": (*at, "start"), "msg": "The start date is more than two years ahead"})
        ok = False
    if p.end is not None and p.end < p.start:
        errors.append({"loc": (*at, "end"), "msg": "The end date is before the start date"})
        ok = False
    inputs = PlanInputs(
        p.start, p.end, p.capacity, p.assessment, p.starting_point, p.external_support, companies
    )
    sched = None
    if ok:
        try:
            sched = schedule(inputs)
        except PlanError as e:
            errors.append({"loc": (*at, "end" if e.field == "end_date" else e.field), "msg": e.message})
    if sched:
        _check_gates(p, sched, at, errors)
    roles = _check_roles(db, p.roles, at, errors) if p.roles is not None else None
    if errors:
        raise RequestValidationError(errors)
    assert sched is not None
    return inputs, sched, roles


def _check_gates(p: ProjectIn, sched: Schedule, at: tuple, errors: list[dict]) -> None:
    known = set(template().gates)
    valid = {}
    for code, d in p.gates.items():
        if code not in known:
            errors.append({"loc": (*at, "gates", code), "msg": "Unknown gate"})
        elif not p.start <= d <= sched.end:
            errors.append(
                {
                    "loc": (*at, "gates", code),
                    "msg": f"The gate date must lie between {p.start} and {sched.end}",
                }
            )
        else:
            valid[code] = d
    effective = sched.gates | valid
    order = [g for g in template().gates if g in effective]
    for a, b in zip(order, order[1:], strict=False):
        if effective[a] > effective[b]:
            culprit = b if b in valid else a
            errors.append({"loc": (*at, "gates", culprit), "msg": f"{a} must not be later than {b}"})


@router.get("/status")
def status(db: Session = Depends(get_db)):
    return {"needed": setup_needed(db)}


@router.get("/options")
def options(db: Session = Depends(get_db)):
    """Field choices plus the auth facts the page shows; /api/auth/config answers 503 until setup is done."""
    s = get_settings()
    return entity_options() | {
        "password_min_length": s.password_min_length,
        "local_enabled": s.local_auth_enabled,
        "oidc_enabled": s.oidc_enabled,
        "project_exists": _project_exists(db),
        # no login here and the endpoint stays open afterwards: role names are internal once setup is done
        "roles": offered_roles(db, set(JURISDICTIONS)) if setup_needed(db) else [],
    }


def _project_exists(db: Session) -> bool:
    return db.scalar(select(Project.id).limit(1)) is not None


@router.post("/plan-preview")
def plan_preview(body: PreviewIn, db: Session = Depends(get_db)):
    """The schedule the wizard shows; the client never computes dates itself."""
    if not setup_needed(db):
        raise HTTPException(409, "setup already completed")
    inputs, sched, _ = _check_project(db, body, body.companies, ("body",))
    effective = sched.gates | body.gates
    decisions = {g["code"]: g["decision"] for g in parse_project_workbook()["gates"]}
    return {
        "proposed_end": sched.proposed_end,
        "end": sched.end,
        "earliest_end": earliest_end(inputs),
        "fit_factor": sched.fit_factor,
        "warning": sched.warning,
        "phases": [{"name": n, "start": s.start, "finish": s.finish} for n, s in sched.phases],
        "gates": [
            {"code": g, "decision": decisions[g], "date": effective[g]}
            for g in template().gates
            if g in effective
        ],
    }


@router.post("", response_model=MeOut)
def run_setup(body: SetupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    if not setup_needed(db):  # cheap, so that a finished system never pays for the slow hash below
        raise HTTPException(409, "setup already completed")
    if not hmac.compare_digest(body.setup_token.encode(), expected_setup_token().encode()):
        raise HTTPException(403, "invalid setup token")
    _check_companies(body.companies)
    plan = None
    if body.project and not _project_exists(
        db
    ):  # req. 3: an existing project wins, its block is not even checked
        plan = _check_project(db, body.project, len(body.companies), ("body", "project"))
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
    if not _project_exists(db):
        if body.project and plan:
            inputs, sched, roles = plan
            create_project(
                db,
                inputs,
                sched,
                name=body.project.name,
                roles=roles,
                gate_overrides=body.project.gates,
                entities=entities,
                admin=admin,
            )
        else:
            create_default_project(db, entities)
    audit(db, pr, "setup", "user", admin.id, admin.email, details={"companies": len(entities)}, ip=ip)
    db.commit()
    for e in entities:
        index_object(db, "entity", e.id)
    start_session(db, request, response, admin, "local")
    return me_payload(db, pr)
