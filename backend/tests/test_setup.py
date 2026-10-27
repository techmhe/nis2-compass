"""First-run setup API on an empty database (the base seed in a scratch schema, see test_seed_base.py)."""

import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from app.db import get_db
from app.models import Answer, Assessment, AuditEvent, Entity, RoleAssignment, User
from app.services import setup as setup_service
from tests.test_seed_base import base_seed  # noqa: F401

PASSWORD = "Setup-Password-2026!"


def company(code="ATL", **kw):
    base = {
        "name": f"{code} Holding GmbH",
        "code": code,
        "legal_form": "GmbH",
        "country": "DE",
        "sector": "manufacturing_machinery",
        "size_class": "medium",
        "is_headquarters": False,
    }
    return base | kw


def payload(companies=None, **admin):
    return {
        "admin": {"display_name": "Ida Isb", "email": "Ida@Example.test", "password": PASSWORD} | admin,
        "companies": companies
        if companies is not None
        else [
            company("ATL", is_headquarters=True),
            company("ATS"),
            company("ATN", country="NL", legal_form="B.V."),
        ],
    }


@pytest.fixture(scope="module")
def seeded(base_seed):  # noqa: F811
    return base_seed(None)


@pytest.fixture
def empty(seeded, monkeypatch, app_):
    """The base-seeded scratch schema with no users or entities, wired into the app."""
    factory = seeded
    with factory() as db:
        for table in ("user_sessions", "audit_events", "role_assignments", "entities", "users"):
            db.execute(text(f"DELETE FROM {table}"))
        db.commit()
    monkeypatch.setattr(setup_service, "SessionLocal", factory)

    def scratch_db():
        with factory() as db:
            yield db

    app_.dependency_overrides[get_db] = scratch_db
    setup_service.reset_setup_cache()
    yield factory
    app_.dependency_overrides.pop(get_db, None)
    setup_service.reset_setup_cache()


@pytest.fixture
def client(empty, app_):
    return TestClient(app_)


def counts(factory):
    with factory() as db:
        return db.scalar(select(func.count(User.id))), db.scalar(select(func.count(Entity.id)))


def test_status_needed_on_empty_db(client):
    r = client.get("/api/setup/status")
    assert r.status_code == 200 and r.json() == {"needed": True}


def test_options_without_auth(client):
    r = client.get("/api/setup/options")
    assert r.status_code == 200
    assert {j["code"] for j in r.json()["jurisdictions"]} >= {"DE", "NL"}


def test_protected_route_503_while_needed(client):
    r = client.get("/api/entities")
    assert r.status_code == 503 and r.json() == {"detail": "setup required"}
    assert client.get("/api/health").status_code == 200


def test_setup_creates_admin_and_companies(client, empty):
    r = client.post("/api/setup", json=payload())
    assert r.status_code == 200, r.text
    assert r.json()["email"] == "ida@example.test"
    assert any(role["key"] == "admin" for role in r.json()["roles"])
    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["email"] == "ida@example.test"
    with empty() as db:
        admin = db.scalar(select(User))
        assert admin.auth_source == "local" and not admin.must_change_password
        assert [a.role.key for a in db.scalars(select(RoleAssignment))] == ["admin"]
        entities = db.scalars(select(Entity).order_by(Entity.sort_order)).all()
        assert [e.code for e in entities] == ["ATL", "ATS", "ATN"]
        assert [e.sort_order for e in entities] == [0, 1, 2]
        assert [e.is_headquarters for e in entities] == [True, False, False]
        de, nl = entities[0], entities[2]
        assert de.competent_authority and de.csirt and nl.competent_authority and nl.csirt
        assert de.competent_authority != nl.competent_authority
        for e in entities:
            assert e.finding_prefix == e.code
            assert e.nis2_classification == "tbd"
            assert e.activity_sector == "manufacturing_machinery" and e.size_class == "medium"
            asms = db.scalars(select(Assessment).where(Assessment.entity_id == e.id)).all()
            assert len(asms) == 1
            answers = db.scalars(select(Answer).where(Answer.assessment_id == asms[0].id)).all()
            assert len(answers) == 174 and {a.scope for a in answers} == {"In Scope"}
            for a in answers:
                assert not (a.implemented or a.documented or a.effectiveness or a.evidence or a.notes)
                assert not (a.gap_description or a.recommended_action or a.responsible_id)
        actions = [a.action for a in db.scalars(select(AuditEvent))]
        assert actions.count("create") == 3 and "setup" in actions
        assert {a.actor_id for a in db.scalars(select(AuditEvent))} == {admin.id}


