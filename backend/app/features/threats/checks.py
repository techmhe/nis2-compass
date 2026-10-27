"""Data-quality rules of the threats module, added to the shared consistency checks (app.features.checks)."""

from datetime import date

from sqlalchemy import select

from app.features.checks.api import register_rule
from app.features.threats.models import Advisory, Vulnerability


@register_rule(
    "T1",
    "Threats",
    "high",
    "Advisory assessment overdue",
    "Threat information must be assessed in writing within the deadline set by its severity (Cbb Art. 17).",
    "controls.read",
)
def _advisory_assessment_overdue(db, pr):
    today = date.today()
    for a in db.scalars(
        select(Advisory).where(Advisory.status.in_(("new", "in_assessment")), Advisory.assessment_due < today)
    ):
        if a.entity_scope == "all":
            if not pr.has_any("controls.read"):
                continue
        elif not any(pr.can_read("controls.read", e) for e in a.entity_ids):
            continue
        yield {
            "label": f"{a.code} {a.title}",
            "message": f"Assessment was due {a.assessment_due.isoformat()}.",
            "url": f"/controls/advisories?advisory={a.id}",
            "entity_id": a.entity_ids[0] if a.entity_scope == "list" and a.entity_ids else None,
        }


@register_rule(
    "T2",
    "Threats",
    "high",
    "Vulnerability remediation overdue",
    "Open vulnerabilities past their remediation deadline must be remediated, mitigated or formally "
    "accepted (IR 2024/2690 6.10).",
    "controls.read",
)
def _vulnerability_remediation_overdue(db, pr):
    today = date.today()
    for v in db.scalars(
        select(Vulnerability).where(
            Vulnerability.status.in_(("open", "in_progress")), Vulnerability.remediation_due < today
        )
    ):
        if not pr.can_read("controls.read", v.entity_id):
            continue
        yield {
            "label": f"{v.code} {v.title}",
            "message": f"Remediation was due {v.remediation_due.isoformat()}.",
            "url": f"/controls/vulnerabilities?vulnerability={v.id}",
            "entity_id": v.entity_id,
        }
