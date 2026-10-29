"""First-run setup with the project block and the plan preview (fresh base seed per test: setup changes stakeholders)."""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from app.config import get_settings
from app.db import get_db
from app.models import Activity, Gate, Project, Stakeholder
from app.seed import seed
from app.services import setup as setup_service
from tests.test_seed_base import base_seed  # noqa: F401
from tests.test_setup import payload

TODAY = date.today()
START = TODAY - timedelta(days=TODAY.weekday())
ISO, BOARD, STEERING = "Information Security Officer", "Management Board", "Steering Committee"


@pytest.fixture
def factory(base_seed, monkeypatch, app_):  # noqa: F811
    factory = base_seed(None)
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
def client(factory, app_):
    return TestClient(app_)


@pytest.fixture
def oidc(monkeypatch):
    monkeypatch.setattr(get_settings(), "oidc_enabled", True)


def project(**kw):
    return {
        "name": "NIS2 Implementation",
        "start": START.isoformat(),
        "capacity": "part_time",
        "assessment": "parallel",
        "starting_point": "partial",
        "external_support": False,
    } | kw


def role(name, **kw):
    return {"name": name} | kw


def all_roles(factory, **changes):
    with factory() as db:
        names = [s.name for s in db.scalars(select(Stakeholder).order_by(Stakeholder.id))]
    return [role(n, **changes.get(n, {})) for n in names]


def locs(r):
    assert r.status_code == 422, r.text
    return [tuple(e["loc"]) for e in r.json()["errors"]]


def setup_with(client, **proj):
    return client.post("/api/setup", json=payload() | {"project": project(**proj)})


def preview(client, **kw):
    return client.post("/api/setup/plan-preview", json=project(companies=3, **kw))


def test_project_block_creates_the_previewed_plan(client, factory):
    prev = preview(client, capacity="dedicated")
    assert prev.status_code == 200, prev.text
    p = prev.json()
    assert {"proposed_end", "end", "earliest_end", "fit_factor", "warning", "phases", "gates"} <= p.keys()
    assert [g["code"] for g in p["gates"]] == [f"Gate {i}" for i in range(1, 7)]
    assert all(g["decision"] and g["date"] for g in p["gates"])
    assert len(p["phases"]) == 6 and {"name", "start", "finish"} == set(p["phases"][0])
    assert setup_with(client, capacity="dedicated", name="Plan X").status_code == 200
    with factory() as db:
        proj = db.scalar(select(Project))
        assert db.scalar(select(func.count(Project.id))) == 1 and proj.name == "Plan X"
        assert proj.planned_start == START and proj.planned_finish.isoformat() == p["end"]
        assert {g.code: g.planned_date.isoformat() for g in db.scalars(select(Gate))} == {
            g["code"]: g["date"] for g in p["gates"]
        }
        assert db.scalar(select(func.count(Activity.id))) == 26


def test_gate_override_is_stored_and_previewed(client, factory):
    first = date.fromisoformat(preview(client).json()["gates"][0]["date"]) - timedelta(days=1)
    assert (
        preview(client, gates={"Gate 1": first.isoformat()}).json()["gates"][0]["date"] == first.isoformat()
    )
    assert setup_with(client, gates={"Gate 1": first.isoformat()}).status_code == 200
    with factory() as db:
        assert db.scalar(select(Gate.planned_date).where(Gate.code == "Gate 1")) == first


def test_without_block_creates_default_plan(client, factory):
    assert client.post("/api/setup", json=payload()).status_code == 200
    with factory() as db:
        assert db.scalar(select(func.count(Project.id))) == 1
        assert db.scalar(select(Project.planned_start)) == START


def test_existing_project_ignores_block(client, factory):
    with factory() as db:
        db.add(Project(name="Old", code="OLD", status="In Progress", planned_start=START))
        db.commit()
    assert client.get("/api/setup/options").json()["project_exists"] is True
    bad = project(name="Other", end=(START - timedelta(days=5)).isoformat())
    assert client.post("/api/setup", json=payload() | {"project": bad}).status_code == 200
    with factory() as db:
        assert db.scalars(select(Project.name)).all() == ["Old"]


