"""Continuity reminders: plan tests due within 14 days (or overdue) and BIA reviews due.
Recipients are the users linked to the owner stakeholder. Deduplicated per item and due date."""

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.features.inventory.models import Bia, ContinuityPlan
from app.services.notify import remind_due, stakeholder_user_id


def run_reminders(db: Session, today: date | None = None) -> int:
    today = today or date.today()
    soon = today + timedelta(days=14)
    n = 0
    for p in db.scalars(
        select(ContinuityPlan).where(
            ContinuityPlan.status != "retired",
            ContinuityPlan.next_test_due.is_not(None),
            ContinuityPlan.next_test_due <= soon,
            ContinuityPlan.owner_id.is_not(None),
        )
    ):
        n += remind_due(
            db,
            stakeholder_user_id(db, p.owner_id),
            key=f"plantest:{p.id}",
            due=p.next_test_due,
            today=today,
            what=f"Continuity plan test: {p.code} {p.title}",
            link=f"/inventory/plans?plan={p.id}",
            soon_kind="review_due",
        )
    for b in db.scalars(
        select(Bia).where(Bia.status == "approved", Bia.next_review.is_not(None), Bia.next_review <= soon)
    ):
        # BIAs have no owner field; remind the approver
        n += remind_due(
            db,
            b.approved_by_id,
            key=f"biareview:{b.id}",
            due=b.next_review,
            today=today,
            what=f"BIA review: {b.title or b.period}",
            link=f"/inventory/bia/{b.id}",
            soon_kind="review_due",
        )
    db.commit()
    return n
