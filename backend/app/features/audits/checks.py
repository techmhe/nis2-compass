"""Data-quality rules of the audits module, added to the shared consistency checks (app.features.checks)."""

from datetime import date, timedelta

from sqlalchemy import select

from app.features.audits.models import Audit, AuditFinding, EffectivenessReview
from app.features.checks.api import register_rule
from app.models import Entity


@register_rule(
    "AU1",
    "Audits",
    "high",
    "Overdue audit finding",
    "Open audit findings past their due date must be closed or re-planned (ISO 9.2, Cbb Art. 18).",
    "audits.read",
)
def _overdue_findings(db, pr):
    today = date.today()
    for f in db.scalars(
        select(AuditFinding).where(
            AuditFinding.status != "closed", AuditFinding.due_date.is_not(None), AuditFinding.due_date < today
        )
    ):
        ent = f.entity_id if f.entity_id is not None else f.audit.entity_id
        if not pr.can_read("audits.read", ent):
            continue
        yield {
            "label": f"{f.audit.code} {f.number}",
            "message": f"Finding was due {f.due_date.isoformat()}.",
            "url": f"/audits/findings?finding={f.id}",
            "entity_id": ent,
        }


@register_rule(
    "AU2",
    "Audits",
    "medium",
    "No approved effectiveness review in the last 12 months",
    "Cbb Art. 18 requires a periodic written evaluation of the effectiveness of the risk-management "
    "measures.",
    "audits.read",
)
def _stale_effectiveness_review(db, pr):
    cutoff = date.today() - timedelta(days=365)
    for e in db.scalars(select(Entity).where(Entity.is_active.is_(True))):
        if not pr.can_read("audits.read", e.id):
            continue
        latest = db.scalar(
            select(EffectivenessReview.approved_at)
            .where(
                EffectivenessReview.entity_id == e.id,
                EffectivenessReview.status == "approved",
                EffectivenessReview.approved_at.is_not(None),
            )
            .order_by(EffectivenessReview.approved_at.desc())
            .limit(1)
        )
        if latest is None or latest < cutoff:
            yield {
                "label": e.code,
                "message": "No approved effectiveness evaluation in the last 12 months.",
                "url": "/audits/effectiveness-reviews",
                "entity_id": e.id,
            }


@register_rule(
    "AU3",
    "Audits",
    "low",
    "Audit past its planned end without a report",
    "Audits still 'in progress' well past the planned end date should be reported and closed.",
    "audits.read",
)
def _late_audits(db, pr):
    today = date.today()
    for a in db.scalars(
        select(Audit).where(
            Audit.status.in_(("planned", "in_progress")), Audit.planned_end < today - timedelta(days=14)
        )
    ):
        if not pr.can_read("audits.read", a.entity_id):
            continue
        yield {
            "label": a.code,
            "message": f"Planned end was {a.planned_end.isoformat()}.",
            "url": f"/audits/programme?audit={a.id}",
            "entity_id": a.entity_id,
        }
