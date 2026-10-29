"""OIDC login links project roles (stakeholders) to the person by verified e-mail, and grants no access."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Stakeholder, User


class _FakeOAuth:
    def __init__(self, claims):
        self.claims = claims

    async def authorize_access_token(self, request):
        return {"userinfo": self.claims}


@pytest.fixture
def login(app_, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "oidc_issuer", "https://login.link.test/v2.0")
    monkeypatch.setattr(s, "oidc_default_role", None)
    monkeypatch.setattr(s, "oidc_trust_email", False)

    def do(claims):
        monkeypatch.setattr("app.api.auth.oauth_client", lambda: _FakeOAuth(claims))
        return TestClient(app_).get("/api/auth/oidc/callback", follow_redirects=False)

    return do


def _add(db, name, email, **kw):
    st = Stakeholder(name=name, kind="role", email=email, **kw)
    db.add(st)
    return st


def test_login_links_matching_stakeholder_only(login):
    with SessionLocal() as db:
        other = User(email="other@tenant.test", display_name="Other", auth_source="local")
        db.add(other)
        db.flush()
        _add(db, "Link Ana", "Ana@Tenant.test")
        _add(db, "Link Taken", "ana@tenant.test", user_id=other.id)
        _add(db, "Link Inactive", "ana@tenant.test", is_active=False)
        _add(db, "Link Else", "else@tenant.test")
        db.commit()
        other_id = other.id
    r = login({"sub": "ana-1", "email": "ana@tenant.test", "email_verified": True})
    assert r.headers["location"] == "/"
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.oidc_subject.like("%|ana-1")))
        by_name = {s.name: s for s in db.scalars(select(Stakeholder).where(Stakeholder.name.like("Link %")))}
        assert by_name["Link Ana"].user_id == user.id
        assert by_name["Link Taken"].user_id == other_id
        assert by_name["Link Inactive"].user_id is None
        assert by_name["Link Else"].user_id is None
        assert user.assignments == []


def test_unverified_email_links_nothing(login):
    with SessionLocal() as db:
        _add(db, "Unverified Bob", "bob@tenant.test")
        db.commit()
    login({"sub": "bob-1", "preferred_username": "bob@tenant.test"})
    with SessionLocal() as db:
        assert db.scalar(select(Stakeholder.user_id).where(Stakeholder.name == "Unverified Bob")) is None