def test_preview_409_after_setup(client):
    assert client.post("/api/setup", json=payload()).status_code == 200
    assert preview(client).status_code == 409


def test_options_carry_oidc_project_and_roles(client, oidc):
    body = client.get("/api/setup/options").json()
    assert body["oidc_enabled"] is True and body["project_exists"] is False
    roles = {r["name"]: r for r in body["roles"]}
    assert roles[ISO]["mandatory"] is True and roles[BOARD]["mandatory"] is True
    assert "Local Contact" not in roles and STEERING in roles
    assert {"name", "description", "kind", "mandatory", "country"} == set(roles[ISO])


def test_options_after_setup_expose_no_roles(client):
    assert client.get("/api/setup/options").json()["roles"]
    assert client.post("/api/setup", json=payload()).status_code == 200
    body = client.get("/api/setup/options").json()
    assert body["roles"] == []
    assert body["project_exists"] is True


def test_options_oidc_disabled_by_default(client):
    assert client.get("/api/setup/options").json()["oidc_enabled"] is False


def test_end_before_start(client):
    end = (START - timedelta(days=1)).isoformat()
    assert ("body", "project", "end") in locs(setup_with(client, end=end))
    assert ("body", "end") in locs(preview(client, end=end))


@pytest.mark.parametrize("delta", [-400, 800])
def test_start_out_of_range(client, delta):
    start = (TODAY + timedelta(days=delta)).isoformat()
    assert ("body", "project", "start") in locs(setup_with(client, start=start))
    assert ("body", "start") in locs(preview(client, start=start))


def test_infeasible_end_names_earliest_end(client):
    end = (START + timedelta(days=10)).isoformat()
    r = setup_with(client, end=end)
    assert ("body", "project", "end") in locs(r)
    earliest = preview(client).json()["earliest_end"]
    assert earliest > end
    msg = next(e["msg"] for e in r.json()["errors"] if e["loc"][-1] == "end")
    assert earliest in msg
    assert ("body", "end") in locs(preview(client, end=end))


def test_end_date_far_in_the_future_is_rejected(client):
    end = "2226-12-31"
    found = locs(setup_with(client, end=end))
    assert ("body", "project", "end") in found
    r = preview(client, end=end)
    assert ("body", "end") in locs(r)
    assert "too late" in next(e["msg"] for e in r.json()["errors"] if e["loc"][-1] == "end")


def test_tight_end_warns_but_is_accepted(client):
    earliest = date.fromisoformat(preview(client).json()["earliest_end"])
    tight = (earliest + timedelta(days=14)).isoformat()
    q = preview(client, end=tight).json()
    assert q["warning"] and q["fit_factor"] < 0.75 and q["end"] == tight
    assert setup_with(client, end=tight).status_code == 200


def test_gate_override_outside_range(client):
    r = setup_with(client, gates={"Gate 1": (START - timedelta(days=30)).isoformat()})
    assert ("body", "project", "gates", "Gate 1") in locs(r)
    late = (START + timedelta(days=900)).isoformat()
    assert ("body", "gates", "Gate 2") in locs(preview(client, gates={"Gate 2": late}))


def test_gates_out_of_order(client):
    gates = preview(client).json()["gates"]
    later = date.fromisoformat(gates[2]["date"]) + timedelta(days=1)
    r = setup_with(client, gates={"Gate 1": later.isoformat()})
    assert ("body", "project", "gates", "Gate 1") in locs(r)


def test_unknown_gate_code(client):
    assert ("body", "project", "gates", "Gate 99") in locs(
        setup_with(client, gates={"Gate 99": START.isoformat()})
    )


def test_empty_name(client):
    roles = [role("  ", custom=True)]
    assert ("body", "project", "roles", 0, "name") in locs(setup_with(client, roles=roles))


