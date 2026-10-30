import logging
from datetime import date, timedelta
from typing import Annotated, Literal

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.deps import Principal, build_principal, client_ip, get_principal
from app.core.security import (
    hash_password,
    needs_rehash,
    new_token,
    password_problems,
    session_expiry,
    token_hash,
    verify_password,
)
from app.db import get_db, utcnow
from app.models import ApiToken, Entity, LoginAttempt, Role, RoleAssignment, User, UserSession
from app.schemas.common import Ok
from app.services.audit import audit
from app.services.project_setup import link_stakeholders

log = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


def cookie_names() -> tuple[str, str]:
    s = get_settings()
    return s.session_cookie_name, s.csrf_cookie_name


class LoginIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=500)


class MeOut(BaseModel):
    id: int
    email: str
    display_name: str
    job_title: str | None
    auth_source: str
    must_change_password: bool
    permissions: list[str]
    global_permissions: list[str]
    entity_permissions: dict[int, list[str]]
    roles: list[dict]
    preferences: dict
    stakeholder_ids: list[int]


def me_payload(db: Session, pr: Principal) -> MeOut:
    from app.models import Stakeholder

    u = pr.user
    return MeOut(
        id=u.id,
        email=u.email,
        display_name=u.display_name,
        job_title=u.job_title,
        auth_source=u.auth_source,
        must_change_password=u.must_change_password,
        permissions=sorted(pr.all_permissions),
        global_permissions=sorted(pr.global_perms),
        entity_permissions={k: sorted(v) for k, v in pr.entity_perms.items()},
        roles=[{"key": a.role.key, "name": a.role.name, "entity_id": a.entity_id} for a in u.assignments],
        preferences=u.preferences or {},
        stakeholder_ids=list(db.scalars(select(Stakeholder.id).where(Stakeholder.user_id == u.id))),
    )


def start_session(db: Session, request: Request, response: Response, user: User, method: str) -> None:
    s = get_settings()
    raw = new_token()
    now = utcnow()
    db.add(
        UserSession(
            token_hash=token_hash(raw),
            user_id=user.id,
            created_at=now,
            last_seen_at=now,
            expires_at=session_expiry(now),
            ip=client_ip(request),
            user_agent=(request.headers.get("user-agent") or "")[:400],
            auth_method=method,
        )
    )
    user.last_login_at = now
    # opportunistic cleanup of expired sessions
    db.execute(delete(UserSession).where(UserSession.expires_at < now))
    db.commit()
    sess_name, csrf_name = cookie_names()
    max_age = s.session_absolute_hours * 3600
    response.set_cookie(
        sess_name, raw, max_age=max_age, httponly=True, secure=s.secure_cookies, samesite="lax", path="/"
    )
    response.set_cookie(
        csrf_name,
        new_token(24),
        max_age=max_age,
        httponly=False,
        secure=s.secure_cookies,
        samesite="strict",
        path="/",
    )


def _locked_out(db: Session, email: str, ip: str | None) -> bool:
    """Throttle per (account, client) so a third party cannot lock out a user from elsewhere; a high per-account
    ceiling still slows distributed guessing and a per-client ceiling slows password spraying."""
    s = get_settings()
    since = utcnow() - timedelta(minutes=s.login_lockout_minutes)
    failed = select(func.count(LoginAttempt.id)).where(
        LoginAttempt.success.is_(False), LoginAttempt.at > since
    )
    pair = db.scalar(failed.where(LoginAttempt.email == email, LoginAttempt.ip == ip)) or 0
    by_email = db.scalar(failed.where(LoginAttempt.email == email)) or 0
    by_ip = db.scalar(failed.where(LoginAttempt.ip == ip)) if ip else 0
    return (
        pair >= s.login_max_attempts
        or by_email >= s.login_max_attempts * 10
        or (by_ip or 0) >= s.login_max_attempts * 5
    )


@router.get("/config")
def auth_config():
    s = get_settings()
    return {
        "local_enabled": s.local_auth_enabled,
        "oidc_enabled": s.oidc_enabled,
        "oidc_display_name": s.oidc_display_name,
        "app_name": s.app_name,
        "password_min_length": s.password_min_length,
    }


