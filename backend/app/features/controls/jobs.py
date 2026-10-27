"""Daily job of the controls module.

Wiring (app/main.py, lifespan, next to the reminder loop):

    from app.features.controls.jobs import daily_loop
    tasks.append(asyncio.create_task(_singleton_loop(7303, daily_loop)))

`run_daily(db)` is idempotent and can also be called from a cron job or a management command.
"""

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.features.controls.kpi import refresh_computed
from app.features.controls.models import ControlActivity, ControlException, ControlOccurrence
from app.features.controls.schedule import generate_occurrences, today
from app.services.notify import owner_user, remind_due

log = logging.getLogger(__name__)

DUE_SOON_DAYS = 7
EXCEPTION_WARN_DAYS = 14


def owner_user_id(db: Session, a: ControlActivity) -> int | None:
    return owner_user(db, a.owner_user_id, a.owner_stakeholder_id)


def run_daily(db: Session) -> dict:
    ref = today()
    created = removed = reminders = 0
    for a in db.scalars(select(ControlActivity)):
        c, r = generate_occurrences(db, a, ref=ref)
        created += c
        removed += r
    for o in db.scalars(
        select(ControlOccurrence).where(
            ControlOccurrence.status == "planned",
            ControlOccurrence.due_date <= ref + timedelta(days=DUE_SOON_DAYS),
        )
    ):
        reminders += remind_due(
            db,
            owner_user_id(db, o.activity),
            key=f"ctl:{o.id}",
            due=o.due_date,
            today=ref,
            what=f"Control {o.activity.code} {o.activity.title} ({o.entity.code}, {o.period_label})",
            link=f"/controls/calendar?occurrence={o.id}",
            perm="controls.read",
            entity_id=o.entity_id,
        )
    for x in db.scalars(
        select(ControlException).where(
            ControlException.status == "approved",
            ControlException.expires_at <= ref + timedelta(days=EXCEPTION_WARN_DAYS),
        )
    ):
        reminders += remind_due(
            db,
            {x.requested_by_id, x.approver_id},
            key=f"ctl_exc:{x.id}",
            due=x.expires_at,
            today=ref,
            what=f"Exception {x.code} expiry: {x.title}",
            link=f"/controls/exceptions?exception={x.id}",
            soon_kind="review_due",
            perm="controls.read",
            entity_id=x.entity_id,
        )
    kpis = refresh_computed(db, ref)
    db.commit()
    return {
        "occurrences_created": created,
        "occurrences_removed": removed,
        "reminders": reminders,
        "kpi_values": kpis,
    }


async def daily_loop() -> None:
    """Run the daily job every 6 hours (everything it does is idempotent / deduplicated)."""
    while True:
        try:
            db = SessionLocal()
            try:
                result = await asyncio.to_thread(run_daily, db)
                log.info("controls daily job: %s", result)
            finally:
                db.close()
        except Exception as e:  # noqa: BLE001
            log.warning("controls daily job failed: %s", e)
        await asyncio.sleep(6 * 3600)
