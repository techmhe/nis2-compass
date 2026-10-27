"""Registers comment/document-link targets, search sources, the My work provider and the reminder job of the
threats module (mirrors app.features.controls.hooks)."""

from datetime import timedelta

from sqlalchemy import select

import app.features.threats.checks  # noqa: F401  (registers data-quality rules)
import app.features.threats.kpi  # noqa: F401  (registers computed KPI sources)
from app.api.util import register_target
from app.core.deps import user_can
from app.db import utcnow
from app.features.threats.models import Advisory, Vulnerability
from app.services.indexing import register_source
from app.services.mywork import register_provider
from app.services.notify import owner_user, register_reminder_job, remind_due

register_target("advisory", Advisory, "controls.read", "controls.manage")
register_target("vulnerability", Vulnerability, "controls.read", "controls.manage")


def _j(*parts) -> str:
    return "\n".join(str(p) for p in parts if p)


def _advisory_source(db, a: Advisory) -> list[dict]:
    return [
        {
            "title": f"{a.code} {a.title}",
            "content": _j(
                f"Advisory {a.code} from {a.source} ({a.severity}), received {a.received_on.isoformat()}, "
                f"status {a.status}",
                a.title,
                a.summary,
                f"Relevant: {a.relevant}" if a.relevant else None,
                f"Rationale: {a.rationale}" if a.rationale else None,
            ),
            "entity_id": a.entity_ids[0] if a.entity_scope == "list" and a.entity_ids else None,
            "url": f"/controls/advisories?advisory={a.id}",
            "meta": {"status": a.status, "severity": a.severity},
        }
    ]


def _vulnerability_source(db, v: Vulnerability) -> list[dict]:
    return [
        {
            "title": f"{v.code} {v.title}",
            "content": _j(
                f"Vulnerability {v.code} ({v.severity}), status {v.status}, remediation due "
                f"{v.remediation_due.isoformat()}",
                v.title,
                f"CVE: {', '.join(v.cve_ids)}" if v.cve_ids else None,
                v.notes,
            ),
            "entity_id": v.entity_id,
            "url": f"/controls/vulnerabilities?vulnerability={v.id}",
            "meta": {"status": v.status, "severity": v.severity},
        }
    ]


register_source("advisory", Advisory, "controls.read", "Threat advisory", _advisory_source)
register_source("vulnerability", Vulnerability, "controls.read", "Vulnerability", _vulnerability_source)


def _my_threats(db, pr, stakeholder_ids: list[int]) -> list[dict]:
    items = []
    for a in db.scalars(select(Advisory).where(Advisory.status.in_(("new", "in_assessment")))):
        if a.assessed_by_id not in (None, pr.id) and a.created_by_id != pr.id:
            continue
        if (
            a.entity_scope == "list"
            and a.entity_ids
            and not any(pr.can_read("controls.read", e) for e in a.entity_ids)
        ):
            continue
        items.append(
            {
                "kind": "advisory",
                "kind_label": "Threat advisories",
                "id": a.id,
                "code": a.code,
                "title": a.title,
                "entity_code": None,
                "due": a.assessment_due,
                "href": f"/controls/advisories?advisory={a.id}",
                "status": "Awaiting assessment",
            }
        )
    for v in db.scalars(select(Vulnerability).where(Vulnerability.status.in_(("open", "in_progress")))):
        if v.owner_user_id != pr.id and not (
            v.owner_stakeholder_id and v.owner_stakeholder_id in stakeholder_ids
        ):
            continue
        if not pr.can_read("controls.read", v.entity_id):
            continue
        items.append(
            {
                "kind": "vulnerability",
                "kind_label": "Vulnerabilities",
                "id": v.id,
                "code": v.code,
                "title": v.title,
                "entity_code": v.entity.code if v.entity else None,
                "due": v.remediation_due,
                "href": f"/controls/vulnerabilities?vulnerability={v.id}",
                "status": v.status.replace("_", " ").title(),
            }
        )
    return items


register_provider("threats", _my_threats)


def run_threats_reminders(db) -> int:
    """Due-soon / overdue reminders for advisory assessments and vulnerability remediation."""
    today = utcnow().date()
    n = 0
    for a in db.scalars(
        select(Advisory).where(
            Advisory.status.in_(("new", "in_assessment")),
            Advisory.assessment_due <= today + timedelta(days=3),
        )
    ):
        recipient = a.assessed_by_id or a.created_by_id
        if recipient:
            n += remind_due(
                db,
                recipient,
                key=f"thr-adv:{a.id}",
                due=a.assessment_due,
                today=today,
                what=f"Assess advisory {a.code}: {a.title}",
                link=f"/controls/advisories?advisory={a.id}",
                perm="controls.read",
                entity_id=a.entity_ids[0] if a.entity_scope == "list" and a.entity_ids else None,
            )
    for v in db.scalars(
        select(Vulnerability).where(
            Vulnerability.status.in_(("open", "in_progress")),
            Vulnerability.remediation_due <= today + timedelta(days=3),
        )
    ):
        recipient = owner_user(db, v.owner_user_id, v.owner_stakeholder_id)
        if recipient and user_can(db, recipient, "controls.read", v.entity_id):
            n += remind_due(
                db,
                recipient,
                key=f"thr-vuln:{v.id}",
                due=v.remediation_due,
                today=today,
                what=f"Remediate {v.code}: {v.title}",
                link=f"/controls/vulnerabilities?vulnerability={v.id}",
                perm="controls.read",
                entity_id=v.entity_id,
            )
    return n


register_reminder_job(run_threats_reminders)
