"""The seed no longer hands every install the same fixed plan: setup (or demo/bootstrap runs) creates it."""

from datetime import date, timedelta

from sqlalchemy import delete, func, select, update

from app.db import SessionLocal
from app.models import Activity, Project, Stakeholder, WorkPackage
from app.seed import seed
from tests.test_seed_base import base_seed  # noqa: F401  (fixture)


def this_monday() -> date:
    today = date.today()
    return today - timedelta(days=today.weekday())


def test_base_seed_has_no_project_but_roles(base_seed):  # noqa: F811
    with base_seed(None)() as db:
        assert db.scalar(select(func.count(Project.id))) == 0
        names = {s.name: s for s in db.scalars(select(Stakeholder))}
        assert names["Steering Committee"].kind == "role"
        assert names["Local IT / MSP"].description
        # only Gate 4 is decided by the committee in the template; the Management Board decides the others
        steering = names["Steering Committee"].description
        assert "Gate 4" in steering and "management gates" not in steering
        assert names["Information Security Officer"].description


def test_bootstrap_seed_creates_default_plan(base_seed):  # noqa: F811
    with base_seed("Some-Admin-Password-2026!")() as db:
        project = db.scalar(select(Project))
        assert db.scalar(select(func.count(Project.id))) == 1
        assert project.planned_start == this_monday()
        assert {f["field"]: f["value"] for f in project.overview}[
            "Geographic Scope"
        ] == "HQ and all subsidiaries"
        assert db.scalar(select(func.count(Activity.id))) == 26


def test_demo_plan_starts_this_week():
    with SessionLocal() as db:
        project = db.scalar(select(Project))
        assert db.scalar(select(func.count(Project.id))) == 1
        assert project.planned_start == this_monday()
        assert db.scalar(select(func.count(WorkPackage.id)).where(WorkPackage.project_id == project.id)) > 0
        geo = {f["field"]: f["value"] for f in project.overview}["Geographic Scope"]
        assert geo.endswith("3 subsidiaries")


def test_reseed_keeps_renamed_and_deleted_roles_of_an_existing_project(base_seed):  # noqa: F811
    """The entrypoint seeds on every start; an installed project's roles are the admin's to change."""
    with base_seed("Some-Admin-Password-2026!")() as db:
        db.execute(update(Stakeholder).where(Stakeholder.name == "IT Coordinator").values(name="IT Lead"))
        db.execute(delete(Stakeholder).where(Stakeholder.name == "Local Contact"))
        db.commit()
        count = db.scalar(select(func.count(Stakeholder.id)))
        seed.seed_project(db)
        names = set(db.scalars(select(Stakeholder.name)))
        assert db.scalar(select(func.count(Stakeholder.id))) == count
        assert "IT Lead" in names and "IT Coordinator" not in names and "Local Contact" not in names
