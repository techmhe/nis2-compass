"""Due-soon / overdue reminders for audit findings; call from the hourly reminder job
(app.services.notify.run_reminders). Notifications are deduplicated per item and day (see remind_due)."""

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.features.audits.access import audit_managers
from app.features.audits.models import AuditFinding
from app.services.notify import remind_due


def run_audit_reminders(db: Session, today: date | None = None) -> int:
    today = today or date.today()
    n = 0
    for f in db.scalars(
        select(AuditFinding).where(
            AuditFinding.status != "closed",
            AuditFinding.due_date.is_not(None),
            AuditFinding.due_date <= today + timedelta(days=7),
        )
    ):
        ent = f.entity_id if f.entity_id is not None else f.audit.entity_id
        recipients = set(audit_managers(db, ent))
        if f.audit.lead_auditor_id:
            recipients.add(f.audit.lead_auditor_id)
        n += remind_due(
            db,
            recipients,
            key=f"aud-finding:{f.id}",
            due=f.due_date,
            today=today,
            what=f"audit finding {f.audit.code} {f.number}",
            link=f"/audits/findings?finding={f.id}",
            perm="audits.read",
            entity_id=ent,
        )
    db.commit()
    return n
