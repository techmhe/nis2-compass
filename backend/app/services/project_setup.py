"""Builds the implementation project in the database from the plan workbook template and a computed schedule.

The structure (phases, activities, gates, dependencies, RACI rows, RAID record) comes from the workbook; dates come
from `project_plan.schedule`; owners and RACI columns follow the project roles chosen in the first-run setup.
Nothing here commits: the caller owns the transaction.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.jurisdictions import get_jurisdiction
from app.models import (
    Activity,
    Entity,
    Gate,
    Phase,
    Project,
    RaciActivity,
    RaciCell,
    RaciColumn,
    RaidRecord,
    Stakeholder,
    User,
)
from app.services.project_plan import PlanInputs, Schedule, schedule
from app.services.workbook import parse_project_workbook

ISO, BOARD, STEERING = "Information Security Officer", "Management Board", "Steering Committee"
MANDATORY = (ISO, BOARD)
EXCLUDED_ROLES = ("Local Contact",)  # a per-company contact, not a project role
ADVISER_COUNTRY = {"German External Adviser": "DE", "Dutch External Adviser": "NL"}
DEFAULT_NAME = "NIS2 Implementation"
STEERING_MEMBERS = (BOARD, "IT Coordinator", "Data Protection Officer")
# Template owners that are no stakeholder of the plan itself
_NOT_A_ROLE = "Assigned Work-Package Owners"

# Roles the workbook's role notes do not describe
EXTRA_NOTES = {
    STEERING: "Reviews the high-priority implementation at Gate 4; members: Management Board, IT Coordinator "
    "and Data Protection Officer",
    "Local IT / MSP": "Local IT staff or the managed service provider acting for a subsidiary",
}

STAKEHOLDER_ALIASES = {
    "DPO": "Data Protection Officer",
    "DE Adviser": "German External Adviser",
    "NL Adviser": "Dutch External Adviser",
    "MSP": "MSP+IT",
}


@dataclass(frozen=True)
class RoleChoice:
    name: str
    rename_to: str | None = None
    selected: bool = True
    email: str | None = None
    custom: bool = False


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


def link_stakeholders(db: Session, user: User, email: str) -> int:
    """Link active, unlinked stakeholders with this e-mail (case-insensitive) to the user; returns the count.

    Ties a person to project roles only; it never touches role assignments or permissions.
    """
    if not email:
        return 0
    rows = db.scalars(
        select(Stakeholder).where(
            func.lower(Stakeholder.email) == email.strip().lower(),
            Stakeholder.user_id.is_(None),
            Stakeholder.is_active.is_(True),
        )
    ).all()
    for st in rows:
        st.user_id = user.id
    return len(rows)


def seed_project_stakeholders(db: Session) -> None:
    """The plan workbook's owners, RACI column roles and role notes, plus the Steering Committee."""
    pp = parse_project_workbook()
    cache: dict[str, Stakeholder] = {}
    for name in pp["owners"]:
        if name != _NOT_A_ROLE:
            stakeholder(db, name, cache)
    for name in pp["raci_columns"]:
        stakeholder(db, name, cache)
    for g in pp["gates"]:
        stakeholder(db, g["decision_owner"], cache)
    for note in pp["role_notes"]:
        st = stakeholder(db, note["role"], cache)
        if st and not st.description:
            st.description = note["note"]
    for name, note in EXTRA_NOTES.items():
        if (st := stakeholder(db, name, cache)) and not st.description:
            st.description = note
    db.flush()


def _offered(db: Session) -> list[Stakeholder]:
    return list(
        db.scalars(
            select(Stakeholder)
            .where(
                Stakeholder.kind.in_(("role", "external")),
                Stakeholder.is_active.is_(True),
                Stakeholder.name.notin_(EXCLUDED_ROLES),
            )
            .order_by(Stakeholder.sort_order, Stakeholder.id)
        )
    )


def offered_roles(db: Session, countries: set[str]) -> list[dict]:
    out = []
    for st in _offered(db):
        country = ADVISER_COUNTRY.get(st.name)
        if country and country not in countries:
            continue
        out.append(
            {
                "name": st.name,
                "description": st.description,
                "kind": st.kind,
                "mandatory": st.name in MANDATORY,
                "country": country,
            }
        )
    return out


def template_role_names() -> set[str]:
    """Lower-cased names create_project resolves or creates as stakeholders, whether or not they exist yet."""
    pp = parse_project_workbook()
    names = (
        [ISO, BOARD]
        + pp["owners"]
        + pp["raci_columns"]
        + [g["decision_owner"] for g in pp["gates"]]
        + [a["owner"] for a in pp["activities"]]
        + [r["owner"] for r in pp["raid"]]
    )
    return {STAKEHOLDER_ALIASES.get(n.strip(), n.strip()).lower() for n in names if n}


