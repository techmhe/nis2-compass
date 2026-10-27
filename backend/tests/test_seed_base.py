"""The base seed (seed.run(demo=False)) in a scratch schema, isolated from the shared session database."""

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.db import Base
from app.models import Answer, Assessment, AssessmentRound, Chapter, Entity, Requirement, User
from app.seed import seed

SCHEMA = "seed_base_scratch"


@pytest.fixture(scope="module")
def base_seed():
    """Run the base seed once per admin-password variant; returns a factory yielding a session on the result."""
    url = get_settings().database_url
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"))
        conn.execute(text(f"CREATE SCHEMA {SCHEMA}"))
    # translate map: ORM tables go to the scratch schema (create_all would otherwise see the visible public ones);
    # search_path: raw SQL resolves to them first and still finds the extensions in public
    scratch = create_engine(
        url,
        connect_args={"options": f"-csearch_path={SCHEMA},public"},
        execution_options={"schema_translate_map": {None: SCHEMA}},
    )
    Base.metadata.create_all(scratch)
    factory = sessionmaker(bind=scratch, autoflush=False, expire_on_commit=False)

    def run(password: str | None):
        settings = get_settings()
        saved, saved_factory = settings.bootstrap_admin_password, seed.SessionLocal
        with scratch.begin() as conn:
            conn.execute(
                text(
                    "TRUNCATE "
                    + ", ".join(f'{SCHEMA}."{t.name}"' for t in Base.metadata.sorted_tables)
                    + " CASCADE"
                )
            )
        settings.bootstrap_admin_password = password
        seed.SessionLocal = factory
        try:
            seed.run(demo=False)
        finally:
            settings.bootstrap_admin_password = saved
            seed.SessionLocal = saved_factory
        return factory

    yield run
    scratch.dispose()
    with admin.begin() as conn:
        conn.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"))
    admin.dispose()


def test_base_seed_creates_no_entities_users_or_answers(base_seed):
    with base_seed(None)() as db:
        assert db.scalar(select(func.count(Entity.id))) == 0
        assert db.scalar(select(func.count(User.id))) == 0
        assert db.scalar(select(func.count(Answer.id))) == 0


def test_base_seed_creates_catalogue(base_seed):
    with base_seed(None)() as db:
        assert db.scalar(select(func.count(Chapter.id))) == 17
        assert db.scalar(select(func.count(Requirement.id))) == 174


def test_base_seed_round_named_round_1(base_seed):
    with base_seed(None)() as db:
        rounds = db.scalars(select(AssessmentRound)).all()
        assert [(r.name, r.status) for r in rounds] == [("Round 1", "active")]
        assert db.scalar(select(func.count(Assessment.id))) == 0


def test_bootstrap_admin_only_with_password_env(base_seed):
    with base_seed(None)() as db:
        assert db.scalar(select(func.count(User.id))) == 0
    with base_seed("Some-Admin-Password-2026!")() as db:
        admin = db.scalar(select(User))
        assert admin is not None and admin.email == get_settings().bootstrap_admin_email.lower()
        assert not admin.must_change_password


def test_no_initial_password_file(base_seed):
    path = get_settings().data_dir / "initial_admin_password.txt"
    path.unlink(missing_ok=True)
    base_seed(None)
    assert not path.exists()
