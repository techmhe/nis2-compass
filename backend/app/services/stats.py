"""Dashboard statistics mirroring the GAP and project workbook dashboards."""

from collections import defaultdict
from datetime import date, timedelta
from statistics import mean

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    ActionItem,
    Activity,
    Answer,
    Assessment,
    Chapter,
    Gate,
    RaidRecord,
    Requirement,
    WorkPackage,
)
from app.services.scoring import due_status, raid_due_status, schedule_status


def _avg(values):
    vals = [v for v in values if v is not None]
    return mean(vals) if vals else None


def assessment_stats(answers: list[Answer]) -> dict:
    in_scope = [a for a in answers if a.scope == "In Scope"]
    assessed = [a for a in in_scope if a.implemented]
    dist = {"Yes": 0, "Partial": 0, "No": 0}
    for a in in_scope:
        if a.implemented in dist:
            dist[a.implemented] += 1
    return {
        "total": len(answers),
        "in_scope": len(in_scope),
        "central_at_hq": sum(1 for a in answers if a.scope == "Central at HQ"),
        "not_applicable": sum(1 for a in answers if a.scope == "Not Applicable"),
        "assessed": len(assessed),
        "coverage": (len(assessed) / len(in_scope)) if in_scope else None,
        "average_score": _avg(a.score for a in answers),
        "work_packages": sum(1 for a in answers if a.wp_required),
        "no_answers": sum(1 for a in answers if a.implemented == "No")
        + sum(1 for a in answers if a.documented == "No"),
        "not_tested": sum(1 for a in answers if a.effectiveness == "Not Tested"),
        "answer_distribution": {**dist, "Not assessed": len(in_scope) - sum(dist.values())},
        "reviewed": sum(1 for a in answers if a.review_status == "reviewed"),
        "core_total": sum(1 for a in in_scope if a.requirement.is_core),
        "core_assessed": sum(1 for a in assessed if a.requirement.is_core),
    }


def chapter_scores(answers: list[Answer]) -> dict[int, dict]:
    by_ch: dict[int, list[Answer]] = defaultdict(list)
    for a in answers:
        by_ch[a.requirement.chapter.number].append(a)
    return {
        ch: {
            "average": _avg(a.score for a in rows),
            "work_packages": sum(1 for a in rows if a.wp_required),
            "assessed": sum(1 for a in rows if a.scope == "In Scope" and a.implemented),
            "in_scope": sum(1 for a in rows if a.scope == "In Scope"),
        }
        for ch, rows in by_ch.items()
    }


def gap_dashboard(
    db: Session, round_id: int, entity_ids: set[int] | None, with_action_plan: bool = True
) -> dict:
    q = select(Assessment).where(Assessment.round_id == round_id).options(selectinload(Assessment.entity))
    if entity_ids is not None:
        q = q.where(Assessment.entity_id.in_(entity_ids))
    assessments = sorted(db.scalars(q).all(), key=lambda a: a.entity.sort_order)
    answers_by_asm: dict[int, list[Answer]] = {a.id: [] for a in assessments}
    if assessments:
        for ans in db.scalars(select(Answer).where(Answer.assessment_id.in_(answers_by_asm))):
            answers_by_asm[ans.assessment_id].append(ans)
    chapters = db.scalars(select(Chapter).order_by(Chapter.number)).all()
    per_entity = []
    chapter_matrix: dict[int, dict] = {
        c.number: {
            "chapter": c.number,
            "title": c.title,
            "target": c.target,
            "entities": {},
            "work_packages": 0,
        }
        for c in chapters
    }
    all_answers: list[Answer] = []
    for asm in assessments:
        answers = answers_by_asm[asm.id]
        all_answers += answers
        st = assessment_stats(answers)
        per_entity.append(
            {
                "assessment_id": asm.id,
                "entity": {"id": asm.entity.id, "code": asm.entity.code, "name": asm.entity.name},
                "status": asm.status,
                **st,
            }
        )
        for ch, v in chapter_scores(answers).items():
            chapter_matrix[ch]["entities"][asm.entity.code] = v["average"]
            chapter_matrix[ch]["work_packages"] += v["work_packages"]
    rows = []
    for ch in chapter_matrix.values():
        group = _avg(ch["entities"].values())
        ch["group_average"] = group
        ch["gap_to_target"] = None if group is None else max(0.0, ch["target"] - group)
        rows.append(ch)
    totals = {
        "in_scope": sum(e["in_scope"] for e in per_entity),
        "assessed": sum(e["assessed"] for e in per_entity),
        "work_packages": sum(e["work_packages"] for e in per_entity),
        "no_answers": sum(e["no_answers"] for e in per_entity),
        "not_tested": sum(e["not_tested"] for e in per_entity),
        "average_score": _avg(e["average_score"] for e in per_entity),
    }
    totals["coverage"] = totals["assessed"] / totals["in_scope"] if totals["in_scope"] else None

    result = {
        "round_id": round_id,
        "entities": per_entity,
        "totals": totals,
        "chapters": rows,
        "requirements_per_entity": db.query(Requirement).filter(Requirement.is_active.is_(True)).count(),
    }
    if not with_action_plan:
        return result

    # action plan indicators (the action plan spans rounds: items are keyed by entity and requirement)
    q = select(ActionItem)
    if entity_ids is not None:
        q = q.where(ActionItem.entity_id.in_(entity_ids))
    items = db.scalars(q).all()
    today = date.today()
    planned = {(i.entity_id, i.requirement_id) for i in items}
    unplanned = sum(
        1 for a in all_answers if a.wp_required and (a.assessment.entity_id, a.requirement_id) not in planned
    )
    ap = {
        "total": len(items),
        "by_priority": {p: sum(1 for i in items if i.priority == p) for p in ("High", "Medium", "Low")},
        "by_status": {
            s: sum(1 for i in items if i.status == s)
            for s in ("Not Started", "In Progress", "Completed", "Blocked", "Deferred")
        },
        "overdue": sum(1 for i in items if due_status(i.target_date, i.status, today) == "Overdue"),
        "due_soon": sum(1 for i in items if due_status(i.target_date, i.status, today) == "Due soon"),
        "unplanned_findings": unplanned,
    }
    return {**result, "action_plan": ap}


