from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.util import get_or_404
from app.core.deps import Principal, client_ip, get_principal, require, require_global
from app.core.permissions import PERMISSIONS
from app.core.security import hash_password, new_token, password_problems
from app.db import get_db
from app.models import ApiToken, Role, RoleAssignment, Stakeholder, User, UserSession
from app.schemas.common import ORM, Ok
from app.services.audit import audit

router = APIRouter(tags=["users"])


class AssignmentOut(ORM):
    id: int
    role_id: int
    entity_id: int | None


class UserOut(ORM):
    id: int
    email: str
    display_name: str
    job_title: str | None
    auth_source: str
    is_active: bool
    must_change_password: bool
    last_login_at: datetime | None
    created_at: datetime
    assignments: list[AssignmentOut]


class UserListItem(BaseModel):
    id: int
    email: str
    display_name: str
    job_title: str | None = None
    is_active: bool


@router.get("/users/directory", response_model=list[UserListItem])
def user_directory(pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Minimal user list for assignee pickers (available to every signed-in user)."""
    rows = db.scalars(select(User).where(User.is_active.is_(True)).order_by(User.display_name))
    return [
        UserListItem(
            id=u.id, email=u.email, display_name=u.display_name, job_title=u.job_title, is_active=u.is_active
        )
        for u in rows
    ]


@router.get("/users", response_model=list[UserOut])
def list_users(pr: Principal = Depends(require_global("users.manage")), db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.display_name)).all()


class UserIn(BaseModel):
    email: str = Field(max_length=320)
    display_name: str = Field(min_length=1, max_length=200)
    job_title: str | None = Field(default=None, max_length=200)
    password: str | None = Field(default=None, max_length=500)
    auth_source: str = Field(default="local", pattern="^(local|oidc)$")
    assignments: list[dict] = []  # [{"role_id": int, "entity_id": int | None}]


def _set_assignments(db: Session, pr: Principal, user: User, items: list[dict]) -> None:
    """Replace a user's role assignments. Callers may only grant roles whose permissions they hold themselves
    (group-wide), so users.manage cannot be used to escalate to administrator."""
    from app.models import Entity

    wanted = []
    seen = set()
    for it in items:
        try:
            key = (int(it["role_id"]), int(it["entity_id"]) if it.get("entity_id") is not None else None)
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, "Invalid assignment") from None
        if key in seen:
            continue
        seen.add(key)
        role = get_or_404(db, Role, key[0])
        if key[1] is not None:
            get_or_404(db, Entity, key[1])
        if set(role.permissions or []) - pr.global_perms:
            raise HTTPException(
                403, f"You cannot grant the role '{role.name}' (it exceeds your own permissions)"
            )
        wanted.append(key)
    # existing assignments the caller could not have granted must stay untouched
    for a in list(user.assignments):
        if set(a.role.permissions or []) - pr.global_perms:
            seen_key = (a.role_id, a.entity_id)
            if seen_key not in seen:
                raise HTTPException(403, f"You cannot remove the role '{a.role.name}'")
    db.execute(delete(RoleAssignment).where(RoleAssignment.user_id == user.id))
    db.flush()
    for rid, eid in wanted:
        db.add(RoleAssignment(user_id=user.id, role_id=rid, entity_id=eid))


def _ensure_can_manage(pr: Principal, target: User) -> None:
    """A user administrator may only manage accounts whose permissions do not exceed their own."""
    from app.core.deps import build_principal

    if target.id != pr.id and build_principal(target).all_permissions - pr.global_perms:
        raise HTTPException(403, "This account has more permissions than you; ask an administrator")


@router.post("/users", response_model=dict)
def create_user(
    body: UserIn,
    request: Request,
    pr: Principal = Depends(require_global("users.manage")),
    db: Session = Depends(get_db),
):
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Invalid e-mail address")
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(409, "A user with this e-mail already exists")
    generated = None
    u = User(
        email=email,
        display_name=body.display_name.strip(),
        job_title=body.job_title,
        auth_source=body.auth_source,
    )
    if body.auth_source == "local":
        pw = body.password
        if not pw:
            pw = generated = new_token(12) + "Aa1!"
        problems = password_problems(pw)
        if problems:
            raise HTTPException(400, "Password needs " + ", ".join(problems))
        u.password_hash = hash_password(pw)
        u.must_change_password = True
    db.add(u)
    db.flush()
    _set_assignments(db, pr, u, body.assignments)
    audit(
        db,
        pr,
        "create",
        "user",
        u.id,
        email,
        details={"assignments": body.assignments},
        ip=client_ip(request),
    )
    db.commit()
    return {"id": u.id, "initial_password": generated}


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=200)
    job_title: str | None = Field(default=None, max_length=200)
    is_active: bool | None = None
    assignments: list[dict] | None = None


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: UserUpdate,
    request: Request,
    pr: Principal = Depends(require_global("users.manage")),
    db: Session = Depends(get_db),
):
    u = get_or_404(db, User, user_id)
    _ensure_can_manage(pr, u)
    details = body.model_dump(exclude_none=True)
    if body.display_name:
        u.display_name = body.display_name
    if body.job_title is not None:
        u.job_title = body.job_title or None
    if body.is_active is not None:
        if u.id == pr.id and not body.is_active:
            raise HTTPException(400, "You cannot deactivate yourself")
        u.is_active = body.is_active
        if not body.is_active:
            db.execute(delete(UserSession).where(UserSession.user_id == u.id))
            db.execute(delete(ApiToken).where(ApiToken.user_id == u.id))
    if body.assignments is not None:
        if u.id == pr.id:
            raise HTTPException(400, "You cannot change your own roles; ask another administrator")
        _set_assignments(db, pr, u, body.assignments)
    audit(db, pr, "update", "user", u.id, u.email, details=details, ip=client_ip(request))
    db.commit()
    db.refresh(u)
    return u


@router.post("/users/{user_id}/reset-password")
def reset_password(
    user_id: int,
    request: Request,
    pr: Principal = Depends(require_global("users.manage")),
    db: Session = Depends(get_db),
):
    u = get_or_404(db, User, user_id)
    _ensure_can_manage(pr, u)
    if u.auth_source != "local":
        raise HTTPException(400, "User signs in via OIDC")
    pw = new_token(12) + "Aa1!"
    u.password_hash = hash_password(pw)
    u.must_change_password = True
    db.execute(delete(UserSession).where(UserSession.user_id == u.id))
    db.execute(delete(ApiToken).where(ApiToken.user_id == u.id))
    audit(db, pr, "password_reset", "user", u.id, u.email, ip=client_ip(request))
    db.commit()
    return {"initial_password": pw}


@router.delete("/users/{user_id}", response_model=Ok)
def delete_user(
    user_id: int,
    request: Request,
    pr: Principal = Depends(require_global("users.manage")),
    db: Session = Depends(get_db),
):
    u = get_or_404(db, User, user_id)
    if u.id == pr.id:
        raise HTTPException(400, "You cannot delete yourself")
    _ensure_can_manage(pr, u)
    audit(db, pr, "delete", "user", u.id, u.email, ip=client_ip(request))
    db.delete(u)
    db.commit()
    return Ok()


# --- roles ----------------------------------------------------------------------------------------------


class RoleOut(ORM):
    id: int
    key: str
    name: str
    description: str | None
    permissions: list[str]
    is_system: bool


@router.get("/roles", response_model=list[RoleOut])
def list_roles(pr: Principal = Depends(require("entities.read")), db: Session = Depends(get_db)):
    return db.scalars(select(Role).order_by(Role.id)).all()


@router.get("/permissions")
def list_permissions(pr: Principal = Depends(get_principal)):
    return [{"key": k, "description": v, "group": k.split(".")[0]} for k, v in PERMISSIONS.items()]


class RoleIn(BaseModel):
    key: str | None = Field(default=None, pattern="^[a-z][a-z0-9_]{1,58}$")
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    permissions: list[str]


@router.post("/roles", response_model=RoleOut)
def create_role(
    body: RoleIn, pr: Principal = Depends(require_global("roles.manage")), db: Session = Depends(get_db)
):
    if not body.key:
        raise HTTPException(400, "key is required")
    if db.scalar(select(Role).where(Role.key == body.key)):
        raise HTTPException(409, "Role key exists")
    bad = [p for p in body.permissions if p not in PERMISSIONS]
    if bad:
        raise HTTPException(400, f"Unknown permissions: {bad}")
    r = Role(
        key=body.key, name=body.name, description=body.description, permissions=sorted(set(body.permissions))
    )
    db.add(r)
    audit(db, pr, "create", "role", None, body.key, details={"permissions": body.permissions})
    db.commit()
    return r


@router.put("/roles/{role_id}", response_model=RoleOut)
def update_role(
    role_id: int,
    body: RoleIn,
    pr: Principal = Depends(require_global("roles.manage")),
    db: Session = Depends(get_db),
):
    r = get_or_404(db, Role, role_id)
    if r.key == "admin":
        raise HTTPException(400, "The administrator role cannot be changed")
    bad = [p for p in body.permissions if p not in PERMISSIONS]
    if bad:
        raise HTTPException(400, f"Unknown permissions: {bad}")
    audit(db, pr, "update", "role", r.id, r.key, details={"old": r.permissions, "new": body.permissions})
    r.name, r.description, r.permissions = body.name, body.description, sorted(set(body.permissions))
    db.commit()
    return r


@router.delete("/roles/{role_id}", response_model=Ok)
def delete_role(
    role_id: int, pr: Principal = Depends(require_global("roles.manage")), db: Session = Depends(get_db)
):
    r = get_or_404(db, Role, role_id)
    if r.is_system:
        raise HTTPException(400, "Built-in roles cannot be deleted")
    audit(db, pr, "delete", "role", r.id, r.key)
    db.delete(r)
    db.commit()
    return Ok()


# --- stakeholders ---------------------------------------------------------------------------------------


class StakeholderOut(ORM):
    id: int
    name: str
    kind: str
    user_id: int | None
    email: str | None
    entity_id: int | None
    description: str | None
    sort_order: int
    is_active: bool


class StakeholderIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: str = Field(default="role", pattern="^(role|person|external)$")
    user_id: int | None = None
    email: str | None = None
    entity_id: int | None = None
    description: str | None = None
    sort_order: int = 0
    is_active: bool = True


@router.get("/stakeholders", response_model=list[StakeholderOut])
def list_stakeholders(pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    return db.scalars(select(Stakeholder).order_by(Stakeholder.sort_order, Stakeholder.name)).all()


@router.post("/stakeholders", response_model=StakeholderOut)
def create_stakeholder(
    body: StakeholderIn,
    pr: Principal = Depends(require_global("entities.manage")),
    db: Session = Depends(get_db),
):
    if db.scalar(select(Stakeholder).where(Stakeholder.name == body.name)):
        raise HTTPException(409, "Name exists")
    st = Stakeholder(**body.model_dump())
    db.add(st)
    audit(db, pr, "create", "stakeholder", None, body.name)
    db.commit()
    return st


@router.put("/stakeholders/{sid}", response_model=StakeholderOut)
def update_stakeholder(
    sid: int,
    body: StakeholderIn,
    pr: Principal = Depends(require_global("entities.manage")),
    db: Session = Depends(get_db),
):
    st = get_or_404(db, Stakeholder, sid)
    for k, v in body.model_dump().items():
        setattr(st, k, v)
    audit(db, pr, "update", "stakeholder", st.id, st.name)
    db.commit()
    return st


@router.delete("/stakeholders/{sid}", response_model=Ok)
def delete_stakeholder(
    sid: int, pr: Principal = Depends(require_global("entities.manage")), db: Session = Depends(get_db)
):
    st = get_or_404(db, Stakeholder, sid)
    audit(db, pr, "delete", "stakeholder", st.id, st.name)
    db.delete(st)
    db.commit()
    return Ok()
