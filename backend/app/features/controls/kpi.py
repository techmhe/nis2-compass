"""KPI periods, built-in computations from existing data and status against target.

Percentages are stored as 0-100 values. Computations take the entity (None = whole group) and the period
[start, end]; "snapshot" computations describe the state at the time of computing and are only recorded for the
current period, "period" computations can be recomputed for any past period.
"""

import calendar
from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from statistics import mean

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.features.controls.models import ControlOccurrence, MetricDefinition, MetricInstance, MetricValue
from app.models import ActionItem, Answer, Assessment, AssessmentRound, Document, Entity, Incident
from app.services.scoring import due_status
from app.services.stats import assessment_stats

# --- periods ------------------------------------------------------------------------------------------------


def period_of(freq: str, d: date) -> str:
    if freq == "monthly":
        return f"{d.year}-{d.month:02d}"
    if freq == "annual":
        return f"{d.year}"
    return f"{d.year}-Q{(d.month - 1) // 3 + 1}"


def period_bounds(key: str) -> tuple[date, date]:
    if "-Q" in key:
        y, q = key.split("-Q")
        m0 = (int(q) - 1) * 3 + 1
        return date(int(y), m0, 1), date(int(y), m0 + 2, calendar.monthrange(int(y), m0 + 2)[1])
    if "-" in key:
        y, m = key.split("-")
        return date(int(y), int(m), 1), date(int(y), int(m), calendar.monthrange(int(y), int(m))[1])
    return date(int(key), 1, 1), date(int(key), 12, 31)


def valid_period(freq: str, key: str) -> bool:
    try:
        start, _ = period_bounds(key)
    except (ValueError, TypeError):
        return False
    return period_of(freq, start) == key and 2000 <= start.year <= 2100


def recent_periods(freq: str, ref: date, n: int) -> list[str]:
    """The n periods up to and including the one containing ref, oldest first."""
    out: list[str] = []
    d = ref
    while len(out) < n:
        k = period_of(freq, d)
        if not out or out[-1] != k:
            out.append(k)
        d = period_bounds(k)[0] - timedelta(days=1)
    return list(reversed(out))


def period_label(key: str) -> str:
    if "-Q" in key:
        y, q = key.split("-Q")
        return f"Q{q} {y}"
    if "-" in key:
        y, m = key.split("-")
        return f"{calendar.month_abbr[int(m)]} {y}"
    return key


# --- computations ---------------------------------------------------------------------------------------------


def _current_answers(db: Session, entity_id: int | None) -> list[Answer]:
    rnd = db.scalar(
        select(AssessmentRound)
        .where(AssessmentRound.is_current.is_(True))
        .order_by(AssessmentRound.id.desc())
    )
    if not rnd:
        return []
    stmt = select(Answer).join(Assessment).where(Assessment.round_id == rnd.id)
    if entity_id is not None:
        stmt = stmt.where(Assessment.entity_id == entity_id)
    return list(db.scalars(stmt))


def _coverage(db: Session, entity_id: int | None, start: date, end: date) -> float | None:
    s = assessment_stats(_current_answers(db, entity_id))
    return None if s["coverage"] is None else round(s["coverage"] * 100, 1)


def _average_score(db: Session, entity_id: int | None, start: date, end: date) -> float | None:
    s = assessment_stats(_current_answers(db, entity_id))
    return None if s["average_score"] is None else round(s["average_score"] * 100, 1)


def _overdue_actions(db: Session, entity_id: int | None, start: date, end: date) -> float | None:
    stmt = select(ActionItem)
    if entity_id is not None:
        stmt = stmt.where(ActionItem.entity_id == entity_id)
    today = utcnow().date()
    return float(sum(1 for a in db.scalars(stmt) if due_status(a.target_date, a.status, today) == "Overdue"))


def _controls_on_time(db: Session, entity_id: int | None, start: date, end: date) -> float | None:
    today = utcnow().date()
    stmt = select(ControlOccurrence).where(
        ControlOccurrence.due_date >= start,
        ControlOccurrence.due_date <= min(end, today),
        ControlOccurrence.status != "skipped",
    )
    if entity_id is not None:
        stmt = stmt.where(ControlOccurrence.entity_id == entity_id)
    occ = list(db.scalars(stmt))
    if not occ:
        return None
    on_time = sum(1 for o in occ if o.status == "done" and o.performed_at and o.performed_at <= o.due_date)
    return round(on_time / len(occ) * 100, 1)


def _incident_entities(db: Session, incidents: list[Incident]) -> dict[int, set[int]]:
    from app.features.incident_reporting.models import IncidentProfile

    ids = [i.id for i in incidents]
    prof = (
        {
            p.incident_id: p
            for p in db.scalars(select(IncidentProfile).where(IncidentProfile.incident_id.in_(ids)))
        }
        if ids
        else {}
    )
    out = {}
    for i in incidents:
        ents = set(prof[i.id].affected_entity_ids or []) if i.id in prof else set()
        if i.entity_id:
            ents.add(i.entity_id)
        out[i.id] = ents
    return out


def _incidents_in(
    db: Session, entity_id: int | None, start: date, end: date, significant_only: bool = False
) -> list[Incident]:
    lo = datetime.combine(start, time.min, tzinfo=UTC)
    hi = datetime.combine(end, time.max, tzinfo=UTC)
    rows = [
        i for i in db.scalars(select(Incident)) if lo <= (i.aware_at or i.detected_at or i.created_at) <= hi
    ]
    if significant_only:
        rows = [i for i in rows if i.is_significant]
    if entity_id is None:
        return rows
    ents = _incident_entities(db, rows)
    return [i for i in rows if entity_id in ents[i.id]]


