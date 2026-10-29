"""Initial data load: roles, optional bootstrap admin, stakeholders, requirement catalogue, first assessment
round and the implementation project from the bundled Excel templates, plus the regulations library with
automatic requirement links. Entities, users and answers come from the first-run setup (or the demo seed). Idempotent: every step only runs when its target is empty.

Usage:  python -m app.seed.seed [--demo]
"""

import logging
import sys

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.permissions import ALL, BUILTIN_ROLES
from app.core.security import hash_password, password_problems
from app.db import SessionLocal
from app.models import (
    AssessmentRound,
    Chapter,
    Entity,
    Project,
    Regulation,
    Requirement,
    RequirementProvision,
    Role,
    RoleAssignment,
    SearchChunk,
    Setting,
    Stakeholder,
    User,
)
from app.services import regulations as regsvc
from app.services.indexing import reindex_all
from app.services.project_setup import create_default_project, seed_project_stakeholders, stakeholder
from app.services.workbook import parse_gap_workbook

log = logging.getLogger("seed")


def sync_roles(db: Session) -> None:
    for spec in BUILTIN_ROLES:
        role = db.scalar(select(Role).where(Role.key == spec["key"]))
        if not role:
            db.add(
                Role(
                    key=spec["key"],
                    name=spec["name"],
                    description=spec["description"],
                    permissions=spec["permissions"],
                    is_system=True,
                )
            )
        elif role.key == "admin":
            role.permissions = ALL  # the admin role always carries every permission
        elif role.is_system:
            # add permissions introduced by newer versions without dropping local customisations
            role.permissions = sorted(set(role.permissions or []) | set(spec["permissions"]))
    db.commit()


def bootstrap_admin(db: Session) -> bool:
    """Only with NIS2_BOOTSTRAP_ADMIN_PASSWORD set; otherwise the first-run setup creates the administrator.
    True when this call created the administrator."""
    s = get_settings()
    if not s.bootstrap_admin_password or db.scalar(select(func.count(User.id))):
        return False
    if problems := password_problems(s.bootstrap_admin_password):
        raise RuntimeError(
            "NIS2_BOOTSTRAP_ADMIN_PASSWORD does not meet the password policy: needs " + ", ".join(problems)
        )
    admin = User(
        email=s.bootstrap_admin_email.lower(),
        display_name="Administrator",
        password_hash=hash_password(s.bootstrap_admin_password),
        auth_source="local",
    )
    db.add(admin)
    db.flush()
    db.add(RoleAssignment(user_id=admin.id, role_id=db.scalar(select(Role.id).where(Role.key == "admin"))))
    db.commit()
    return True


def seed_catalog_and_assessments(db: Session) -> None:
    if db.scalar(select(func.count(Requirement.id))):
        return
    gap = parse_gap_workbook()
    cache: dict[str, Stakeholder] = {}
    for name in gap["responsible"]:
        stakeholder(db, name, cache)

    chapters: dict[int, Chapter] = {}
    for c in gap["chapters"]:
        ch = Chapter(
            number=c["number"],
            title=c["title"],
            target=c["target"],
            source="IR2024/2690" if c["number"] <= 13 else "national",
        )
        db.add(ch)
        chapters[c["number"]] = ch
    db.flush()
    reqs: dict[str, Requirement] = {}
    for r in gap["requirements"]:
        req = Requirement(
            number=r["number"],
            chapter_id=chapters[r["chapter"]].id,
            section=r["section"],
            text=r["text"],
            check_points=r["check_points"],
            legal_reference=r["legal_reference"],
            iso_reference=r["iso_reference"],
            is_core=r["is_core"],
            sort_order=r["sort_order"],
        )
        db.add(req)
        reqs[r["number"]] = req
    db.flush()

    db.add(
        AssessmentRound(
            name="Round 1",
            description="First full GAP assessment against the 161 "
            "requirements of IR 2024/2690 plus 13 national requirements.",
            status="active",
            is_current=True,
        )
    )
    db.commit()


def seed_project(db: Session, create_plan: bool = False) -> None:
    """The project roles and, when asked (demo and bootstrap runs), the default plan; otherwise the first-run
    setup creates the plan. Once a project exists its roles belong to the admin (renamed, deactivated, deleted),
    so a restart or an upgrade leaves them alone."""
    if not db.scalar(select(func.count(Project.id))):
        seed_project_stakeholders(db)
        if create_plan:
            entities = list(db.scalars(select(Entity).order_by(Entity.sort_order, Entity.id)))
            create_default_project(db, entities)
    db.commit()


def seed_regulations(db: Session) -> None:
    if not db.scalar(select(func.count(Regulation.id))):
        regsvc.load_regulations(db)
        regsvc.add_annex_requirement_texts(db)
    if not db.scalar(select(func.count(RequirementProvision.id))):
        n = regsvc.link_requirements(db)
        print(f"linked {n} requirement/provision pairs")


def seed_settings(db: Session) -> None:
    defaults = {
        "ai.enabled": False,
        "ai.system_prompt_extra": "",
        "ai.temperature": 0.2,
        "ai.max_context_chunks": 12,
        "ai.use_tools": True,
        "branding.org_name": "Group",
        "reminders.due_soon_days": 14,
    }
    for k, v in defaults.items():
        if not db.get(Setting, k):
            db.add(Setting(key=k, value=v))
    db.commit()


def seed_features(db: Session, demo: bool) -> None:
    """Call `seed(db, demo)` of every feature module that provides app/features/<name>/seed.py."""
    import importlib
    import pkgutil

    import app.features as features

    for mod in sorted(pkgutil.iter_modules(features.__path__), key=lambda m: m.name):
        try:
            m = importlib.import_module(f"app.features.{mod.name}.seed")
        except ModuleNotFoundError as e:
            if e.name != f"app.features.{mod.name}.seed":
                raise
            continue
        m.seed(db, demo)
        db.commit()


def run(demo: bool = False) -> None:
    logging.basicConfig(level=logging.INFO)
    import app.main  # noqa: F401  (imports feature routers so their search sources and hooks are registered)

    db = SessionLocal()
    try:
        fresh_index = not db.scalar(select(func.count(SearchChunk.id)))
        sync_roles(db)
        admin_created = bootstrap_admin(db)
        seed_catalog_and_assessments(db)
        seed_project(db, create_plan=admin_created and not demo)  # demo builds its plan after its companies
        seed_regulations(db)
        seed_settings(db)
        if demo:
            from app.seed.demo import seed_demo

            seed_demo(db)
        seed_features(db, demo)
        if fresh_index:
            print(f"indexed {reindex_all(db)} search chunks")
    finally:
        db.close()


if __name__ == "__main__":
    run(demo="--demo" in sys.argv)
