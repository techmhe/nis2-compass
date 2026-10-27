"""Entra ID specifics of the OIDC login: app roles as the groups claim, and group overage."""

import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models.auth import Role, RoleAssignment, User


class _FakeOAuth:
    def __init__(self, claims):
        self.claims = claims

    async def authorize_access_token(self, request):
        return {"userinfo": self.claims}


@pytest.fixture
def entra(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "oidc_issuer", "https://login.microsoftonline.test/tenant/v2.0")
    monkeypatch.setattr(s, "oidc_default_role", None)

    def login(app_, claims):
        monkeypatch.setattr("app.api.auth.oauth_client", lambda: _FakeOAuth(claims))
        return TestClient(app_).get("/api/auth/oidc/callback", follow_redirects=False)

    return monkeypatch, s, login


def _role_keys(sub_suffix: str) -> set[str]:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.oidc_subject.like(f"%|{sub_suffix}")))
        assert user is not None
        return {a.role.key for a in user.assignments}


def test_app_roles_claim_maps_to_roles(app_, entra):
    monkeypatch, s, login = entra
    monkeypatch.setattr(s, "oidc_groups_claim", "roles")
    monkeypatch.setattr(s, "oidc_role_mapping", {"nis2.isb": "security_officer"})
    claims = {"sub": "approle-1", "preferred_username": "approle@tenant.test", "roles": ["nis2.isb"]}
    r = login(app_, claims)
    assert r.headers["location"] == "/"
    assert _role_keys("approle-1") == {"security_officer"}


@pytest.mark.parametrize(
    "overage",
    [
        {"_claim_names": {"groups": "src1"}, "_claim_sources": {"src1": {"endpoint": "https://graph.test"}}},
        {"hasgroups": True},
    ],
)
def test_group_overage_removes_mapped_roles_and_warns(app_, entra, caplog, overage):
    monkeypatch, s, login = entra
    monkeypatch.setattr(s, "oidc_groups_claim", "groups")
    monkeypatch.setattr(s, "oidc_role_mapping", {"g-admins-guid": "security_officer"})
    sub = f"overage-{len(overage)}"
    base = {"sub": sub, "preferred_username": f"{sub}@tenant.test"}
    assert login(app_, {**base, "groups": ["g-admins-guid"]}).headers["location"] == "/"
    assert _role_keys(sub) == {"security_officer"}

    with caplog.at_level(logging.WARNING):
        r = login(app_, {**base, **overage})
    assert r.headers["location"] == "/"
    # fail closed: joining enough groups must not keep a role the mapping would revoke
    assert _role_keys(sub) == set()
    assert any("overage" in m for m in caplog.messages)
    assert f"{sub}@tenant.test" not in caplog.text


def test_missing_groups_without_overage_still_removes_mapped_roles(app_, entra):
    monkeypatch, s, login = entra
    monkeypatch.setattr(s, "oidc_groups_claim", "groups")
    monkeypatch.setattr(s, "oidc_role_mapping", {"g-isb-guid": "security_officer"})
    base = {"sub": "removed-1", "preferred_username": "removed@tenant.test"}
    login(app_, {**base, "groups": ["g-isb-guid"]})
    assert _role_keys("removed-1") == {"security_officer"}
    login(app_, base)
    assert _role_keys("removed-1") == set()


def test_manual_roles_survive_group_overage(app_, entra):
    monkeypatch, s, login = entra
    monkeypatch.setattr(s, "oidc_role_mapping", {"g-x": "security_officer"})
    base = {"sub": "manual-1", "preferred_username": "manual@tenant.test"}
    login(app_, base)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.oidc_subject.like("%|manual-1")))
        viewer = db.scalar(select(Role).where(Role.key == "viewer"))
        db.add(RoleAssignment(user_id=user.id, role_id=viewer.id))
        db.commit()
    login(app_, {**base, "hasgroups": True})
    assert _role_keys("manual-1") == {"viewer"}