def _apply_roles(
    db: Session, roles: list[RoleChoice], admin: User | None, offered: list[Stakeholder]
) -> None:
    """Rename, activate/deactivate and add roles; offered stakeholders not listed are deactivated."""
    universe = {st.name.lower(): st for st in offered}
    wanted = [r.name.lower() for r in roles if not r.custom]
    # All looked up by their current name before the first rename, so chained or swapped renames resolve
    existing = {
        st.name.lower(): st
        for st in db.scalars(select(Stakeholder).where(func.lower(Stakeholder.name).in_(wanted)))
    }
    renames: list[tuple[Stakeholder, str]] = []
    touched: list[tuple[Stakeholder, RoleChoice]] = []
    for r in roles:
        selected = r.selected or r.name in MANDATORY
        st = None if r.custom else existing.get(r.name.lower())
        if st is None:
            continue
        if r.rename_to and r.name not in MANDATORY:
            renames.append((st, r.rename_to.strip()))
        st.is_active = selected
        touched.append((st, r))
    for key, st in universe.items():
        if key not in wanted:
            st.is_active = False
    # Two phases: a name another row still holds (Central IT -> Local IT, Local IT -> Site IT) must be free first
    for st, _ in renames:
        st.name = f"~renaming {st.id}"
    db.flush()
    for st, new in renames:
        st.name = new
    db.flush()
    position = len(universe) + len(existing)
    for r in roles:
        if r.custom and (r.selected or r.name in MANDATORY):
            st = Stakeholder(name=(r.rename_to or r.name).strip(), kind="role", sort_order=position)
            position += 1
            db.add(st)
            touched.append((st, r))
    for st, r in touched:
        if (r.selected or r.name in MANDATORY) and r.email:
            st.email = r.email
            if admin and r.email.lower() == admin.email.lower():
                st.user_id = admin.id
    db.flush()


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _country_names(entities: list[Entity]) -> list[str]:
    names: list[str] = []
    for e in entities:
        jur = get_jurisdiction(e.country)
        name = jur.name if jur else e.country
        if name == "Netherlands":
            name = "the Netherlands"
        if name and name not in names:
            names.append(name)
    return names


def _overview(
    template: list[dict], inputs: PlanInputs, entities: list[Entity], steering: list[str]
) -> list[dict]:
    countries = _country_names(entities)
    hq = next((e for e in entities if e.is_headquarters), entities[0] if entities else None)
    if not hq:
        geographic = "HQ and all subsidiaries"
    elif len(entities) == 1:
        geographic = hq.name
    else:
        subs = len(entities) - 1
        geographic = f"{hq.name} and {subs} {'subsidiary' if subs == 1 else 'subsidiaries'}"
    regulatory = "NIS2 implementation and related national requirements"
    if countries:
        regulatory += " in " + _join(countries)
    order = "one after another" if inputs.assessment == "sequential" else "in parallel"
    values = {
        "Project Manager": ISO,
        "Steering Committee": "; ".join(steering),
        "Geographic Scope": geographic,
        "Regulatory Scope": regulatory,
        "Delivery Model": "Part-time project alongside normal operations"
        if inputs.capacity == "part_time"
        else "Dedicated core team",
        "Assessment Model": "Remote assessments; one full pass over all 174 requirements per entity; "
        f"entities assessed {order}",
        "Planning Assumption": "Detailed remediation work packages are created after the GAP assessments "
        "and management approval (Gate 3).",
    }
    return [
        {"field": f["field"], "value": values.get(f["field"], f["value"])}
        for f in template
        if f["field"] not in ("Project Name", "Planned Start", "Planned Completion", "Project Sponsor")
    ]


def _fall_back_accountable(cells: dict[str, str | None], dropped: set[str]) -> dict[str, str | None]:
    """Move an accountable out of a dropped column to the Information Security Officer's cell."""
    if not any(cells.get(c) in ("A", "A/R") for c in dropped):
        return cells
    cells = dict(cells)
    if cells.get(ISO) not in ("A", "A/R"):
        cells[ISO] = "A/R" if cells.get(ISO) == "R" else "A"
    return cells


