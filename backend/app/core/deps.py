from dataclasses import dataclass, field
from datetime import timedelta

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.security import constant_time_equals, token_hash
from app.db import get_db, utcnow
from app.models import ApiToken, User, UserSession

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
PASSWORD_CHANGE_ALLOWED = {
    "/api/auth/me",
    "/api/auth/change-password",
    "/api/auth/logout",
    "/api/auth/config",
}


@dataclass
class Principal:
    user: User
    global_perms: set[str] = field(default_factory=set)
    entity_perms: dict[int, set[str]] = field(default_factory=dict)
    session: UserSession | None = None
    via_token: bool = False

    @property
    def id(self) -> int:
        return self.user.id

    def can(self, perm: str, entity_id: int | None = None) -> bool:
        """Permission granted group-wide, or for the given entity."""
        if perm in self.global_perms:
            return True
        return entity_id is not None and perm in self.entity_perms.get(entity_id, set())

    def has_any(self, perm: str) -> bool:
        return perm in self.global_perms or any(perm in p for p in self.entity_perms.values())

    def can_read(self, perm: str, entity_id: int | None) -> bool:
        """Group-level objects (entity_id None) are readable by anyone holding the permission anywhere."""
        return self.has_any(perm) if entity_id is None else self.can(perm, entity_id)

    def can_write(self, perm: str, entity_id: int | None) -> bool:
        """Group-level objects require a group-wide grant to modify."""
        return self.can(perm, entity_id) if entity_id is not None else perm in self.global_perms

    def entity_scope(self, perm: str) -> set[int] | None:
        """None = all entities; otherwise the set of entity ids the permission applies to."""
        if perm in self.global_perms:
            return None
        return {eid for eid, perms in self.entity_perms.items() if perm in perms}

    def ensure(self, perm: str, entity_id: int | None = None, write: bool = False) -> None:
        ok = self.can_write(perm, entity_id) if write else self.can_read(perm, entity_id)
        if not ok:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Missing permission: {perm}")

    @property
    def all_permissions(self) -> set[str]:
        out = set(self.global_perms)
        for p in self.entity_perms.values():
            out |= p
        return out


def build_principal(user: User) -> Principal:
    pr = Principal(user=user)
    for a in user.assignments:
        perms = set(a.role.permissions or [])
        if a.entity_id is None:
            pr.global_perms |= perms
        else:
            pr.entity_perms.setdefault(a.entity_id, set()).update(perms)
    return pr


def principal_of(db: Session, user_id: int | None) -> Principal | None:
    """Principal of another active user (owner, approver, notification recipient), or None."""
    u = db.get(User, user_id) if user_id else None
    return build_principal(u) if u and u.is_active else None


def user_can(db: Session, user_id: int | None, perm: str, entity_id: int | None, write: bool = False) -> bool:
    """Whether another user holds `perm` for the entity (read, or write with `write`)."""
    p = principal_of(db, user_id)
    return bool(p) and (p.can_write(perm, entity_id) if write else p.can_read(perm, entity_id))


def _unauthorized() -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")


def get_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    s = get_settings()
    now = utcnow()

    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        raw = auth[7:].strip()
        tok = db.scalar(select(ApiToken).where(ApiToken.token_hash == token_hash(raw)))
        if not tok or (tok.expires_at and tok.expires_at < now):
            raise _unauthorized()
        user = db.get(User, tok.user_id)
        if not user or not user.is_active:
            raise _unauthorized()
        if not tok.last_used_at or now - tok.last_used_at > timedelta(minutes=1):
            tok.last_used_at = now
            tok.uses = (tok.uses or 0) + 1
            db.commit()
        pr = build_principal(user)
        pr.via_token = True
        return pr

    raw = request.cookies.get(s.session_cookie_name)
    if not raw:
        raise _unauthorized()
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash(raw)))
    if (
        not sess
        or sess.expires_at < now
        or now - sess.last_seen_at > timedelta(minutes=s.session_idle_minutes)
    ):
        if sess:
            db.delete(sess)
            db.commit()
        raise _unauthorized()
    if not sess.user.is_active:
        raise _unauthorized()

    # CSRF: double-submit cookie + header for state-changing requests authenticated by cookie
    if request.method not in SAFE_METHODS and not constant_time_equals(
        request.headers.get("x-csrf-token"), request.cookies.get(s.csrf_cookie_name)
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF token missing or invalid")

    if sess.user.must_change_password and request.url.path not in PASSWORD_CHANGE_ALLOWED:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Password change required")
    if now - sess.last_seen_at > timedelta(minutes=1):
        sess.last_seen_at = now
        db.commit()
    pr = build_principal(sess.user)
    pr.session = sess
    return pr


def require(*perms: str):
    """Dependency: the principal must hold every listed permission (group-wide or for at least one entity)."""

    def dep(pr: Principal = Depends(get_principal)) -> Principal:
        for p in perms:
            if not pr.has_any(p):
                raise HTTPException(status.HTTP_403_FORBIDDEN, f"Missing permission: {p}")
        return pr

    return dep


def require_global(*perms: str):
    def dep(pr: Principal = Depends(get_principal)) -> Principal:
        for p in perms:
            if p not in pr.global_perms:
                raise HTTPException(status.HTTP_403_FORBIDDEN, f"Missing permission: {p}")
        return pr

    return dep


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None
