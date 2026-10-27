import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings, get_settings
from app.db import SessionLocal
from app.models.auth import User

EXAMPLE_KEY = "change-me-at-least-32-random-characters"


def _fresh_settings() -> Settings:
    """Build settings from the current environment without touching the cached instance other tests share."""
    return get_settings.__wrapped__()


@pytest.fixture
def production(monkeypatch):
    monkeypatch.setenv("NIS2_ENV", "production")
    return monkeypatch


def test_production_refuses_the_example_secret_key(production, tmp_path):
    production.setenv("NIS2_DATA_DIR", str(tmp_path))
    for key in (EXAMPLE_KEY, EXAMPLE_KEY.upper(), "x" * 20 + "Change-Me" + "x" * 20):
        production.setenv("NIS2_SECRET_KEY", key)
        with pytest.raises(RuntimeError, match="NIS2_SECRET_KEY"):
            _fresh_settings()


def test_production_starts_with_a_random_secret_key(production, tmp_path):
    production.setenv("NIS2_DATA_DIR", str(tmp_path))
    production.setenv("NIS2_SECRET_KEY", "k7Qd9fVb2LmX0aZr5TyWc8NhJe3UgPs1RoIv4BxAq6MtYlDn")
    assert _fresh_settings().is_production


def test_oidc_has_no_default_role():
    assert Settings(_env_file=None).oidc_default_role is None


class _FakeOAuth:
    def __init__(self, claims):
        self.claims = claims

    async def authorize_access_token(self, request):
        return {"userinfo": self.claims}


def test_oidc_login_without_groups_creates_a_user_without_roles(app_, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "oidc_issuer", "https://idp.test")
    monkeypatch.setattr(s, "oidc_default_role", None)
    monkeypatch.setattr(s, "oidc_role_mapping", {"nis2-admins": "admin"})
    claims = {"sub": "norole-1", "email": "norole@idp.test", "email_verified": True, "name": "No Role"}
    monkeypatch.setattr("app.api.auth.oauth_client", lambda: _FakeOAuth(claims))
    c = TestClient(app_)
    r = c.get("/api/auth/oidc/callback", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "/"
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "norole@idp.test"))
        assert user is not None and user.assignments == []
    me = c.get("/api/auth/me")
    assert me.status_code == 200


def test_oidc_refusal_to_link_logs_no_email_address(app_, monkeypatch, caplog):
    s = get_settings()
    monkeypatch.setattr(s, "oidc_issuer", "https://idp.test")
    claims = {"sub": "link-denied-1", "email": "admin@example.local", "email_verified": True, "name": "X"}
    monkeypatch.setattr("app.api.auth.oauth_client", lambda: _FakeOAuth(claims))
    with caplog.at_level(logging.DEBUG):
        r = TestClient(app_).get("/api/auth/oidc/callback", follow_redirects=False)
    assert r.headers["location"] == "/login?error=link_denied"
    assert any("not linked" in m for m in caplog.messages)
    assert "admin@example.local" not in caplog.text