def create_project(
    db: Session,
    inputs: PlanInputs,
    sched: Schedule,
    *,
    name: str,
    roles: list[RoleChoice] | None,
    gate_overrides: dict[str, date],
    entities: list[Entity],
    admin: User | None,
) -> Project:
    pp = parse_project_workbook()
    offered = _offered(db)
    # Resolved by template name before any rename could change what the name lookup finds
    cache: dict[str, Stakeholder] = {}
    for n in (
        [ISO, BOARD]
        + pp["owners"]
        + pp["raci_columns"]
        + [g["decision_owner"] for g in pp["gates"]]
        + [a["owner"] for a in pp["activities"]]
        + [r["owner"] for r in pp["raid"]]
    ):
        stakeholder(db, n, cache)
    if roles is not None:
        _apply_roles(db, roles, admin, offered)

    def owner(template_name: str | None, fallback: str) -> Stakeholder | None:
        st = stakeholder(db, template_name, cache)
        return st if st is None or st.is_active else cache[fallback]

    def final_name(template_name: str) -> str:
        return cache[template_name].name

    steering = [final_name(n) for n in STEERING_MEMBERS if cache[n].is_active]
    last_finish = max(s.finish for s in sched.activities.values())
    project = Project(
        name=name,
        code="NIS2",
        status="In Progress",
        planned_start=inputs.start,
        planned_finish=last_finish,
        sponsor=BOARD,
        description="Group-wide implementation of the NIS2 requirements"
        + (f" ({_join(_country_names(entities))})." if entities and _country_names(entities) else "."),
        overview=_overview(pp["overview"], inputs, entities, steering),
        version_note="Version 1.0 | Status: Draft | Classification: Internal use | Document owner: "
        "Information Security Officer",
    )
    db.add(project)
    db.flush()
    phases = {}
    for i, phase in enumerate(pp["phases"]):
        ph = Phase(project_id=project.id, name=phase, sort_order=i)
        db.add(ph)
        phases[phase] = ph
    gates = {}
    for i, g in enumerate(pp["gates"]):
        decider = owner(g["decision_owner"], BOARD)
        gate = Gate(
            project_id=project.id,
            code=g["code"],
            planned_date=gate_overrides.get(g["code"], sched.gates.get(g["code"])),
            decision=g["decision"],
            decision_owner_id=decider.id if decider else None,
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
        responsible = owner(a["owner"], ISO)
        slot = sched.activities[a["code"]]
        act = Activity(
            project_id=project.id,
            phase_id=phases[a["phase"]].id if a["phase"] in phases else None,
            code=a["code"],
            title=a["title"],
            owner_id=responsible.id if responsible else None,
            support=a["support"],
            planned_start=slot.start,
            planned_finish=slot.finish,
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

    cols: dict[str, RaciColumn] = {}
    dropped: set[str] = set()
    for header in pp["raci_columns"]:
        st = stakeholder(db, header, cache)
        if st and not st.is_active:
            dropped.add(header)
            continue
        canonical = STAKEHOLDER_ALIASES.get(header, header)
        column_name = st.name if st and st.name != canonical else header
        col = RaciColumn(
            project_id=project.id,
            name=column_name,
            stakeholder_id=st.id if st else None,
            sort_order=len(cols),
        )
        db.add(col)
        cols[header] = col
    db.flush()
    for i, row in enumerate(pp["raci_rows"]):
        ra = RaciActivity(project_id=project.id, name=row["activity"], sort_order=i)
        db.add(ra)
        db.flush()
        cells = _fall_back_accountable(row["cells"], dropped)
        for header, col in cols.items():
            if v := cells.get(header):
                db.add(RaciCell(activity_id=ra.id, column_id=col.id, value=v))
    for r in pp["raid"]:
        responsible = owner(r["owner"], ISO)
        lag = (r["target_date"] - r["date_raised"]).days if r["target_date"] and r["date_raised"] else None
        db.add(
            RaidRecord(
                project_id=project.id,
                code=r["code"],
                type=r["type"],
                date_raised=inputs.start,
                title=r["title"],
                impact=r["impact"],
                probability=r["probability"],
                severity=r["severity"],
                owner_id=responsible.id if responsible else None,
                mitigation=r["mitigation"],
                target_date=inputs.start + timedelta(days=lag) if lag is not None else None,
                status=r["status"],
                escalation_needed=r["escalation_needed"],
                resolution=r["resolution"],
            )
        )
    db.flush()
    return project


def create_default_project(db: Session, entities: list[Entity]) -> Project:
    """Spec req. 18: the plan a seed run creates, starting on the Monday of the current week."""
    today = date.today()
    inputs = PlanInputs(
        start=today - timedelta(days=today.weekday()),
        end=None,
        capacity="part_time",
        assessment="parallel",
        starting_point="partial",
        external_support=False,
        companies=max(len(entities), 1),
    )
    return create_project(
        db,
        inputs,
        schedule(inputs),
        name=DEFAULT_NAME,
        roles=None,
        gate_overrides={},
        entities=entities,
        admin=None,
    )
