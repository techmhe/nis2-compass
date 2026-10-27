"""Due-soon / overdue reminders for governance obligations and registration changes.

Call `run_governance_reminders(db)` from the hourly reminder job (app.services.notify.run_reminders);
notifications are deduplicated per item and day."""

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.features.governance.logic import governance_managers
from app.features.governance.models import Obligation, RegistrationChange
from app.features.governance.validation import owner_user_id
from app.services.notify import remind_due


def run_governance_reminders(db: Session, today: date | None = None) -> int:
    today = today or date.today()
    n = 0
    for o in db.scalars(
        select(Obligation).where(
            Obligation.status == "open", Obligation.due_date <= today + timedelta(days=7)
        )
    ):
        n += remind_due(
            db,
            owner_user_id(db, o.owner_user_id, o.owner_stakeholder_id),
            key=f"gov-ob:{o.id}",
            due=o.due_date,
            today=today,
            what=o.title,
            link=f"/governance/obligations?obligation={o.id}",
            perm="governance.read",
            entity_id=o.entity_id,
        )
    for c in db.scalars(
        select(RegistrationChange).where(
            RegistrationChange.reported_at.is_(None), RegistrationChange.due_at <= today + timedelta(days=5)
        )
    ):
        n += remind_due(
            db,
            governance_managers(db, c.entity_id),
            key=f"gov-chg:{c.id}",
            due=c.due_at,
            today=today,
            what=f"report registration change: {c.field_label}",
            link=f"/governance/registrations?registration={c.registration_id}",
        )
    db.commit()
    return n
