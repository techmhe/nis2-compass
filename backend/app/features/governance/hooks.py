"""Register governance objects as comment/document-link targets and as searchable sources."""

from app.api.util import register_target
from app.features.governance.models import BoardDecision, Obligation, Registration, TrainingRecord
from app.features.governance.seed import ensure_entity_reference
from app.services.entities import register_entity_hook
from app.services.indexing import register_source

register_target("board_decision", BoardDecision, "governance.read", "governance.manage")
register_target("training", TrainingRecord, "governance.read", "governance.manage")
register_target("registration", Registration, "governance.read", "governance.manage")
register_target("obligation", Obligation, "governance.read", "governance.manage")
register_entity_hook(ensure_entity_reference)

DECISION_LABELS = {
    "approve_measures": "Approve measures",
    "approve_policy": "Approve policy",
    "accept_risk": "Accept risk",
    "budget": "Budget",
    "oversight_review": "Oversight review",
    "other": "Other",
}


def _decision(db, d: BoardDecision) -> list[dict]:
    return [
        {
            "title": f"{d.code} {d.subject}",
            "content": "\n".join(
                x
                for x in (
                    f"Management body decision of {d.entity.name} on {d.decided_on.isoformat()}",
                    f"Type: {DECISION_LABELS.get(d.decision_type, d.decision_type)}",
                    d.subject,
                    d.description or "",
                    ("Participants: " + d.participants) if d.participants else "",
                )
                if x
            ),
            "entity_id": d.entity_id,
            "url": f"/governance/management?decision={d.id}",
            "meta": {"code": d.code, "type": d.decision_type},
        }
    ]


def _obligation(db, o: Obligation) -> list[dict]:
    return [
        {
            "title": o.title,
            "content": "\n".join(
                x
                for x in (
                    f"Governance obligation ({o.kind}) due {o.due_date.isoformat()}, recurrence {o.recurrence}",
                    f"Legal reference: {o.legal_ref}" if o.legal_ref else "",
                    o.description or "",
                    f"Entity: {o.entity.name}" if o.entity else "Group-wide",
                    f"Status: {o.status}",
                )
                if x
            ),
            "entity_id": o.entity_id,
            "url": f"/governance/obligations?obligation={o.id}",
            "meta": {"status": o.status, "due_date": o.due_date.isoformat()},
        }
    ]


register_source("board_decision", BoardDecision, "governance.read", "Board decision", _decision)
register_source("obligation", Obligation, "governance.read", "Obligation", _obligation)


def _my_obligations(db, pr, stakeholder_ids):
    from sqlalchemy import select

    from app.features.governance.models import Obligation, RegistrationChange

    items = []
    for o in db.scalars(select(Obligation).where(Obligation.status == "open")):
        mine = o.owner_user_id == pr.id or (
            o.owner_stakeholder_id and o.owner_stakeholder_id in stakeholder_ids
        )
        if mine and pr.can_read("governance.read", o.entity_id):
            items.append(
                {
                    "kind": "obligation",
                    "kind_label": "Obligations",
                    "id": o.id,
                    "code": None,
                    "title": o.title,
                    "entity_code": o.entity.code if o.entity else None,
                    "due": o.due_date,
                    "href": f"/governance/obligations?obligation={o.id}",
                    "status": o.legal_ref,
                }
            )
    if pr.has_any("governance.manage"):
        for c in db.scalars(select(RegistrationChange).where(RegistrationChange.reported_at.is_(None))):
            if pr.can_write("governance.manage", c.entity_id):
                items.append(
                    {
                        "kind": "registration_change",
                        "kind_label": "Registration changes",
                        "id": c.id,
                        "code": None,
                        "title": f"Report change of {c.field_label or c.field}",
                        "entity_code": c.registration.entity.code if c.registration else None,
                        "due": c.due_at.date() if hasattr(c.due_at, "date") else c.due_at,
                        "href": "/governance/registrations",
                        "status": "Report within 2 weeks",
                    }
                )
    return items


def _register_mywork():
    from app.services.mywork import register_provider

    register_provider("governance", _my_obligations)


_register_mywork()


def _register_reminders():
    from app.features.governance.reminders import run_governance_reminders
    from app.services.notify import register_reminder_job

    register_reminder_job(run_governance_reminders)


_register_reminders()
