"""Shared logic: sequential finding numbers, the effectiveness-review "collect inputs" aggregate, and the
management-report / data-quality contributions in hooks.py."""

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.features.audits.models import Audit, AuditFinding
from app.models import ActionItem, AssessmentRound, Incident
from app.services.scoring import due_status
from app.services.stats import gap_dashboard


def next_finding_number(db: Session, audit_id: int) -> str:
    """F1, F2 ... sequential within one audit (mirrors app.api.util.next_code for a per-audit sequence)."""
    nums = [
        int(n[1:])
        for n in db.scalars(select(AuditFinding.number).where(AuditFinding.audit_id == audit_id))
        if n[1:].isdigit()
    ]
    return f"F{(max(nums) if nums else 0) + 1}"


def collect_inputs(db: Session, entity_id: int | None) -> dict:
    """Read-only aggregate for the Cbb Art. 18 effectiveness evaluation: GAP coverage/score, open/overdue action
    items, KPI values off target, incidents in the last 12 months, and open audit findings."""
    today = date.today()
    scope = {entity_id} if entity_id is not None else None

    round_id = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    gap = None
    if round_id:
        g = gap_dashboard(db, round_id, scope, with_action_plan=True)
        gap = {
            "coverage": g["totals"]["coverage"],
            "average_score": g["totals"]["average_score"],
            "work_packages": g["totals"]["work_packages"],
        }

    items_q = select(ActionItem)
    if scope is not None:
        items_q = items_q.where(ActionItem.entity_id.in_(scope))
    items = list(db.scalars(items_q))
    action_plan = {
        "open": sum(1 for i in items if i.status not in ("Completed",)),
        "overdue": sum(1 for i in items if due_status(i.target_date, i.status, today) == "Overdue"),
    }

    kpis_off_target = 0
    try:
        from app.features.controls.kpi import status_of
        from app.features.controls.models import MetricInstance, MetricValue

        inst_q = select(MetricInstance)
        if scope is not None:
            inst_q = inst_q.where(MetricInstance.entity_id.in_(scope))
        for inst in db.scalars(inst_q):
            latest = db.scalar(
                select(MetricValue)
                .where(MetricValue.instance_id == inst.id)
                .order_by(MetricValue.period_end.desc())
                .limit(1)
            )
            if latest and status_of(inst.definition.direction, latest.value, inst.target) == "missed":
                kpis_off_target += 1
    except ImportError:
        pass

    since = today - timedelta(days=365)
    inc_q = select(func.count(Incident.id)).where(Incident.created_at >= since)
    if scope is not None:
        inc_q = inc_q.where(Incident.entity_id.in_(scope))
    incidents_12m = db.scalar(inc_q) or 0

    find_q = select(AuditFinding).join(Audit).where(AuditFinding.status != "closed")
    if scope is not None:
        find_q = find_q.where((AuditFinding.entity_id.in_(scope)) | (Audit.entity_id.in_(scope)))
    open_findings = len(list(db.scalars(find_q)))

    return {
        "entity_id": entity_id,
        "generated_at": today.isoformat(),
        "gap": gap,
        "action_plan": action_plan,
        "kpis_off_target": kpis_off_target,
        "incidents_last_12_months": incidents_12m,
        "audit_findings_open": open_findings,
    }
