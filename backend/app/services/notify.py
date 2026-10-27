"""In-app notifications with optional e-mail delivery, plus the periodic reminder job."""

import asyncio
import logging
import smtplib
import ssl
from datetime import date, timedelta
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.models import ActionItem, Document, Notification, Stakeholder, Task, User

log = logging.getLogger(__name__)


def absence_deputy(user: User | None, today: date | None = None) -> int | None:
    """The deputy of a user who is absent today (Profile → Absence), else None."""
    a = (user.preferences or {}).get("absence") if user else None
    if not a:
        return None
    today = today or date.today()
    try:
        return (
            int(a["deputy_id"])
            if date.fromisoformat(a["start"]) <= today <= date.fromisoformat(a["until"])
            else None
        )
    except (KeyError, TypeError, ValueError):
        return None


def notify(
    db: Session,
    user_id: int | None,
    kind: str,
    title: str,
    link: str | None = None,
    body: str | None = None,
    dedupe_key: str | None = None,
    actor_id: int | None = None,
    perm: str | None = None,
    entity_id: int | None = None,
    _forwarded: bool = False,
) -> None:
    """In-app notification (and e-mail). While the recipient is absent, the deputy gets a copy: the full content
    only if `perm` for `entity_id` is given and the deputy holds it, otherwise a neutral hint without title or link."""
    if not user_id or user_id == actor_id:
        return
    if dedupe_key and db.scalar(
        select(Notification.id).where(Notification.user_id == user_id, Notification.dedupe_key == dedupe_key)
    ):
        return
    db.add(
        Notification(
            user_id=user_id, kind=kind, title=title[:400], link=link, body=body, dedupe_key=dedupe_key
        )
    )
    user = db.get(User, user_id)
    if user and (user.preferences or {}).get("email_notifications", True):
        send_mail(
            user.email,
            title,
            (body or "") + (f"\n\n{get_settings().base_url}{link}" if link else ""),
            user_id=user.id,
        )
    deputy = None if _forwarded else absence_deputy(user)
    if deputy and deputy != user_id:  # copy to the deputy (one level only)
        dep = db.get(User, deputy)
        if dep and dep.is_active:
            key = f"{dedupe_key}:deputy:{user_id}" if dedupe_key else None
            if perm and user_may_read(db, deputy, perm, entity_id):
                notify(
                    db,
                    deputy,
                    kind,
                    f"For {user.display_name}: {title}",
                    link,
                    body=body,
                    dedupe_key=key,
                    actor_id=actor_id,
                    _forwarded=True,
                )
            else:  # the deputy may not see the item: no title, body or link
                notify(
                    db,
                    deputy,
                    kind,
                    f"For {user.display_name}: {kind.replace('_', ' ')} notification while away "
                    "(ask them or the item's owner for details)",
                    None,
                    dedupe_key=key,
                    actor_id=actor_id,
                    _forwarded=True,
                )


def send_mail(to: str, subject: str, text: str, user_id: int | None = None) -> None:
    s = get_settings()
    if not s.smtp_host or not s.smtp_from or to.endswith((".local", ".invalid")):
        return
    try:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = s.smtp_from, to, f"[{s.app_name}] {subject}"
        msg.set_content(text)
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
            if s.smtp_starttls:
                smtp.starttls(context=ssl.create_default_context())
            if s.smtp_user:
                smtp.login(s.smtp_user, s.smtp_password or "")
            smtp.send_message(msg)
    except Exception as e:  # noqa: BLE001
        # neither the address nor the exception text (refused-recipient errors repeat it) goes to the log
        log.warning("mail to user %s failed: %s", user_id, type(e).__name__)


def stakeholder_user_id(db: Session, stakeholder_id: int | None) -> int | None:
    st = db.get(Stakeholder, stakeholder_id) if stakeholder_id else None
    return st.user_id if st else None


def owner_user(db: Session, user_id: int | None, stakeholder_id: int | None) -> int | None:
    """The user behind an owner: the direct user, else the user linked to the owner stakeholder (role)."""
    return user_id or stakeholder_user_id(db, stakeholder_id)


