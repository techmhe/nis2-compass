"""Recurrence rules and the idempotent occurrence generator.

Standard recurrences follow calendar periods; `anchor_month` is the month *within the period* in which the
activity is due (quarterly 1-3, semi-annual 1-6, annual 1-12; monthly ignores it). The due date is the last day
of that month. Custom schedules use an RRULE subset:

    FREQ=WEEKLY|MONTHLY|YEARLY; INTERVAL=n; BYDAY=MO..SU (weekly); BYMONTHDAY=1..31|-1; BYMONTH=1..12 (yearly);
    DTSTART=YYYYMMDD (anchor for INTERVAL > 1)
"""

import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.features.controls.models import ControlActivity, ControlOccurrence
from app.models import DocumentLink, Entity

HORIZON_MONTHS = 12
MIN_DATE = date(1990, 1, 1)  # plausibility bounds for user-supplied dates (also avoids date overflow)
MAX_DATE = date(2100, 12, 31)
MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
ANCHOR_MAX = {"quarterly": 3, "semi_annual": 6, "annual": 12, "monthly": 1, "custom": 12}


@dataclass(frozen=True)
class Period:
    key: str
    label: str
    due: date


def today() -> date:
    return utcnow().date()


def month_end(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def add_months(d: date, n: int) -> date:
    m0 = d.month - 1 + n
    y, m = d.year + m0 // 12, m0 % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


class RRuleError(ValueError):
    pass


def parse_rrule(text: str) -> dict:
    """Parse the RRULE subset; raises RRuleError with a readable message."""
    parts: dict[str, str] = {}
    for chunk in (text or "").replace("RRULE:", "").split(";"):
        if not chunk.strip():
            continue
        if "=" not in chunk:
            raise RRuleError(f"'{chunk}' is not KEY=VALUE")
        k, v = chunk.split("=", 1)
        parts[k.strip().upper()] = v.strip().upper()
    freq = parts.get("FREQ")
    if freq not in ("WEEKLY", "MONTHLY", "YEARLY"):
        raise RRuleError("FREQ must be WEEKLY, MONTHLY or YEARLY")
    out: dict = {"freq": freq}
    try:
        out["interval"] = int(parts.get("INTERVAL", "1"))
        if not 1 <= out["interval"] <= 52:
            raise RRuleError("INTERVAL must be between 1 and 52")
        if "BYMONTHDAY" in parts:
            md = int(parts["BYMONTHDAY"])
            if md == 0 or not -1 <= md <= 31:
                raise RRuleError("BYMONTHDAY must be 1 to 31 or -1 (last day)")
            out["bymonthday"] = md
        if "BYMONTH" in parts:
            bm = int(parts["BYMONTH"])
            if not 1 <= bm <= 12:
                raise RRuleError("BYMONTH must be 1 to 12")
            out["bymonth"] = bm
        if "BYDAY" in parts:
            if parts["BYDAY"] not in WEEKDAYS:
                raise RRuleError("BYDAY must be one of MO, TU, WE, TH, FR, SA, SU")
            out["byday"] = WEEKDAYS.index(parts["BYDAY"])
        if "DTSTART" in parts:
            s = parts["DTSTART"][:8]
            out["dtstart"] = date(int(s[:4]), int(s[4:6]), int(s[6:8]))
            if not MIN_DATE <= out["dtstart"] <= MAX_DATE:
                raise RRuleError("DTSTART must lie between 1990 and 2100")
    except RRuleError:
        raise
    except (ValueError, IndexError):
        raise RRuleError("RRULE contains an invalid number or date") from None
    unknown = set(parts) - {"FREQ", "INTERVAL", "BYMONTHDAY", "BYMONTH", "BYDAY", "DTSTART"}
    if unknown:
        raise RRuleError(f"Unsupported RRULE part(s): {', '.join(sorted(unknown))}")
    return out


def _day(y: int, m: int, md: int | None) -> date:
    last = calendar.monthrange(y, m)[1]
    return date(y, m, last if md in (None, -1) else min(md, last))


def periods(a: ControlActivity, start: date, end: date) -> list[Period]:
    """All periods of the activity whose due date lies within [start, end]."""
    out: list[Period] = []
    rec = a.recurrence
    if rec == "custom":
        return _custom_periods(parse_rrule(a.rrule or ""), start, end)
    anchor = max(1, min(a.anchor_month or ANCHOR_MAX.get(rec, 12), ANCHOR_MAX.get(rec, 12)))
    y = start.year - 1
    while y <= end.year + 1:
        if rec == "monthly":
            cands = [
                (Period(f"{y}-{m:02d}", f"{MONTH_ABBR[m - 1]} {y}", month_end(y, m))) for m in range(1, 13)
            ]
        elif rec == "quarterly":
            cands = [
                Period(f"{y}-Q{q}", f"Q{q} {y}", month_end(y, (q - 1) * 3 + anchor)) for q in range(1, 5)
            ]
        elif rec == "semi_annual":
            cands = [Period(f"{y}-H{h}", f"H{h} {y}", month_end(y, (h - 1) * 6 + anchor)) for h in (1, 2)]
        else:  # annual
            cands = [Period(f"{y}", f"{y}", month_end(y, anchor))]
        out.extend(p for p in cands if start <= p.due <= end)
        y += 1
    return out


def _custom_periods(r: dict, start: date, end: date) -> list[Period]:
    out: list[Period] = []
    interval = r["interval"]
    if r["freq"] == "WEEKLY":
        wd = r.get("byday", 4)
        anchor = r.get("dtstart") or date(start.year, 1, 1)
        first = anchor + timedelta(days=(wd - anchor.weekday()) % 7)
        step = timedelta(weeks=interval)
        d = first
        if d < start:
            d += step * ((start - d).days // step.days)
        while d <= end:
            if d >= start:
                iso = d.isocalendar()
                out.append(Period(d.isoformat(), f"Week {iso[1]} {iso[0]}", d))
            d += step
    elif r["freq"] == "MONTHLY":
        anchor = r.get("dtstart") or date(start.year, 1, 1)
        md = r.get("bymonthday")
        k = 0
        while True:
            m = add_months(date(anchor.year, anchor.month, 1), k * interval)
            d = _day(m.year, m.month, md)
            if d > end:
                break
            if d >= start:
                out.append(Period(d.isoformat(), f"{MONTH_ABBR[d.month - 1]} {d.year}", d))
            k += 1
    else:  # YEARLY
        bm = r.get("bymonth", 12)
        md = r.get("bymonthday")
        base = (r.get("dtstart") or date(start.year - 1, 1, 1)).year
        y = base
        while y <= end.year:
            d = _day(y, bm, md)
            if start <= d <= end:
                out.append(Period(d.isoformat(), f"{d.year}", d))
            y += interval
    return out


def scope_entity_ids(db: Session, a: ControlActivity) -> list[int]:
    active = [
        e.id for e in db.scalars(select(Entity).where(Entity.is_active.is_(True)).order_by(Entity.sort_order))
    ]
    if a.entity_scope == "list":
        wanted = set(a.entity_ids or [])
        return [e for e in active if e in wanted]
    return active


def _untouched(o: ControlOccurrence, linked: set[int]) -> bool:
    return (
        o.status == "planned"
        and not o.performed_at
        and not o.result
        and not o.notes
        and not o.action_item_id
        and o.id not in linked
    )


def generate_occurrences(
    db: Session, a: ControlActivity, horizon_months: int = HORIZON_MONTHS, ref: date | None = None
) -> tuple[int, int]:
    """Create the occurrences due from today up to the horizon; remove future planned ones that no longer fit the
    schedule or scope (only if nothing was recorded on them). Idempotent. Returns (created, removed)."""
    start = ref or today()
    end = add_months(start, horizon_months)
    existing = db.scalars(
        select(ControlOccurrence).where(
            ControlOccurrence.activity_id == a.id, ControlOccurrence.due_date >= start
        )
    ).all()
    wanted: set[tuple[int, str]] = set()
    plan: list[tuple[int, Period]] = []
    if a.active:
        ents = scope_entity_ids(db, a)
        for p in periods(a, start, end):
            for eid in ents:
                wanted.add((eid, p.key))
                plan.append((eid, p))
    linked = set(
        db.scalars(select(DocumentLink.target_id).where(DocumentLink.target_type == "control_occurrence"))
    )
    removed = 0
    have: set[tuple[int, str]] = set()
    for o in existing:
        if (o.entity_id, o.period_key) not in wanted and _untouched(o, linked):
            db.delete(o)
            removed += 1
        else:
            have.add((o.entity_id, o.period_key))
    # also skip keys that exist with an earlier due date (e.g. overdue occurrence of the same period)
    keys = {p.key for _, p in plan}
    if keys:
        for eid, key in db.execute(
            select(ControlOccurrence.entity_id, ControlOccurrence.period_key).where(
                ControlOccurrence.activity_id == a.id, ControlOccurrence.period_key.in_(keys)
            )
        ):
            have.add((eid, key))
    created = 0
    for eid, p in plan:
        if (eid, p.key) in have:
            continue
        db.add(
            ControlOccurrence(
                activity_id=a.id,
                entity_id=eid,
                period_key=p.key,
                period_label=p.label,
                due_date=p.due,
                status="planned",
            )
        )
        have.add((eid, p.key))
        created += 1
    db.flush()
    return created, removed


def effective_status(o: ControlOccurrence, ref: date | None = None) -> str:
    if o.status == "planned" and o.due_date < (ref or today()):
        return "overdue"
    return o.status
