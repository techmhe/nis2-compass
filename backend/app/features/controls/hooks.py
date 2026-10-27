"""Registers comment/document-link targets and search sources of the controls module."""

from app.api.util import register_target
from app.features.controls.models import ControlActivity, ControlException, ControlOccurrence
from app.features.controls.schedule import MONTH_ABBR
from app.services.indexing import register_source

register_target("control_occurrence", ControlOccurrence, "controls.read", "controls.manage")
register_target("control_activity", ControlActivity, "controls.read", "controls.manage")
register_target("control_exception", ControlException, "controls.read", "controls.manage")

REC_LABEL = {
    "monthly": "monthly",
    "quarterly": "quarterly",
    "semi_annual": "semi-annual",
    "annual": "annual",
    "custom": "custom schedule",
}


def _j(*parts) -> str:
    return "\n".join(str(p) for p in parts if p)


def _activity(db, a: ControlActivity) -> list[dict]:
    when = REC_LABEL.get(a.recurrence, a.recurrence)
    if a.recurrence == "annual":
        when += f", due in {MONTH_ABBR[(a.anchor_month or 12) - 1]}"
    return [
        {
            "title": f"{a.code} {a.title}",
            "content": _j(
                f"Recurring control activity {a.code} ({when})",
                a.title,
                a.description,
                f"Legal references: {a.legal_refs}" if a.legal_refs else None,
                f"Required evidence: {a.required_evidence}" if a.required_evidence else None,
                "Active" if a.active else "Inactive",
            ),
            "entity_id": None,
            "url": f"/controls/activities?activity={a.id}",
            "meta": {"active": a.active},
        }
    ]


def _exception(db, x: ControlException) -> list[dict]:
    return [
        {
            "title": f"{x.code} {x.title}",
            "content": _j(
                f"Exception {x.code} ({x.status}), expires {x.expires_at.isoformat()}",
                x.title,
                f"Reason: {x.reason}",
                f"Compensating measures: {x.compensating_measures}" if x.compensating_measures else None,
            ),
            "entity_id": x.entity_id,
            "url": f"/controls/exceptions?exception={x.id}",
            "meta": {"status": x.status},
        }
    ]


register_source("control_activity", ControlActivity, "controls.read", "Control activity", _activity)
register_source("control_exception", ControlException, "controls.read", "Control exception", _exception)


def _my_control_occurrences(db, pr, stakeholder_ids):
    from datetime import date, timedelta

    from sqlalchemy import select

    items = []
    horizon = date.today() + timedelta(days=30)
    acts = {a.id: a for a in db.scalars(select(ControlActivity).where(ControlActivity.active.is_(True)))}
    mine = {
        aid
        for aid, a in acts.items()
        if a.owner_user_id == pr.id or (a.owner_stakeholder_id and a.owner_stakeholder_id in stakeholder_ids)
    }
    if not mine:
        return items
    for o in db.scalars(
        select(ControlOccurrence).where(
            ControlOccurrence.activity_id.in_(mine),
            ControlOccurrence.status == "planned",
            ControlOccurrence.due_date <= horizon,
        )
    ):
        if not pr.can_read("controls.read", o.entity_id):
            continue  # owner of a group activity, but no access to this entity's controls
        a = acts[o.activity_id]
        items.append(
            {
                "kind": "control_occurrence",
                "kind_label": "Control activities",
                "id": o.id,
                "code": None,
                "title": a.title,
                "entity_code": o.entity.code if getattr(o, "entity", None) else None,
                "due": o.due_date,
                "href": f"/controls/calendar?occurrence={o.id}",
                "status": "Planned",
            }
        )
    return items


def _register_mywork():
    from app.services.mywork import register_provider

    register_provider("controls", _my_control_occurrences)


_register_mywork()