def _incident_count(db: Session, entity_id: int | None, start: date, end: date) -> float | None:
    return float(len(_incidents_in(db, entity_id, start, end)))


def _mean_time_to_early_warning(db: Session, entity_id: int | None, start: date, end: date) -> float | None:
    from app.features.incident_reporting.models import ReportStage, ReportTrack

    incs = [i for i in _incidents_in(db, entity_id, start, end, significant_only=True) if i.aware_at]
    hours = []
    for i in incs:
        stmt = (
            select(ReportStage.submitted_at, ReportTrack.aware_at)
            .join(ReportTrack, ReportTrack.id == ReportStage.track_id)
            .where(
                ReportTrack.incident_id == i.id,
                ReportTrack.regime == "nis2",
                ReportStage.stage == "early_warning",
                ReportStage.submitted_at.is_not(None),
            )
        )
        if entity_id is not None:
            stmt = stmt.where(ReportTrack.entity_id == entity_id)
        rows = db.execute(stmt).all()
        if rows:
            hours.extend(((sub - (aw or i.aware_at)).total_seconds() / 3600) for sub, aw in rows)
        elif i.early_warning_at:
            hours.append((i.early_warning_at - i.aware_at).total_seconds() / 3600)
    return round(mean(hours), 1) if hours else None


def _docs_past_review(db: Session, entity_id: int | None, start: date, end: date) -> float | None:
    stmt = select(Document).where(Document.status != "Retired", Document.next_review_date.is_not(None))
    if entity_id is not None:
        stmt = stmt.where(Document.entity_id == entity_id)
    docs = list(db.scalars(stmt))
    if not docs:
        return None
    today = utcnow().date()
    return round(sum(1 for d in docs if d.next_review_date < today) / len(docs) * 100, 1)


# key -> (label, function, snapshot)
COMPUTATIONS: dict[str, tuple[str, Callable, bool]] = {
    "assessment_coverage": ("Share of in-scope requirements assessed in the current round", _coverage, True),
    "average_score": ("Average answer score in the current round", _average_score, True),
    "overdue_actions": ("Action plan items past their target date", _overdue_actions, True),
    "controls_on_time": (
        "Control occurrences due in the period that were performed by their due date",
        _controls_on_time,
        False,
    ),
    "incident_count": ("Incidents recorded in the period (by time of awareness)", _incident_count, False),
    "mean_time_to_early_warning": (
        "Mean hours from awareness to NIS-2 early warning, significant incidents",
        _mean_time_to_early_warning,
        False,
    ),
    "docs_past_review": ("Share of documents with a review date that are past it", _docs_past_review, True),
}


def compute(db: Session, key: str, entity_id: int | None, period: str) -> float | None:
    start, end = period_bounds(period)
    return COMPUTATIONS[key][1](db, entity_id, start, end)


def upsert_value(
    db: Session,
    inst: MetricInstance,
    period: str,
    value: float,
    source: str,
    note: str | None = None,
    user_id: int | None = None,
) -> MetricValue:
    v = db.scalar(select(MetricValue).where(MetricValue.instance_id == inst.id, MetricValue.period == period))
    if v is None:
        v = MetricValue(
            instance_id=inst.id,
            period=period,
            period_end=period_bounds(period)[1],
            value=value,
            source=source,
            note=note,
            recorded_by_id=user_id,
        )
        db.add(v)
    else:
        v.value, v.source, v.recorded_by_id = value, source, user_id
        if note is not None:
            v.note = note
    return v


def refresh_computed(db: Session, ref: date | None = None) -> int:
    """Recompute computed KPIs for the current period (and the previous one for period-based computations)."""
    ref = ref or utcnow().date()
    n = 0
    for inst in db.scalars(
        select(MetricInstance)
        .join(MetricDefinition)
        .where(MetricDefinition.active.is_(True), MetricDefinition.computation.is_not(None))
    ):
        d = inst.definition
        if d.computation not in COMPUTATIONS:
            continue
        snapshot = COMPUTATIONS[d.computation][2]
        keys = recent_periods(d.frequency, ref, 1 if snapshot else 2)
        for k in keys:
            val = compute(db, d.computation, inst.entity_id, k)
            if val is None:
                continue
            upsert_value(db, inst, k, val, "computed")
            n += 1
    db.flush()
    return n


def ensure_instances(db: Session, d: MetricDefinition) -> int:
    """Create the group instance and one instance per active entity for a definition (idempotent)."""
    have = set(db.scalars(select(MetricInstance.entity_id).where(MetricInstance.definition_id == d.id)))
    n = 0
    for eid in [
        None,
        *db.scalars(select(Entity.id).where(Entity.is_active.is_(True)).order_by(Entity.sort_order)),
    ]:
        if eid not in have:
            db.add(MetricInstance(definition_id=d.id, entity_id=eid, target=d.default_target))
            n += 1
    db.flush()
    return n


def status_of(direction: str, value: float | None, target: float | None) -> str:
    if value is None:
        return "no_data"
    if target is None:
        return "no_target"
    ok = value >= target if direction == "higher" else value <= target
    return "met" if ok else "missed"


def is_stale(freq: str, latest_period: str | None, ref: date | None = None) -> bool:
    """No value for the last completed period (nor the current one)."""
    if latest_period is None:
        return True
    ref = ref or utcnow().date()
    prev = recent_periods(freq, ref, 2)[0]
    return period_bounds(latest_period)[1] < period_bounds(prev)[1]