def test_duplicate_names_and_clash_with_existing(client):
    roles = [role("Auditor X", custom=True), role("auditor x", custom=True)]
    assert ("body", "project", "roles", 1, "name") in locs(setup_with(client, roles=roles))
    clash = [role(ISO), role(BOARD), role(f"  {BOARD.upper()} ", custom=True)]
    assert ("body", "project", "roles", 2, "name") in locs(setup_with(client, roles=clash))
    renamed = [role(ISO), role(BOARD), role(STEERING, rename_to=BOARD.lower())]
    assert ("body", "project", "roles", 2, "rename_to") in locs(setup_with(client, roles=renamed))
    # an existing stakeholder the wizard does not offer ("Local Contact"), in another case
    hidden = [role(ISO), role(BOARD), role(STEERING, rename_to="local contact")]
    assert ("body", "project", "roles", 2, "rename_to") in locs(setup_with(client, roles=hidden))
    assert ("body", "roles", 1, "name") in locs(preview(client, roles=roles))


def test_mandatory_role_deselected_or_renamed(client):
    r = setup_with(client, roles=[role(ISO, selected=False), role(BOARD, rename_to="Board")])
    assert ("body", "project", "roles", 0, "name") in locs(r)
    assert ("body", "project", "roles", 1, "rename_to") in locs(r)


def test_email_rejected_without_oidc(client):
    r = setup_with(client, roles=[role(ISO, email="a@example.test"), role(BOARD)])
    assert ("body", "project", "roles", 0, "email") in locs(r)


def test_invalid_and_duplicate_email(client, oidc):
    roles = [
        role(ISO, email="nope"),
        role(BOARD, email="a@example.test"),
        role(STEERING, email="A@Example.test"),
    ]
    found = locs(setup_with(client, roles=roles))
    assert ("body", "project", "roles", 0, "email") in found
    assert ("body", "project", "roles", 2, "email") in found
    assert ("body", "project", "roles", 1, "email") not in found


def test_roles_and_emails_are_applied(client, factory, oidc):
    roles = all_roles(factory, **{ISO: {"email": "Ida@Example.test"}, STEERING: {"selected": False}})
    roles.append(role("Plant Lead", custom=True))
    assert setup_with(client, roles=roles).status_code == 200
    with factory() as db:
        iso = db.scalar(select(Stakeholder).where(Stakeholder.name == ISO))
        assert iso.email == "ida@example.test" and iso.user_id is not None
        assert db.scalar(select(Stakeholder.is_active).where(Stakeholder.name == STEERING)) is False
        assert db.scalar(select(Stakeholder.kind).where(Stakeholder.name == "Plant Lead")) == "role"


def test_chained_and_swapped_renames_do_not_collide(client, factory):
    roles = [
        role(ISO),
        role(BOARD),
        role("Central IT", rename_to="Local IT"),
        role("Local IT", rename_to="Site IT"),
        role("HR", rename_to="Data Protection Officer"),
        role("Data Protection Officer", rename_to="HR"),
    ]
    assert setup_with(client, roles=roles).status_code == 200
    with factory() as db:
        names = list(db.scalars(select(Stakeholder.name)))
        assert len(names) == len({n.lower() for n in names})
        assert {"Local IT", "Site IT"} <= set(names) and "Central IT" not in names


def test_custom_role_named_like_a_template_owner_is_rejected(client):
    roles = [role(ISO), role(BOARD), role("assigned work-package owners", custom=True)]
    assert ("body", "project", "roles", 2, "name") in locs(setup_with(client, roles=roles))
    renamed = [role(ISO), role(BOARD), role(STEERING, rename_to="Assigned Work-Package Owners")]
    assert ("body", "project", "roles", 2, "rename_to") in locs(setup_with(client, roles=renamed))


def test_custom_role_may_take_a_name_a_rename_frees(client, factory):
    roles = [role(ISO), role(BOARD), role("Central IT", rename_to="Site IT"), role("Central IT", custom=True)]
    assert setup_with(client, roles=roles).status_code == 200
    with factory() as db:
        kinds = dict(db.execute(select(Stakeholder.name, Stakeholder.kind)).all())
        assert {"Site IT", "Central IT"} <= set(kinds)


def test_restart_seed_does_not_bring_back_a_renamed_role(client, factory):
    roles = all_roles(factory, **{"IT Coordinator": {"rename_to": "IT Lead"}})
    assert setup_with(client, roles=roles).status_code == 200
    with factory() as db:
        seed.seed_project(db)
        names = set(db.scalars(select(Stakeholder.name)))
        assert "IT Lead" in names and "IT Coordinator" not in names
