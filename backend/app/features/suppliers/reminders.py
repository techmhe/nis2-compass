"""Supplier reminders: certificates expiring within 30 days (or expired) and reviews that are due.
Recipients are the users linked to the supplier's relationship-owner stakeholder. Deduplicated per item."""

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.features.suppliers.logic import REVIEW_MONTHS, add_months, dependency_map, effective_tier
from app.features.suppliers.models import Supplier
from app.services.notify import remind_due, stakeholder_user_id


def run_reminders(db: Session, today: date | None = None) -> int:
    today = today or date.today()
    n = 0
    svc_map, _ = dependency_map(db)
    rows = db.scalars(
        select(Supplier)
        .where(Supplier.status != "offboarded")
        .options(selectinload(Supplier.certificates), selectinload(Supplier.assessments))
    )
    for s in rows:
        uid = stakeholder_user_id(db, s.relationship_owner_id)
        if not uid:
            continue
        for c in s.certificates:
            if c.valid_until and c.valid_until <= today + timedelta(days=30):
                n += remind_due(
                    db,
                    uid,
                    key=f"supcert:{c.id}",
                    due=c.valid_until,
                    today=today,
                    what=f"{s.name}: renew {c.cert_type} certificate",
                    link=f"/suppliers/{s.id}?tab=certificates",
                    soon_kind="certificate_expiry",
                )
        tier, _sug, _r = effective_tier(s, svc_map.get(s.id, []))
        last = s.assessments[0] if s.assessments else None
        due = (last.next_due or add_months(last.assessed_on, REVIEW_MONTHS[tier])) if last else None
        if due and due <= today + timedelta(days=14):
            n += remind_due(
                db,
                uid,
                key=f"supreview:{s.id}",
                due=due,
                today=today,
                what=f"Supplier review: {s.name}",
                link=f"/suppliers/{s.id}?tab=assessments",
                soon_kind="review_due",
            )
    db.commit()
    return n