@router.post("/login", response_model=MeOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    s = get_settings()
    if not s.local_auth_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Local login is disabled")
    email = body.email.strip().lower()
    ip = client_ip(request)
    if _locked_out(db, email, ip):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many failed attempts. Try again in {s.login_lockout_minutes} minutes.",
        )
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    ok = verify_password(body.password, user.password_hash if user else None)
    if not user or not ok or not user.is_active or user.auth_source != "local":
        db.add(LoginAttempt(email=email, ip=ip, success=False, at=utcnow()))
        audit(db, None, "login_failed", "user", user.id if user else None, email, ip=ip)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid e-mail or password")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    db.add(LoginAttempt(email=email, ip=ip, success=True, at=utcnow()))
    start_session(db, request, response, user, "local")
    pr = build_principal(user)
    audit(db, pr, "login", "user", user.id, email, ip=ip)
    db.commit()
    return me_payload(db, pr)


@router.post("/logout", response_model=Ok)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    from app.core.security import constant_time_equals

    sess_name, csrf_name = cookie_names()
    raw = request.cookies.get(sess_name)
    if raw and not constant_time_equals(request.headers.get("x-csrf-token"), request.cookies.get(csrf_name)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF token missing or invalid")
    if raw:
        db.execute(delete(UserSession).where(UserSession.token_hash == token_hash(raw)))
        db.commit()
    response.delete_cookie(sess_name, path="/")
    response.delete_cookie(csrf_name, path="/")
    return Ok()


@router.get("/me", response_model=MeOut)
def me(pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    return me_payload(db, pr)


class TourPreference(BaseModel):
    # Strict: "1", true or 1.0 as version would be stored and then read as no state, restarting the tour.
    model_config = ConfigDict(extra="forbid", strict=True)

    version: int = Field(ge=1, le=1000)
    status: Literal["started", "done", "dismissed"]
    chapters_done: list[Annotated[str, Field(max_length=40, pattern=r"^[a-z][a-z0-9_-]*$")]] = Field(
        max_length=30
    )


PREFERENCE_TYPES = {
    "email_notifications": bool,
    "tour": dict,
}  # user-settable preferences; the absence has its own endpoint


class ProfileIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=200)
    job_title: str | None = Field(default=None, max_length=200)
    preferences: dict | None = None

    @field_validator("preferences")
    @classmethod
    def _known(cls, v: dict | None) -> dict | None:
        out = dict(v or {})
        for k, val in out.items():
            if k not in PREFERENCE_TYPES or not isinstance(val, PREFERENCE_TYPES[k]):
                raise ValueError(f"Unknown or invalid preference: {k}")
            if k == "tour":
                try:
                    out[k] = TourPreference.model_validate(val).model_dump()
                except ValidationError as e:
                    raise ValueError(f"Invalid tour preference: {e.error_count()} error(s)") from None
        return out if v is not None else None


@router.patch("/me", response_model=MeOut)
def update_me(body: ProfileIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    u = db.get(User, pr.id)
    if body.display_name:
        u.display_name = body.display_name.strip()
    if body.job_title is not None:
        u.job_title = body.job_title.strip() or None
    if body.preferences is not None:
        u.preferences = {**(u.preferences or {}), **body.preferences}
    db.commit()
    return me_payload(db, build_principal(u))


class AbsenceIn(BaseModel):
    start: date
    until: date
    deputy_id: int


@router.put("/me/absence", response_model=MeOut)
def set_absence(body: AbsenceIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Absence with a deputy: while absent, the deputy receives a copy of the user's notifications."""
    if body.until < body.start or (body.until - body.start).days > 366:
        raise HTTPException(422, "The absence must end after it starts and last at most a year")
    deputy = db.get(User, body.deputy_id)
    if not deputy or not deputy.is_active or deputy.id == pr.id:
        raise HTTPException(422, "Choose another active user as deputy")
    u = db.get(User, pr.id)
    u.preferences = {
        **(u.preferences or {}),
        "absence": {
            "start": body.start.isoformat(),
            "until": body.until.isoformat(),
            "deputy_id": deputy.id,
            "deputy_name": deputy.display_name,
        },
    }
    audit(db, pr, "update", "user", u.id, u.email, details={"absence": u.preferences["absence"]})
    db.commit()
    return me_payload(db, build_principal(u))


@router.delete("/me/absence", response_model=MeOut)
def clear_absence(pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    u = db.get(User, pr.id)
    u.preferences = {k: v for k, v in (u.preferences or {}).items() if k != "absence"}
    db.commit()
    return me_payload(db, build_principal(u))


class PasswordIn(BaseModel):
    current_password: str = Field(max_length=500)
    new_password: str = Field(max_length=500)


@router.post("/change-password", response_model=Ok)
def change_password(
    body: PasswordIn, request: Request, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    u = db.get(User, pr.id)
    if u.auth_source != "local":
        raise HTTPException(400, "Password is managed by your identity provider")
    if not verify_password(body.current_password, u.password_hash):
        raise HTTPException(400, "Current password is wrong")
    problems = password_problems(body.new_password)
    if problems:
        raise HTTPException(400, "Password needs " + ", ".join(problems))
    if body.new_password == body.current_password:
        raise HTTPException(400, "New password must differ from the current one")
    u.password_hash = hash_password(body.new_password)
    u.must_change_password = False
    # invalidate all other sessions of this user
    if pr.session:
        db.execute(delete(UserSession).where(UserSession.user_id == u.id, UserSession.id != pr.session.id))
    else:  # a Bearer token has no session of its own to keep
        db.execute(delete(UserSession).where(UserSession.user_id == u.id))
    db.execute(delete(ApiToken).where(ApiToken.user_id == u.id))
    audit(db, pr, "password_changed", "user", u.id, u.email, ip=client_ip(request))
    db.commit()
    return Ok()


# --- sessions & API tokens -------------------------------------------------------------------------------


@router.get("/sessions")
def my_sessions(pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(UserSession).where(UserSession.user_id == pr.id).order_by(UserSession.last_seen_at.desc())
    )
    return [
        {
            "id": s.id,
            "created_at": s.created_at,
            "last_seen_at": s.last_seen_at,
            "ip": s.ip,
            "user_agent": s.user_agent,
            "auth_method": s.auth_method,
            "current": pr.session is not None and s.id == pr.session.id,
        }
        for s in rows
    ]


@router.delete("/sessions/{session_id}", response_model=Ok)
def revoke_session(session_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    db.execute(delete(UserSession).where(UserSession.id == session_id, UserSession.user_id == pr.id))
    db.commit()
    return Ok()


class TokenIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    expires_in_days: int = Field(default=90, ge=1, le=730)


@router.get("/tokens")
def list_tokens(pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    rows = db.scalars(select(ApiToken).where(ApiToken.user_id == pr.id).order_by(ApiToken.created_at.desc()))
    return [
        {
            "id": t.id,
            "name": t.name,
            "prefix": t.prefix,
            "created_at": t.created_at,
            "expires_at": t.expires_at,
            "last_used_at": t.last_used_at,
        }
        for t in rows
    ]


@router.post("/tokens")
def create_token(body: TokenIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    if pr.via_token:
        raise HTTPException(403, "API tokens cannot create API tokens")
    raw = "nis2_" + new_token(30)
    t = ApiToken(
        user_id=pr.id,
        name=body.name,
        token_hash=token_hash(raw),
        prefix=raw[:12],
        expires_at=utcnow() + timedelta(days=body.expires_in_days),
    )
    db.add(t)
    audit(db, pr, "api_token_created", "user", pr.id, body.name)
    db.commit()
    return {"id": t.id, "token": raw, "name": t.name, "expires_at": t.expires_at}


@router.delete("/tokens/{token_id}", response_model=Ok)
def delete_token(token_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    db.execute(delete(ApiToken).where(ApiToken.id == token_id, ApiToken.user_id == pr.id))
    db.commit()
    return Ok()


# --- OpenID Connect -------------------------------------------------------------------------------------

_oauth: OAuth | None = None


def oauth_client():
    global _oauth
    s = get_settings()
    if not s.oidc_enabled or not s.oidc_issuer or not s.oidc_client_id:
        raise HTTPException(404, "OIDC is not configured")
    if _oauth is None:
        _oauth = OAuth()
        _oauth.register(
            name="oidc",
            server_metadata_url=s.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration",
            client_id=s.oidc_client_id,
            client_secret=s.oidc_client_secret,
            client_kwargs={"scope": s.oidc_scopes, "code_challenge_method": "S256"},
        )
    return _oauth.oidc


@router.get("/oidc/login")
async def oidc_login(request: Request):
    client = oauth_client()
    redirect_uri = get_settings().base_url.rstrip("/") + "/api/auth/oidc/callback"
    return await client.authorize_redirect(request, redirect_uri)


def _apply_role_mapping(db: Session, user: User, groups: list[str]) -> None:
    s = get_settings()
    mapping = s.oidc_role_mapping or {}
    if not mapping:
        return
    roles = {r.key: r for r in db.scalars(select(Role))}
    ents = {e.code: e for e in db.scalars(select(Entity))}
    wanted: set[tuple[int, int | None]] = set()
    for g in groups:
        target = mapping.get(g)
        if not target:
            continue
        for t in str(target).split(","):
            key, _, ecode = t.strip().partition("@")
            if key not in roles:
                log.warning("OIDC role mapping references unknown role %r", key)
                continue
            if ecode and ecode not in ents:
                log.warning("OIDC role mapping references unknown entity %r; mapping skipped", ecode)
                continue
            wanted.add((roles[key].id, ents[ecode].id if ecode else None))
    mapped_role_ids = {
        roles[str(v).split("@")[0]].id
        for vs in mapping.values()
        for v in str(vs).split(",")
        if str(v).split("@")[0] in roles
    }
    current = {(a.role_id, a.entity_id): a for a in user.assignments}
    for key, a in current.items():
        if key[0] in mapped_role_ids and key not in wanted:
            db.delete(a)
    for rid, eid in wanted - set(current):
        db.add(RoleAssignment(user_id=user.id, role_id=rid, entity_id=eid))


@router.get("/oidc/callback")
async def oidc_callback(request: Request, db: Session = Depends(get_db)):
    s = get_settings()
    client = oauth_client()
    try:
        token = await client.authorize_access_token(request)
    except OAuthError as e:
        log.warning("OIDC callback failed: %s", e)
        return RedirectResponse("/login?error=oidc", status_code=302)
    claims = dict(token.get("userinfo") or {})
    if not claims.get("sub"):
        return RedirectResponse("/login?error=oidc", status_code=302)
    sub = f"{s.oidc_issuer}|{claims['sub']}"
    verified_email = (
        (claims.get("email") or "").lower()
        if claims.get("email_verified") is True or (s.oidc_trust_email and claims.get("email"))
        else ""
    )
    email = (
        verified_email
        or (claims.get("email") or claims.get("preferred_username") or claims.get("upn") or "").lower()
    )
    name = claims.get("name") or email or claims["sub"]
    groups = claims.get(s.oidc_groups_claim) or []
    if isinstance(groups, str):
        groups = [groups]

    user = db.scalar(select(User).where(User.oidc_subject == sub))
    if not user and verified_email:
        existing = db.scalar(select(User).where(func.lower(User.email) == verified_email))
        if existing:
            # Link a pre-provisioned account only on a verified e-mail and never for privileged accounts, which
            # must be linked explicitly (prevents account takeover through an IdP-controlled e-mail claim).
            privileged = build_principal(existing).all_permissions & {
                "users.manage",
                "roles.manage",
                "settings.manage",
            }
            if existing.oidc_subject or privileged:
                log.warning(
                    "OIDC login not linked to existing account %s (privileged or already linked)", existing.id
                )
                return RedirectResponse("/login?error=link_denied", status_code=302)
            existing.auth_source = "oidc"
            existing.oidc_subject = sub
            existing.password_hash = None
            user = existing
    if not user and db.scalar(select(User.id).where(func.lower(User.email) == email)):
        # an account with that e-mail exists but the IdP did not assert a verified e-mail: do not link or duplicate
        return RedirectResponse("/login?error=link_denied", status_code=302)
    if not user:
        if not s.oidc_auto_provision:
            return RedirectResponse("/login?error=not_provisioned", status_code=302)
        user = User(
            email=email or f"{claims['sub']}@oidc.invalid",
            display_name=name,
            auth_source="oidc",
            oidc_subject=sub,
        )
        db.add(user)
        db.flush()
        new_user = True
    else:
        new_user = False
    if not user.is_active:
        return RedirectResponse("/login?error=disabled", status_code=302)
    user.display_name = name
    if verified_email:
        link_stakeholders(db, user, verified_email)
    claim = s.oidc_groups_claim
    overage = claim not in claims and (
        claim in (claims.get("_claim_names") or {}) or (claim == "groups" and claims.get("hasgroups") is True)
    )
    if overage:
        # Entra ID drops the groups claim above ~200 groups. Fail closed: mapped roles go as for a user without
        # groups (keeping them would let anyone dodge revocation by joining enough groups); say why in the log.
        log.warning(
            "OIDC group overage for user %s: %r claim not in the token, mapped roles removed "
            "(use app roles or 'groups assigned to the application')",
            user.id,
            claim,
        )
    _apply_role_mapping(db, user, [str(g) for g in groups])
    db.flush()
    db.refresh(user)
    if new_user and not user.assignments and s.oidc_default_role:
        # the default role applies only when no group mapping granted a role
        role = db.scalar(select(Role).where(Role.key == s.oidc_default_role))
        if role:
            db.add(RoleAssignment(user_id=user.id, role_id=role.id))
    db.commit()
    db.refresh(user)
    response = RedirectResponse("/", status_code=302)
    start_session(db, request, response, user, "oidc")
    audit(
        db,
        build_principal(user),
        "login",
        "user",
        user.id,
        user.email,
        details={"method": "oidc"},
        ip=client_ip(request),
    )
    db.commit()
    return response
