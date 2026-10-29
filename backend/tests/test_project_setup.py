"""Building the project from a schedule: structure, role fallbacks, generated texts, offered roles."""

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models import (
    Activity,
    Entity,
    Gate,
    Phase,
    RaciActivity,
    RaciCell,
    RaciColumn,
    RaidRecord,
    Stakeholder,
    User,
)
from app.services.project_plan import PlanInputs, schedule, template
from app.services.project_setup import MANDATORY, RoleChoice, create_project, offered_roles
from tests.test_seed_base import base_seed  # noqa: F401  (fixture)

START = date(2027, 3, 1)  # a Monday
INPUTS = PlanInputs(START, None, "part_time", "parallel", "partial", False, 3)


@pytest.fixture()
def db(base_seed):  # noqa: F811
    with base_seed(None)() as session:
        yield session
        session.rollback()


def company(code, name, country, hq=False):
    return Entity(code=code, name=name, finding_prefix=code, country=country, is_headquarters=hq)


def entities():
    return [company("AL", "Alpha", "DE", True), company("BE", "Beta", "DE"), company("GA", "Gamma", "NL")]


def build(db, inputs=INPUTS, roles=None, overrides=None, admin=None, ents=None):
    return create_project(
        db,
        inputs,
        schedule(inputs),
        name="Plan",
        roles=roles,
        gate_overrides=overrides or {},
        entities=entities() if ents is None else ents,
        admin=admin,
    )


def raci(db, project):
    cols = {c.id: c for c in db.scalars(select(RaciColumn).where(RaciColumn.project_id == project.id))}
    rows = {}
    for ra in db.scalars(select(RaciActivity).where(RaciActivity.project_id == project.id)):
        cells = db.scalars(select(RaciCell).where(RaciCell.activity_id == ra.id)).all()
        rows[ra.name] = {cols[c.column_id].name: c.value for c in cells}
    return cols, rows


def test_creates_template_structure(db):
    sched = schedule(INPUTS)
    override = date(2027, 6, 4)
    project = build(db, overrides={"Gate 1": override})
    tpl = template()
    assert db.scalar(select(Phase).where(Phase.project_id == project.id).limit(1)) is not None
    assert len(db.scalars(select(Phase).where(Phase.project_id == project.id)).all()) == 6
    acts = {a.code: a for a in db.scalars(select(Activity).where(Activity.project_id == project.id))}
    assert len(acts) == 26
    for code, slot in sched.activities.items():
        assert (acts[code].planned_start, acts[code].planned_finish) == (slot.start, slot.finish)
    gates = {g.code: g for g in db.scalars(select(Gate).where(Gate.project_id == project.id))}
    assert len(gates) == 6
    assert gates["Gate 1"].planned_date == override
    assert all(gates[c].planned_date == d for c, d in sched.gates.items() if c != "Gate 1")
    for t in tpl.activities:
        assert {d.code for d in acts[t.code].depends_on} == {c for c, _ in t.dependencies}
    cols, rows = raci(db, project)
    assert len(rows) == 13 and len(cols) == 11
    r1 = db.scalar(select(RaidRecord).where(RaidRecord.project_id == project.id))
    assert (r1.code, r1.date_raised, r1.target_date) == ("R1", START, START + timedelta(days=18))
    assert project.planned_start == START
    assert project.planned_finish == max(s.finish for s in sched.activities.values())


def test_deselected_role_falls_back(db):
    iso = db.scalar(select(Stakeholder).where(Stakeholder.name == "Information Security Officer"))
    roles = [
        RoleChoice(r["name"], selected=r["name"] not in ("OT", "IT Coordinator"))
        for r in offered_roles(db, {"DE", "NL"})
    ]
    project = build(db, roles=roles)
    for name in ("OT", "IT Coordinator"):
        assert db.scalar(select(Stakeholder).where(Stakeholder.name == name)).is_active is False
    cols, rows = raci(db, project)
    assert "OT" not in {c.name for c in cols.values()} and "IT Coordinator" not in {
        c.name for c in cols.values()
    }
    for cells in rows.values():
        assert sum(v in ("A", "A/R") for v in cells.values()) == 1
    assert all(
        a.owner_id is None or db.get(Stakeholder, a.owner_id).is_active
        for a in db.scalars(select(Activity).where(Activity.project_id == project.id))
    )
    raid = db.scalar(select(RaidRecord).where(RaidRecord.project_id == project.id))
    assert db.get(Stakeholder, raid.owner_id).is_active
    assert iso.is_active