def user_may_read(db: Session, user_id: int | None, perm: str, entity_id: int | None) -> bool:
    from app.core.deps import user_can

    return user_can(db, user_id, perm, entity_id)


def remind_due(
    db: Session,
    user_ids,
    *,
    key: str,
    due: date,
    today: date,
    what: str,
    link: str,
    soon_kind: str = "due_soon",
    body: str | None = None,
    perm: str | None = None,
    entity_id: int | None = None,
) -> int:
    """Due-soon / overdue reminder for one item, shared by all reminder jobs.

    Due soon is sent once per due date; overdue repeats once per ISO week until the item is closed, so long-overdue
    items do not flood inboxes. With `perm`, recipients who may not read the item (in `entity_id`) are skipped.
    Returns the number of recipients."""
    ids = {user_ids} if isinstance(user_ids, int) else set(user_ids or ())
    overdue = due < today
    if overdue:
        week = today.isocalendar()
        kind, title = "overdue", f"Overdue since {due.isoformat()}: {what}"
        dedupe = f"overdue:{key}:{due.isoformat()}:{week.year}-{week.week}"
    else:
        kind, title = soon_kind, f"Due {due.isoformat()}: {what}"
        dedupe = f"{soon_kind}:{key}:{due.isoformat()}"
    n = 0
    for uid in ids - {None}:
        if perm and not user_may_read(db, uid, perm, entity_id):
            continue
        notify(db, uid, kind, title, link, body=body, dedupe_key=dedupe, perm=perm, entity_id=entity_id)
        n += 1
    return n


def run_reminders(db: Session, today: date | None = None) -> int:
    """Core reminders: tasks and action plan items due within 3 days, document reviews within 14 days."""
    today = today or date.today()
    soon = today + timedelta(days=3)
    n = 0
    for t in db.scalars(
        select(Task).where(
            Task.status != "done",
            Task.due_date.is_not(None),
            Task.due_date <= soon,
            Task.assignee_id.is_not(None),
        )
    ):
        n += remind_due(
            db,
            t.assignee_id,
            key=f"task:{t.id}",
            due=t.due_date,
            today=today,
            what=f"{t.key} {t.title}",
            link=f"/tasks?task={t.id}",
        )
    for it in db.scalars(
        select(ActionItem).where(
            ActionItem.status != "Completed",
            ActionItem.target_date.is_not(None),
            ActionItem.target_date <= soon,
            ActionItem.responsible_id.is_not(None),
        )
    ):
        n += remind_due(
            db,
            stakeholder_user_id(db, it.responsible_id),
            key=f"ap:{it.id}",
            due=it.target_date,
            today=today,
            what=f"Action plan item {it.code} {it.title}",
            link=f"/action-plan?item={it.id}",
            perm="findings.read",
            entity_id=it.entity_id,
        )
    for d in db.scalars(
        select(Document).where(
            Document.status != "Retired",
            Document.next_review_date.is_not(None),
            Document.next_review_date <= today + timedelta(days=14),
            Document.owner_id.is_not(None),
        )
    ):
        n += remind_due(
            db,
            d.owner_id,
            key=f"doc:{d.id}",
            due=d.next_review_date,
            today=today,
            what=f"Document review: {d.title}",
            link=f"/documents/{d.id}",
            soon_kind="review_due",
        )
    db.commit()
    return n


# Feature modules add their periodic reminder jobs here: fn(db) -> int (number of notifications)
REMINDER_JOBS: list = []


def register_reminder_job(fn) -> None:
    REMINDER_JOBS.append(fn)


def run_all_reminders(db: Session) -> int:
    n = run_reminders(db)
    for job in REMINDER_JOBS:
        try:
            n += job(db) or 0
            db.commit()
        except Exception as e:  # noqa: BLE001 - one failing module must not stop the others
            db.rollback()
            log.warning("reminder job %s failed: %s", getattr(job, "__name__", job), e)
    return n


async def reminder_loop() -> None:
    while True:
        try:
            db = SessionLocal()
            try:
                await asyncio.to_thread(run_all_reminders, db)
            finally:
                db.close()
        except Exception as e:  # noqa: BLE001
            log.warning("reminder job failed: %s", e)
        await asyncio.sleep(3600)
