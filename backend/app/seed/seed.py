"""Initial data load: roles, optional bootstrap admin, stakeholders, requirement catalogue, first assessment
round and the implementation project from the bundled Excel templates, plus the regulations library with
automatic requirement links. Entities, users and answers come from the first-run setup (or the demo seed). Idempotent: every step only runs when its target is empty.

Usage:  python -m app.seed.seed [--demo]
"""

import logging
import re
import sys

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.permissions import ALL, BUILTIN_ROLES
from app.core.security import hash_password, password_problems
from app.db import SessionLocal
from app.models import (
    Activity,
    AssessmentRound,
    Chapter,
    Gate,
    Phase,
    Project,
    RaciActivity,
    RaciCell,
    RaciColumn,
    RaidRecord,
    Regulation,
    Requirement,
    RequirementProvision,
    Role,
    RoleAssignment,
    SearchChunk,
    Setting,
    Stakeholder,
    User,
    WorkPackage,
)
from app.services import regulations as regsvc
from app.services.indexing import reindex_all
from app.services.workbook import parse_gap_workbook, parse_project_workbook

log = logging.getLogger("seed")

STAKEHOLDER_ALIASES = {
    "DPO": "Data Protection Officer",
    "DE Adviser": "German External Adviser",
    "NL Adviser": "Dutch External Adviser",
    "MSP": "MSP+IT",
}


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


def bootstrap_admin(db: Session) -> None:
    """Only with NIS2_BOOTSTRAP_ADMIN_PASSWORD set; otherwise the first-run setup creates the administrator."""
    s = get_settings()
    if not s.bootstrap_admin_password or db.scalar(select(func.count(User.id))):
        return
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


def stakeholder(db: Session, name: str | None, cache: dict[str, Stakeholder]) -> Stakeholder | None:
    if not name:
        return None
    name = STAKEHOLDER_ALIASES.get(name.strip(), name.strip())
    if name in cache:
        return cache[name]
    st = db.scalar(select(Stakeholder).where(Stakeholder.name == name))
    if not st:
        st = Stakeholder(name=name, kind="external" if "Adviser" in name else "role", sort_order=len(cache))
        db.add(st)
        db.flush()
    cache[name] = st
    return st


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


def seed_project(db: Session) -> None:
    if db.scalar(select(func.count(Project.id))):
        return
    pp = parse_project_workbook()
    cache: dict[str, Stakeholder] = {}
    for name in pp["owners"]:
        if name != "Assigned Work-Package Owners":
            stakeholder(db, name, cache)
    for note in pp["role_notes"]:
        st = stakeholder(db, note["role"], cache)
        if st and not st.description:
            st.description = note["note"]

    ov = {f["field"]: f["value"] for f in pp["overview"]}
    from datetime import date

    def d(v):
        return date.fromisoformat(v) if isinstance(v, str) and re.match(r"\d{4}-\d{2}-\d{2}", v) else None

    project = Project(
        name=ov.get("Project Name") or "NIS2 Group Implementation Project",
        code="NIS2",
        status="In Progress",
        planned_start=d(ov.get("Planned Start")),
        planned_finish=d(ov.get("Planned Completion")),
        sponsor=ov.get("Project Sponsor"),
        description="Group-wide implementation of the NIS2 requirements (Germany and the Netherlands).",
        overview=[
            f
            for f in pp["overview"]
            if f["field"] not in ("Project Name", "Planned Start", "Planned Completion", "Project Sponsor")
        ],
        version_note="Version 1.0 | Status: Draft | Classification: Internal use | Document owner: Information Security Officer",
    )
    db.add(project)
    db.flush()
    phases = {}
    for i, name in enumerate(pp["phases"]):
        ph = Phase(project_id=project.id, name=name, sort_order=i)
        db.add(ph)
        phases[name] = ph
    gates = {}
    for i, g in enumerate(pp["gates"]):
        owner = stakeholder(db, g["decision_owner"], cache)
        gate = Gate(
            project_id=project.id,
            code=g["code"],
            planned_date=g["planned_date"],
            decision=g["decision"],
            decision_owner_id=owner.id if owner else None,
            required_input=g["required_input"],
            approval_criterion=g["approval_criterion"],
            status=g["status"],
            decision_reference=g["decision_reference"],
            sort_order=i,
        )
        db.add(gate)
        gates[g["code"]] = gate
    db.flush()
    acts = {}
    for i, a in enumerate(pp["activities"]):
        owner = stakeholder(db, a["owner"], cache)
        act = Activity(
            project_id=project.id,
            phase_id=phases[a["phase"]].id if a["phase"] in phases else None,
            code=a["code"],
            title=a["title"],
            owner_id=owner.id if owner else None,
            support=a["support"],
            planned_start=a["planned_start"],
            planned_finish=a["planned_finish"],
            deliverable=a["deliverable"],
            gate_id=gates[a["gate"]].id if a["gate"] in gates else None,
            status=a["status"],
            priority=a["priority"],
            progress=a["progress"],
            sort_order=i,
            is_milestone=bool(a["gate"]),
        )
        db.add(act)
        acts[a["code"]] = (act, a["dependency"])
    db.flush()
    for act, dep in acts.values():
        for code in re.findall(r"P\d+\.\d+", dep or ""):
            if code in acts and acts[code][0] is not act:
                act.depends_on.append(acts[code][0])

    cols = []
    for i, name in enumerate(pp["raci_columns"]):
        st = stakeholder(db, name, cache)
        col = RaciColumn(project_id=project.id, name=name, stakeholder_id=st.id if st else None, sort_order=i)
        db.add(col)
        cols.append(col)
    db.flush()
    for i, row in enumerate(pp["raci_rows"]):
        ra = RaciActivity(project_id=project.id, name=row["activity"], sort_order=i)
        db.add(ra)
        db.flush()
        for col in cols:
            v = row["cells"].get(col.name)
            if v:
                db.add(RaciCell(activity_id=ra.id, column_id=col.id, value=v))
    for r in pp["raid"]:
        owner = stakeholder(db, r["owner"], cache)
        db.add(
            RaidRecord(
                project_id=project.id,
                code=r["code"],
                type=r["type"],
                date_raised=r["date_raised"],
                title=r["title"],
                impact=r["impact"],
                probability=r["probability"],
                severity=r["severity"],
                owner_id=owner.id if owner else None,
                mitigation=r["mitigation"],
                target_date=r["target_date"],
                status=r["status"],
                escalation_needed=r["escalation_needed"],
                resolution=r["resolution"],
            )
        )
    for i, w in enumerate(pp["work_packages"], 1):
        owner = stakeholder(db, w["owner"], cache)
        db.add(
            WorkPackage(
                project_id=project.id,
                code=f"WP-{i:03d}",
                title=w["title"],
                measure_area=w["measure_area"],
                central_or_local=w["central_or_local"],
                priority=w["priority"],
                owner_stakeholder_id=owner.id if owner else None,
                planned_start=w["planned_start"],
                planned_finish=w["planned_finish"],
                acceptance_criterion=w["acceptance_criterion"],
                expected_evidence=w["expected_evidence"],
                dependency=w["dependency"],
                status=w["status"],
                progress=w["progress"],
                progress_mode="manual",
                comments=w["comments"],
            )
        )
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
        bootstrap_admin(db)
        seed_catalog_and_assessments(db)
        seed_project(db)
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