def test_gate_owner_falls_back(db):
    roles = [
        RoleChoice(r["name"], selected=r["name"] != "Steering Committee") for r in offered_roles(db, {"DE"})
    ]
    project = build(db, roles=roles)
    gate4 = db.scalar(select(Gate).where(Gate.project_id == project.id, Gate.code == "Gate 4"))
    assert db.get(Stakeholder, gate4.decision_owner_id).name == "Management Board"


def test_rename_and_custom(db):
    roles = [
        RoleChoice(r["name"], rename_to="Privacy Lead" if r["name"] == "Data Protection Officer" else None)
        for r in offered_roles(db, {"DE"})
    ] + [RoleChoice("Plant Manager", custom=True)]
    project = build(db, roles=roles)
    cols, _ = raci(db, project)
    assert "Privacy Lead" in {c.name for c in cols.values()} and "DPO" not in {c.name for c in cols.values()}
    custom = db.scalar(select(Stakeholder).where(Stakeholder.name == "Plant Manager"))
    assert custom.is_active and custom.kind == "role"
    assert "Plant Manager" not in {c.name for c in cols.values()}
    steering = {f["field"]: f["value"] for f in project.overview}["Steering Committee"]
    assert "Privacy Lead" in steering and "Data Protection Officer" not in steering


def test_overview_texts(db):
    project = build(db)
    ov = {f["field"]: f["value"] for f in project.overview}
    assert ov["Project Manager"] == "Information Security Officer"
    assert ov["Steering Committee"] == "Management Board; IT Coordinator; Data Protection Officer"
    assert ov["Geographic Scope"] == "Alpha and 2 subsidiaries"
    assert ov["Regulatory Scope"] == (
        "NIS2 implementation and related national requirements in Germany and the Netherlands"
    )
    assert ov["Delivery Model"] == "Part-time project alongside normal operations"
    assert ov["Assessment Model"].endswith("entities assessed in parallel")
    assert ov["Planning Assumption"] == (
        "Detailed remediation work packages are created after the GAP assessments and management approval (Gate 3)."
    )
    assert "Out of Scope" in ov and "Success Criterion" in ov
    assert project.sponsor == "Management Board"
    assert "Germany and the Netherlands" in project.description
    for value in ov.values():
        assert "2026" not in value and "49 questions" not in value and "28 September" not in value


def test_neutral_overview_texts(db):
    inputs = PlanInputs(START, None, "dedicated", "sequential", "none", True, 1)
    ov = {f["field"]: f["value"] for f in build(db, inputs=inputs, ents=[]).overview}
    assert ov["Geographic Scope"] == "HQ and all subsidiaries"
    assert ov["Regulatory Scope"] == "NIS2 implementation and related national requirements"
    assert ov["Delivery Model"] == "Dedicated core team"
    assert ov["Assessment Model"].endswith("entities assessed one after another")


def test_offered_roles(db):
    roles = {r["name"]: r for r in offered_roles(db, {"DE"})}
    assert roles["German External Adviser"]["country"] == "DE"
    assert "Dutch External Adviser" not in roles
    assert "Steering Committee" in roles and "Local Contact" not in roles
    assert {n for n, r in roles.items() if r["mandatory"]} == set(MANDATORY)
    assert roles["Data Protection Officer"]["description"]
    assert {"German External Adviser", "Dutch External Adviser"} <= {
        r["name"] for r in offered_roles(db, {"DE", "NL"})
    }


def test_admin_email_links(db):
    admin = User(email="boss@example.com", display_name="Boss", auth_source="local")
    db.add(admin)
    db.flush()
    roles = [
        RoleChoice(r["name"], email="BOSS@Example.com" if r["name"] == "Management Board" else None)
        for r in offered_roles(db, {"DE"})
    ]
    build(db, roles=roles, admin=admin)
    board = db.scalar(select(Stakeholder).where(Stakeholder.name == "Management Board"))
    assert board.user_id == admin.id and board.email == "BOSS@Example.com"
    iso = db.scalar(select(Stakeholder).where(Stakeholder.name == "Information Security Officer"))
    assert iso.user_id is None