def project_dashboard(db: Session, project_id: int, entity_ids: set[int] | None = None) -> dict:
    """Master plan, gates, work packages and RAID of a project; work packages of entities outside `entity_ids`
    (None = all) are not counted (master plan and RAID are project-level)."""
    today = date.today()
    acts = db.scalars(
        select(Activity).where(Activity.project_id == project_id).order_by(Activity.sort_order)
    ).all()
    sched = [schedule_status(a.planned_start, a.planned_finish, a.status, today) for a in acts]
    phases: dict[str, dict] = {}
    for a, s in zip(acts, sched, strict=True):
        name = a.phase.name if a.phase else "Unassigned"
        ph = phases.setdefault(
            name,
            {
                "phase": name,
                "activities": 0,
                "completed": 0,
                "progress": [],
                "overdue": 0,
                "sort": a.phase.sort_order if a.phase else 99,
            },
        )
        ph["activities"] += 1
        ph["completed"] += a.status == "Completed"
        ph["progress"].append(a.progress or 0)
        ph["overdue"] += s == "Red"
    phase_rows = sorted(phases.values(), key=lambda p: p["sort"])
    for p in phase_rows:
        p["progress"] = mean(p["progress"]) if p["progress"] else 0
    gates = db.scalars(select(Gate).where(Gate.project_id == project_id).order_by(Gate.sort_order)).all()
    gate_rows = []
    for g in gates:
        related = [a for a in acts if a.gate_id == g.id]
        gate_rows.append(
            {
                "id": g.id,
                "code": g.code,
                "planned_date": g.planned_date,
                "status": g.status,
                "decision": g.decision,
                "activities": len(related),
                "open_activities": sum(1 for a in related if a.status != "Completed"),
                "days_to_gate": (g.planned_date - today).days if g.planned_date else None,
                "overdue": bool(g.planned_date and g.planned_date < today and g.status != "Completed"),
            }
        )
    wps = [
        w
        for w in db.scalars(select(WorkPackage).where(WorkPackage.project_id == project_id))
        if entity_ids is None or w.entity_id is None or w.entity_id in entity_ids
    ]
    raid = db.scalars(select(RaidRecord).where(RaidRecord.project_id == project_id)).all()
    return {
        "activities": {
            "total": len(acts),
            "completed": sum(a.status == "Completed" for a in acts),
            "in_progress": sum(a.status == "In Progress" for a in acts),
            "blocked": sum(a.status == "Blocked" for a in acts),
            "overall_progress": mean([a.progress or 0 for a in acts]) if acts else 0,
            "green": sched.count("Green"),
            "amber": sched.count("Amber"),
            "red": sched.count("Red"),
            "not_planned": sched.count("Not Planned"),
            "finishing_next_30_days": sum(
                1
                for a in acts
                if a.planned_finish and today <= a.planned_finish <= today + timedelta(days=30)
            ),
        },
        "phases": phase_rows,
        "gates": gate_rows,
        "work_packages": {
            "total": len(wps),
            "by_status": {
                s: sum(1 for w in wps if w.status == s)
                for s in ("Not Started", "In Progress", "Completed", "Blocked", "Deferred", "Cancelled")
            },
            "high_priority_open": sum(1 for w in wps if w.priority == "High" and w.status != "Completed"),
            "overdue": sum(
                1 for w in wps if schedule_status(w.planned_start, w.planned_finish, w.status, today) == "Red"
            ),
        },
        "raid": {
            "open_risks": sum(1 for r in raid if r.type == "Risk" and r.status not in ("Closed", "Accepted")),
            "open_issues": sum(
                1 for r in raid if r.type == "Issue" and r.status not in ("Closed", "Accepted")
            ),
            "decisions": sum(1 for r in raid if r.type == "Decision"),
            "high_severity_open": sum(
                1 for r in raid if r.severity == "High" and r.status not in ("Closed", "Accepted")
            ),
            "escalations": sum(
                1 for r in raid if r.escalation_needed and r.status not in ("Closed", "Accepted")
            ),
            "overdue": sum(1 for r in raid if raid_due_status(r.target_date, r.status, today) == "Overdue"),
        },
    }
