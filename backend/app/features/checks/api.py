"""Consistency checks: plausibility rules over the whole data set with deep links to fix each finding.

Checks are computed on request (cheap for the data volumes of a company group) and always filtered by the
caller's permissions. Other modules can add rules through `register_rule`.
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import Principal, get_principal
from app.db import get_db
from app.models import (
    ActionItem,
    Activity,
    Answer,
    Assessment,
    AssessmentRound,
    Document,
    DocumentLink,
    Gate,
    RaciActivity,
    RaciCell,
    RaciColumn,
    Task,
    WorkPackage,
)
from app.services.scoring import due_status, schedule_status

router = APIRouter(prefix="/checks", tags=["checks"])


@dataclass
class Rule:
    code: str
    area: str
    severity: str  # high | medium | low
    title: str
    hint: str
    permission: str
    fn: Callable[[Session, Principal], Iterable[dict]]


RULES: list[Rule] = []


def register_rule(code: str, area: str, severity: str, title: str, hint: str, permission: str):
    def deco(fn):
        RULES.append(Rule(code, area, severity, title, hint, permission, fn))
        return fn

    return deco


def _current_answers(db: Session, pr: Principal):
    rnd = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    if not rnd:
        return []
    return [
        a
        for a in db.scalars(select(Answer).join(Assessment).where(Assessment.round_id == rnd))
        if pr.can("assessments.read", a.assessment.entity_id)
    ]


def _answer_item(a: Answer, message: str) -> dict:
    return {
        "label": f"{a.assessment.entity.code} {a.requirement.number} {a.requirement.section}",
        "message": message,
        "url": f"/assessments/{a.assessment_id}?req={a.requirement_id}",
        "entity_id": a.assessment.entity_id,
    }


@register_rule(
    "A1",
    "Assessment",
    "high",
    "Finding without gap description",
    "A work package is required but the gap is not described, so the action plan cannot be derived.",
    "assessments.read",
)
def _finding_without_gap(db, pr):
    for a in _current_answers(db, pr):
        if a.wp_required and not (a.gap_description or "").strip():
            yield _answer_item(a, "Describe the operational, documentation or effectiveness gap.")


@register_rule(
    "A2",
    "Assessment",
    "medium",
    "Answered without evidence",
    "Implemented or documented is 'Yes' but neither evidence text nor a linked document exists.",
    "assessments.read",
)
def _yes_without_evidence(db, pr):
    answers = _current_answers(db, pr)
    linked = set(db.scalars(select(DocumentLink.target_id).where(DocumentLink.target_type == "answer")))
    for a in answers:
        if (
            a.scope == "In Scope"
            and "Yes" in (a.implemented, a.documented)
            and not (a.evidence or "").strip()
            and a.id not in linked
        ):
            yield _answer_item(a, "Record the evidence or source, or link a document.")


@register_rule(
    "A3",
    "Assessment",
    "low",
    "Scope exclusion without reason",
    "The workbook requires the reason for 'Central at HQ' or 'Not applicable' in Evidence / Source.",
    "assessments.read",
)
def _scope_without_reason(db, pr):
    for a in _current_answers(db, pr):
        if a.scope != "In Scope" and not (a.evidence or "").strip():
            yield _answer_item(a, f"Scope is '{a.scope}' without a recorded reason.")


@register_rule(
    "A4",
    "Assessment",
    "medium",
    "Completed assessment with open questions",
    "An entity assessment is marked completed although in-scope requirements are unanswered.",
    "assessments.read",
)
def _completed_but_open(db, pr):
    rnd = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    for asm in db.scalars(
        select(Assessment).where(Assessment.round_id == rnd, Assessment.status == "completed")
    ):
        if not pr.can("assessments.read", asm.entity_id):
            continue
        n = db.scalar(
            select(func.count(Answer.id)).where(
                Answer.assessment_id == asm.id, Answer.scope == "In Scope", Answer.implemented.is_(None)
            )
        )
        if n:
            yield {
                "label": f"{asm.entity.code} {asm.round.name}",
                "message": f"{n} in-scope requirements unanswered.",
                "url": f"/assessments/{asm.id}",
                "entity_id": asm.entity_id,
            }


@register_rule(
    "F1",
    "Action plan",
    "high",
    "Finding not in the action plan for 30 days",
    "Findings should become action plan items once validated.",
    "findings.read",
)
def _stale_findings(db, pr):
    planned = {(i.entity_id, i.requirement_id) for i in db.scalars(select(ActionItem))}
    limit = date.today() - timedelta(days=30)
    for a in _current_answers(db, pr):
        if (
            a.wp_required
            and (a.assessment.entity_id, a.requirement_id) not in planned
            and a.updated_at.date() < limit
        ):
            yield _answer_item(
                a, f"Finding {a.finding_id} has no action plan item since {a.updated_at.date()}."
            )


@register_rule(
    "F2",
    "Action plan",
    "medium",
    "Action item without owner or target date",
    "Every action needs a responsible and a target date to be steerable.",
    "findings.read",
)
def _action_incomplete(db, pr):
    for i in db.scalars(select(ActionItem).where(ActionItem.status != "Completed")):
        if not pr.can("findings.read", i.entity_id):
            continue
        missing = [n for n, v in (("responsible", i.responsible_id), ("target date", i.target_date)) if not v]
        if missing:
            yield {
                "label": f"{i.code} {i.title[:80]}",
                "message": "Missing " + " and ".join(missing) + ".",
                "url": f"/action-plan?item={i.id}",
                "entity_id": i.entity_id,
            }


@register_rule(
    "F3",
    "Action plan",
    "high",
    "Overdue high-priority action",
    "High-priority actions past their target date need a recovery plan or escalation.",
    "findings.read",
)
def _overdue_high(db, pr):
    for i in db.scalars(select(ActionItem).where(ActionItem.priority == "High")):
        if pr.can("findings.read", i.entity_id) and due_status(i.target_date, i.status) == "Overdue":
            yield {
                "label": f"{i.code} {i.title[:80]}",
                "message": f"Target date {i.target_date} has passed.",
                "url": f"/action-plan?item={i.id}",
                "entity_id": i.entity_id,
            }


@register_rule(
    "F4",
    "Action plan",
    "low",
    "Completed action without evidence",
    "A work package is complete only when its expected evidence is available (planning principles).",
    "findings.read",
)
def _completed_without_evidence(db, pr):
    linked = set(db.scalars(select(DocumentLink.target_id).where(DocumentLink.target_type == "action_item")))
    for i in db.scalars(select(ActionItem).where(ActionItem.status == "Completed")):
        if pr.can("findings.read", i.entity_id) and i.id not in linked:
            yield {
                "label": f"{i.code} {i.title[:80]}",
                "message": "No evidence document is linked.",
                "url": f"/action-plan?item={i.id}",
                "entity_id": i.entity_id,
            }


@register_rule(
    "P1",
    "Project",
    "medium",
    "Activity past planned finish",
    "Master plan activities past their finish date need a status update or re-planning.",
    "projects.read",
)
def _late_activities(db, pr):
    for a in db.scalars(select(Activity)):
        if schedule_status(a.planned_start, a.planned_finish, a.status) == "Red":
            yield {
                "label": f"{a.code} {a.title}",
                "message": f"Planned finish {a.planned_finish}, status {a.status}.",
                "url": f"/projects/{a.project_id}/plan?activity={a.id}",
                "entity_id": None,
            }


@register_rule(
    "P2",
    "Project",
    "high",
    "Gate date passed without decision",
    "Management gates past their planned date should be decided or re-scheduled.",
    "projects.read",
)
def _late_gates(db, pr):
    for g in db.scalars(select(Gate).where(Gate.status != "Completed")):
        if g.planned_date and g.planned_date < date.today():
            yield {
                "label": f"{g.code} {g.decision or ''}",
                "message": f"Planned for {g.planned_date}.",
                "url": f"/projects/{g.project_id}/gates",
                "entity_id": None,
            }


@register_rule(
    "P3",
    "Project",
    "medium",
    "RACI row without exactly one accountable",
    "Each activity in the RACI matrix needs exactly one 'A' (or 'A/R').",
    "projects.read",
)
def _raci(db, pr):
    for ra in db.scalars(select(RaciActivity)):
        n = db.scalar(
            select(func.count(RaciCell.id))
            .join(RaciColumn, RaciColumn.id == RaciCell.column_id)
            .where(RaciCell.activity_id == ra.id, RaciCell.value.in_(["A", "A/R"]))
        )
        if n != 1:
            yield {
                "label": ra.name,
                "message": f"{n} accountable roles.",
                "url": f"/projects/{ra.project_id}/raci",
                "entity_id": None,
            }


@register_rule(
    "P4",
    "Project",
    "low",
    "Work package without owner",
    "Work packages need an owner who reports progress.",
    "workpackages.read",
)
def _wp_owner(db, pr):
    for w in db.scalars(select(WorkPackage).where(WorkPackage.status.not_in(["Completed", "Cancelled"]))):
        if pr.can_read("workpackages.read", w.entity_id) and not (w.owner_id or w.owner_stakeholder_id):
            yield {
                "label": f"{w.code} {w.title[:80]}",
                "message": "No owner assigned.",
                "url": f"/work-packages/{w.id}",
                "entity_id": w.entity_id,
            }


@register_rule(
    "T1",
    "Tasks",
    "low",
    "Overdue tasks without assignee",
    "Unassigned overdue tasks are likely forgotten.",
    "tasks.read",
)
def _unassigned_tasks(db, pr):
    for t in db.scalars(
        select(Task).where(Task.status != "done", Task.assignee_id.is_(None), Task.due_date < date.today())
    ):
        if pr.can_read("tasks.read", t.entity_id):
            yield {
                "label": f"{t.key} {t.title}",
                "message": f"Due {t.due_date}, nobody assigned.",
                "url": f"/tasks?task={t.id}",
                "entity_id": t.entity_id,
            }


@register_rule(
    "D1",
    "Documents",
    "medium",
    "Document review overdue",
    "Policies must be reviewed at least annually and after significant changes (IR 2024/2690 1.1.2).",
    "documents.read",
)
def _review_overdue(db, pr):
    from app.api.util import can_see_document

    for d in db.scalars(
        select(Document).where(Document.status != "Retired", Document.next_review_date < date.today())
    ):
        if can_see_document(pr, d):
            yield {
                "label": d.title,
                "message": f"Review was due {d.next_review_date}.",
                "url": f"/documents/{d.id}",
                "entity_id": d.entity_id,
            }


@register_rule(
    "D2",
    "Documents",
    "medium",
    "Approved policy without review date",
    "Approved policies and procedures need a next review date.",
    "documents.read",
)
def _no_review_date(db, pr):
    from app.api.util import can_see_document

    for d in db.scalars(
        select(Document).where(
            Document.status == "Approved",
            Document.next_review_date.is_(None),
            Document.doc_type.in_(["Policy", "Guideline", "Procedure", "Standard"]),
        )
    ):
        if can_see_document(pr, d):
            yield {
                "label": d.title,
                "message": "No next review date set.",
                "url": f"/documents/{d.id}",
                "entity_id": d.entity_id,
            }


@register_rule(
    "S1",
    "Suppliers",
    "medium",
    "Central-at-HQ controls without intra-group service agreement",
    "Subsidiaries without an IT department rely on HQ; record HQ as intra-group provider (category "
    "'Intra-group IT service') with the service agreement as documented arrangement (IR 2024/2690 5.1).",
    "assessments.read",
)
def _intragroup_agreement(db, pr):
    try:
        from app.features.suppliers.models import Supplier, supplier_entities
    except ImportError:
        return
    rnd = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    covered = set(
        db.scalars(
            select(supplier_entities.c.entity_id)
            .join(Supplier, Supplier.id == supplier_entities.c.supplier_id)
            .where(Supplier.category.ilike("intra-group%"), Supplier.status != "offboarded")
        )
    )
    rows = db.execute(
        select(Assessment.entity_id, func.count(Answer.id))
        .join(Answer, Answer.assessment_id == Assessment.id)
        .where(Assessment.round_id == rnd, Answer.scope == "Central at HQ")
        .group_by(Assessment.entity_id)
    ).all()
    from app.models import Entity

    for entity_id, n in rows:
        if entity_id in covered or not pr.can("assessments.read", entity_id):
            continue
        e = db.get(Entity, entity_id)
        yield {
            "label": f"{e.code} {e.name}",
            "message": f"{n} requirements are operated centrally by HQ, but no "
            "intra-group service agreement is recorded.",
            "url": "/suppliers",
            "entity_id": entity_id,
        }


@router.get("")
def run_checks(pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    results = []
    for rule in RULES:
        if not pr.has_any(rule.permission):
            continue
        items = list(rule.fn(db, pr))
        results.append(
            {
                "code": rule.code,
                "area": rule.area,
                "severity": rule.severity,
                "title": rule.title,
                "hint": rule.hint,
                "count": len(items),
                "items": items[:200],
            }
        )
    order = {"high": 0, "medium": 1, "low": 2}
    results.sort(key=lambda r: (r["count"] == 0, order[r["severity"]], r["code"]))
    return {"rules": results, "total": sum(r["count"] for r in results)}
