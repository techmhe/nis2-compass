from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import Principal, get_principal, require
from app.db import get_db
from app.models import (
    ActionItem,
    Activity,
    AssessmentRound,
    Document,
    Gate,
    Incident,
    Project,
    Task,
)
from app.services.stats import gap_dashboard, project_dashboard

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/gap")
def gap(
    round_id: int | None = None,
    pr: Principal = Depends(require("assessments.read")),
    db: Session = Depends(get_db),
):
    if round_id is None:
        round_id = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    return gap_dashboard(db, round_id, pr.entity_scope("assessments.read"))


@router.get("/gap/trend")
def gap_trend(pr: Principal = Depends(require("assessments.read")), db: Session = Depends(get_db)):
    """Average score per entity for every round (progress over assessment rounds)."""
    out = []
    scope = pr.entity_scope("assessments.read")
    for rnd in db.scalars(select(AssessmentRound).order_by(AssessmentRound.id)):
        d = gap_dashboard(db, rnd.id, scope, with_action_plan=False)
        out.append(
            {
                "round_id": rnd.id,
                "round": rnd.name,
                "group_average": d["totals"]["average_score"],
                "coverage": d["totals"]["coverage"],
                "entities": {e["entity"]["code"]: e["average_score"] for e in d["entities"]},
            }
        )
    return out


@router.get("/project/{project_id}")
def project(
    project_id: int, pr: Principal = Depends(require("projects.read")), db: Session = Depends(get_db)
):
    return project_dashboard(db, project_id, pr.entity_scope("projects.read"))


@router.get("/home")
def home(pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Compact overview for the landing page, limited to what the user may see."""
    today = date.today()
    out: dict = {}
    if pr.has_any("assessments.read"):
        rnd = db.scalar(select(AssessmentRound).where(AssessmentRound.is_current.is_(True)))
        if rnd:
            g = gap_dashboard(db, rnd.id, pr.entity_scope("assessments.read"))
            out["gap"] = {
                "round": rnd.name,
                "round_id": rnd.id,
                "totals": g["totals"],
                "entities": [
                    {
                        "code": e["entity"]["code"],
                        "name": e["entity"]["name"],
                        "assessment_id": e["assessment_id"],
                        "coverage": e["coverage"],
                        "average_score": e["average_score"],
                        "work_packages": e["work_packages"],
                        "status": e["status"],
                    }
                    for e in g["entities"]
                ],
                "chapters": [
                    {
                        "chapter": c["chapter"],
                        "title": c["title"],
                        "target": c["target"],
                        "group_average": c["group_average"],
                        "gap_to_target": c["gap_to_target"],
                    }
                    for c in g["chapters"]
                ],
                "action_plan": g["action_plan"],
            }
    if pr.has_any("projects.read"):
        p = db.scalar(select(Project).order_by(Project.id))
        if p:
            pd = project_dashboard(db, p.id, pr.entity_scope("projects.read"))
            nxt = db.scalar(
                select(Gate)
                .where(Gate.project_id == p.id, Gate.status != "Completed")
                .order_by(Gate.planned_date)
            )
            upcoming = db.scalars(
                select(Activity)
                .where(
                    Activity.project_id == p.id,
                    Activity.status != "Completed",
                    Activity.planned_finish >= today,
                    Activity.planned_finish <= today + timedelta(days=30),
                )
                .order_by(Activity.planned_finish)
                .limit(8)
            ).all()
            out["project"] = {
                "id": p.id,
                "name": p.name,
                "planned_finish": p.planned_finish,
                "activities": pd["activities"],
                "raid": pd["raid"],
                "work_packages": pd["work_packages"],
                "phases": pd["phases"],
                "next_gate": {
                    "id": nxt.id,
                    "code": nxt.code,
                    "planned_date": nxt.planned_date,
                    "decision": nxt.decision,
                }
                if nxt
                else None,
                "upcoming": [
                    {
                        "id": a.id,
                        "code": a.code,
                        "title": a.title,
                        "planned_finish": a.planned_finish,
                        "status": a.status,
                    }
                    for a in upcoming
                ],
            }
    my_open = (
        db.scalar(select(func.count(Task.id)).where(Task.assignee_id == pr.id, Task.status != "done")) or 0
    )
    my_overdue = (
        db.scalar(
            select(func.count(Task.id)).where(
                Task.assignee_id == pr.id, Task.status != "done", Task.due_date < today
            )
        )
        or 0
    )
    out["my_tasks"] = {"open": my_open, "overdue": my_overdue}

    def scoped(stmt, col, perm):
        scope = pr.entity_scope(perm)
        return stmt if scope is None else stmt.where(or_(col.is_(None), col.in_(scope)))

    if pr.has_any("documents.read"):
        out["documents"] = {
            "total": db.scalar(scoped(select(func.count(Document.id)), Document.entity_id, "documents.read"))
            or 0,
            "review_due": db.scalar(
                scoped(
                    select(func.count(Document.id)).where(
                        Document.next_review_date <= today + timedelta(days=30), Document.status != "Retired"
                    ),
                    Document.entity_id,
                    "documents.read",
                )
            )
            or 0,
        }
    if pr.has_any("incidents.read"):
        out["incidents"] = {
            "open": db.scalar(
                scoped(
                    select(func.count(Incident.id)).where(Incident.status.in_(["Open", "Contained"])),
                    Incident.entity_id,
                    "incidents.read",
                )
            )
            or 0
        }
    if pr.has_any("findings.read"):
        out["action_items_overdue"] = (
            db.scalar(
                scoped(
                    select(func.count(ActionItem.id)).where(
                        ActionItem.target_date < today, ActionItem.status != "Completed"
                    ),
                    ActionItem.entity_id,
                    "findings.read",
                )
            )
            or 0
        )
    return out
