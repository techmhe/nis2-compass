"""Personal work view: everything assigned to or owned by the current user across the whole tool."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.work import task_out
from app.core.deps import Principal, get_principal
from app.db import get_db
from app.models import (
    ActionItem,
    Activity,
    Answer,
    Assessment,
    AssessmentRound,
    Document,
    Gate,
    Incident,
    RaidRecord,
    Stakeholder,
    Task,
    WorkPackage,
)
from app.services.scoring import due_status, raid_due_status, schedule_status

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/work")
def my_work(pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    today = date.today()
    my_st = list(db.scalars(select(Stakeholder.id).where(Stakeholder.user_id == pr.id)))
    out: dict = {
        "stakeholders": [s.name for s in db.scalars(select(Stakeholder).where(Stakeholder.user_id == pr.id))]
    }

    tasks = db.scalars(
        select(Task)
        .where(Task.assignee_id == pr.id, Task.status != "done")
        .order_by(Task.due_date.is_(None), Task.due_date, Task.id)
    ).all()
    out["tasks"] = [task_out(t) for t in tasks]
    out["reported_open"] = [
        task_out(t)
        for t in db.scalars(
            select(Task)
            .where(Task.reporter_id == pr.id, Task.assignee_id != pr.id, Task.status != "done")
            .order_by(Task.due_date)
            .limit(50)
        )
    ]

    rnd = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    answers = []
    if my_st and rnd:
        for a in db.scalars(
            select(Answer)
            .join(Assessment)
            .where(Assessment.round_id == rnd, Answer.responsible_id.in_(my_st))
        ):
            if not pr.can("assessments.read", a.assessment.entity_id):
                continue
            open_q = a.scope == "In Scope" and not (a.implemented and a.documented and a.effectiveness)
            if open_q or a.wp_required:
                answers.append(
                    {
                        "answer_id": a.id,
                        "assessment_id": a.assessment_id,
                        "entity_code": a.assessment.entity.code,
                        "requirement_id": a.requirement_id,
                        "number": a.requirement.number,
                        "section": a.requirement.section,
                        "state": "open question" if open_q else "finding",
                        "finding_id": a.finding_id,
                        "target_date": a.target_date,
                        "sort": a.requirement.sort_order,
                    }
                )
    answers.sort(key=lambda x: (x["entity_code"], x["sort"]))
    out["answers"] = answers

    lead = db.scalars(
        select(Assessment).where(Assessment.lead_user_id == pr.id, Assessment.status != "completed")
    ).all()
    out["assessments"] = [
        {
            "id": a.id,
            "entity_code": a.entity.code,
            "entity_name": a.entity.name,
            "round": a.round.name,
            "status": a.status,
            "due_date": a.due_date,
        }
        for a in lead
    ]

    items = []
    if my_st:
        for it in db.scalars(
            select(ActionItem)
            .where(ActionItem.responsible_id.in_(my_st), ActionItem.status != "Completed")
            .order_by(ActionItem.target_date)
        ):
            items.append(
                {
                    "id": it.id,
                    "code": it.code,
                    "title": it.title,
                    "entity_code": it.entity.code,
                    "requirement": it.requirement.number,
                    "status": it.status,
                    "priority": it.priority,
                    "target_date": it.target_date,
                    "due_status": due_status(it.target_date, it.status),
                }
            )
    out["action_items"] = items

    wp_filter = [WorkPackage.owner_id == pr.id]
    if my_st:
        wp_filter.append(WorkPackage.owner_stakeholder_id.in_(my_st))
    out["work_packages"] = [
        {
            "id": w.id,
            "code": w.code,
            "title": w.title,
            "status": w.status,
            "priority": w.priority,
            "planned_finish": w.planned_finish,
            "schedule_status": schedule_status(w.planned_start, w.planned_finish, w.status),
        }
        for w in db.scalars(
            select(WorkPackage).where(or_(*wp_filter), WorkPackage.status.not_in(["Completed", "Cancelled"]))
        )
    ]

    acts, raid, gates = [], [], []
    if my_st:
        acts = [
            {
                "id": a.id,
                "project_id": a.project_id,
                "code": a.code,
                "title": a.title,
                "status": a.status,
                "planned_finish": a.planned_finish,
                "schedule_status": schedule_status(a.planned_start, a.planned_finish, a.status),
            }
            for a in db.scalars(
                select(Activity)
                .where(Activity.owner_id.in_(my_st), Activity.status != "Completed")
                .order_by(Activity.planned_finish)
            )
        ]
        raid = [
            {
                "id": r.id,
                "project_id": r.project_id,
                "code": r.code,
                "type": r.type,
                "title": r.title,
                "status": r.status,
                "target_date": r.target_date,
                "due_status": raid_due_status(r.target_date, r.status),
            }
            for r in db.scalars(
                select(RaidRecord).where(
                    RaidRecord.owner_id.in_(my_st), RaidRecord.status.not_in(["Closed", "Accepted"])
                )
            )
        ]
        gates = [
            {
                "id": g.id,
                "project_id": g.project_id,
                "code": g.code,
                "decision": g.decision,
                "planned_date": g.planned_date,
                "status": g.status,
            }
            for g in db.scalars(
                select(Gate)
                .where(Gate.decision_owner_id.in_(my_st), Gate.status != "Completed")
                .order_by(Gate.planned_date)
            )
        ]
    out["activities"], out["raid"], out["gates"] = acts, raid, gates

    out["documents"] = [
        {
            "id": d.id,
            "title": d.title,
            "status": d.status,
            "next_review_date": d.next_review_date,
            "overdue": bool(d.next_review_date and d.next_review_date < today),
        }
        for d in db.scalars(
            select(Document)
            .where(
                Document.owner_id == pr.id,
                Document.status != "Retired",
                or_(
                    Document.next_review_date <= today + timedelta(days=45),
                    Document.status.in_(["Draft", "In Review"]),
                ),
            )
            .order_by(Document.next_review_date)
        )
    ]
    out["incidents"] = [
        {"id": i.id, "code": i.code, "title": i.title, "status": i.status, "severity": i.severity}
        for i in db.scalars(
            select(Incident).where(Incident.handler_id == pr.id, Incident.status.in_(["Open", "Contained"]))
        )
    ]
    from app.services.mywork import collect

    out["extra"] = sorted(collect(db, pr, my_st), key=lambda i: (i.get("due") is None, i.get("due") or today))
    out["counts"] = {k: len(v) for k, v in out.items() if isinstance(v, list) and k != "stakeholders"}
    out["overdue"] = (
        sum(1 for t in tasks if t.due_date and t.due_date < today)
        + sum(1 for i in items if i["due_status"] == "Overdue")
        + sum(1 for a in acts if a["schedule_status"] == "Red")
    )
    return out