def test_status_false_after_setup(client):
    assert client.post("/api/setup", json=payload()).status_code == 200
    assert client.get("/api/setup/status").json() == {"needed": False}
    assert client.get("/api/entities").status_code == 200


def test_second_setup_409(client, empty):
    assert client.post("/api/setup", json=payload()).status_code == 200
    r = TestClient(client.app).post("/api/setup", json=payload(email="x@example.test"))
    assert r.status_code == 409 and r.json() == {"detail": "setup already completed"}
    assert counts(empty) == (1, 3)


def test_setup_is_rejected_for_admin_session_after_setup(client):
    assert client.post("/api/setup", json=payload()).status_code == 200
    assert client.post("/api/setup", json=payload(email="y@example.test")).status_code == 409


def test_concurrent_setup_one_wins(empty, app_):
    results = []
    barrier = threading.Barrier(2)

    def go(email):
        c = TestClient(app_)
        barrier.wait()
        results.append(c.post("/api/setup", json=payload(email=email)).status_code)

    threads = [threading.Thread(target=go, args=(f"t{i}@example.test",)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [200, 409]
    assert counts(empty) == (1, 3)


def locs(r):
    return [tuple(e["loc"]) for e in r.json()["errors"]]


def rejected(client, empty, body, *path):
    r = client.post("/api/setup", json=body)
    assert r.status_code == 422, r.text
    assert ("body", *path) in locs(r), locs(r)
    assert counts(empty) == (0, 0)


def test_422_no_headquarters(client, empty):
    rejected(client, empty, payload([company("ATL"), company("ATS")]), "companies")


def test_422_two_headquarters(client, empty):
    body = payload([company("ATL", is_headquarters=True), company("ATS", is_headquarters=True)])
    rejected(client, empty, body, "companies", 1, "is_headquarters")


def test_422_duplicate_code_differing_in_case(client, empty):
    body = payload([company("ATL", is_headquarters=True), company("ATS"), company("atl")])
    rejected(client, empty, body, "companies", 2, "code")


def test_422_unknown_country(client, empty):
    body = payload([company("ATL", is_headquarters=True, country="XX")])
    rejected(client, empty, body, "companies", 0, "country")


def test_422_unknown_sector(client, empty):
    body = payload([company("ATL", is_headquarters=True, sector="nope")])
    rejected(client, empty, body, "companies", 0, "sector")


def test_422_bad_size_class(client, empty):
    body = payload([company("ATL", is_headquarters=True, size_class="huge")])
    rejected(client, empty, body, "companies", 0, "size_class")


def test_422_bad_code_characters(client, empty):
    body = payload([company("A T", is_headquarters=True)])
    rejected(client, empty, body, "companies", 0, "code")


def test_422_weak_password(client, empty):
    rejected(client, empty, payload(password="short"), "admin", "password")


def test_422_invalid_email(client, empty):
    rejected(client, empty, payload(email="not-an-email"), "admin", "email")


def test_422_zero_companies(client, empty):
    rejected(client, empty, payload([]), "companies")


def test_422_fifty_one_companies(client, empty):
    many = [company(f"C{i}", is_headquarters=i == 0) for i in range(51)]
    rejected(client, empty, payload(many), "companies")


def test_guard_ignores_host_header_path_tricks(client):
    r = client.get("/api/entities", headers={"host": "x/api/setup/?"})
    assert r.status_code == 503 and r.json() == {"detail": "setup required"}


def test_post_after_setup_409_without_hashing(client, monkeypatch):
    assert client.post("/api/setup", json=payload()).status_code == 200

    def boom(_password):
        raise AssertionError("hash_password must not run once setup is done")

    monkeypatch.setattr("app.api.setup.hash_password", boom)
    r = TestClient(client.app).post("/api/setup", json=payload(email="z@example.test"))
    assert r.status_code == 409 and r.json() == {"detail": "setup already completed"}
