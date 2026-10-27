"""Deadline computation for report tracks, recurring-incident detection (IR Art. 4) and helpers shared with the
core incident router (app/api/incidents.py)."""

import calendar
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Principal
from app.db import utcnow
from app.features.incident_reporting.criteria import STAGE_LABELS, stage_specs
from app.features.incident_reporting.models import (
    ROOT_CAUSE_CATEGORIES,
    IncidentProfile,
    ReportStage,
    ReportTrack,
)
from app.models import Entity, Incident

DUE_SOON_HOURS = 24
HANDLED = ("Resolved", "Closed")


def add_month(dt: datetime) -> datetime:
    y, m = (dt.year + 1, 1) if dt.month == 12 else (dt.year, dt.month + 1)
    return dt.replace(year=y, month=m, day=min(dt.day, calendar.monthrange(y, m)[1]))


def financial_threshold(entity: Entity | None) -> tuple[float, bool]:
    """IR Art. 3(1)(a): EUR 500,000 or 5 % of the preceding year's turnover, whichever is lower.
    Returns (threshold, turnover_known)."""
    if entity and entity.annual_turnover_meur:
        return min(500_000.0, entity.annual_turnover_meur * 1_000_000 * 0.05), True
    return 500_000.0, False


def get_profile(db: Session, incident_id: int) -> IncidentProfile | None:
    return db.scalar(select(IncidentProfile).where(IncidentProfile.incident_id == incident_id))


def ensure_profile(db: Session, incident: Incident) -> IncidentProfile:
    p = get_profile(db, incident.id)
    if p is None:
        p = IncidentProfile(
            incident_id=incident.id, affected_entity_ids=[incident.entity_id] if incident.entity_id else []
        )
        db.add(p)
        db.flush()
    return p


def sync_handled(db: Session, incident: Incident) -> None:
    """Record when the incident was handled (Resolved/Closed); needed for the final-report deadline after a progress
    report (§ 32(2) BSIG, Cbw Art. 29(2))."""
    p = get_profile(db, incident.id)
    if incident.status in HANDLED:
        if p is None:
            p = ensure_profile(db, incident)
        if p.handled_at is None:
            p.handled_at = utcnow()
    elif p is not None and p.handled_at is not None:
        p.handled_at = None


def _stage_state(due: datetime | None, submitted: datetime | None, now: datetime) -> str:
    if submitted:
        return "submitted"
    if due is None:
        return "waiting"
    if due < now:
        return "overdue"
    if (due - now).total_seconds() < DUE_SOON_HOURS * 3600:
        return "due_soon"
    return "pending"


def compute_track(
    t: ReportTrack,
    incident: Incident,
    stages: list[ReportStage],
    profile: IncidentProfile | None,
    now: datetime | None = None,
) -> dict:
    """Stages of a track with due dates, state and checklist."""
    now = now or utcnow()
    specs = stage_specs(t.regime, t.jurisdiction)
    rec = {s.stage: s for s in stages}
    aware = t.aware_at or incident.aware_at
    handled = profile.handled_at if profile else None
    if handled is None and incident.status in HANDLED:
        handled = incident.updated_at
    out: list[dict] = []

    def row(key: str, due: datetime | None, note: str | None = None, applicable: bool = True) -> dict:
        s = rec.get(key)
        spec = specs[key]
        submitted = s.submitted_at if s else None
        checked = (s.checklist or {}) if s else {}
        return {
            "stage": key,
            "label": "Breach notification" if t.regime == "gdpr" else STAGE_LABELS[key],
            "window": spec["window"],
            "ref": spec["ref"],
            "due_at": due,
            "submitted_at": submitted,
            "reference": s.reference if s else None,
            "note": s.note if s else None,
            "requested_at": s.requested_at if s else None,
            "state": _stage_state(due, submitted, now) if applicable else "not_required",
            "hours_left": round((due - now).total_seconds() / 3600, 1) if due and not submitted else None,
            "checklist": [{"key": k, "label": lbl, "done": bool(checked.get(k))} for k, lbl in spec["items"]],
            "info": note,
        }

    ew_due = aware + timedelta(hours=24) if aware else None
    nt_due = aware + timedelta(hours=72) if aware else None
    if "early_warning" in specs:
        out.append(row("early_warning", ew_due))
    nt_row = row("notification", nt_due)
    out.append(nt_row)
    if "intermediate" in specs:
        s = rec.get("intermediate")
        if s and (s.requested_at or s.submitted_at):
            out.append(row("intermediate", s.due_override, "Requested by the authority"))
    if "final" in specs:
        base = nt_row["submitted_at"] or nt_due
        final_due = add_month(base) if base else None
        prog = rec.get("progress")
        progress_needed = (
            "progress" in specs
            and final_due is not None
            and (
                (prog is not None and prog.submitted_at is not None)
                or (handled is None and now >= final_due)
                or (handled is not None and handled > final_due)
            )
        )
        if progress_needed:
            out.append(
                row("progress", final_due, "The incident was still ongoing when the final report was due.")
            )
            if handled:
                note = (
                    "Due one month after the incident was handled."
                    if t.jurisdiction == "NL" or t.regime != "nis2"
                    else "§ 32(2) BSIG: after the incident has been fully handled; one month is used as the target."
                )
                out.append(row("final", add_month(handled), note))
            else:
                out.append(
                    row("final", None, "Due once the incident has been handled (set the status to Resolved).")
                )
        else:
            note = (
                "If the incident is still ongoing on this date, submit a progress report instead."
                if "progress" in specs
                else None
            )
            out.append(row("final", final_due, note))
    open_rows = [r for r in out if r["state"] in ("overdue", "due_soon", "pending")]
    nxt = min(open_rows, key=lambda r: r["due_at"]) if open_rows else None
    return {
        "id": t.id,
        "incident_id": t.incident_id,
        "regime": t.regime,
        "jurisdiction": t.jurisdiction,
        "entity": {
            "id": t.entity.id,
            "code": t.entity.code,
            "name": t.entity.name,
            "country": t.entity.country,
        },
        "authority": t.authority,
        "reference": t.reference,
        "aware_at": t.aware_at,
        "effective_aware_at": aware,
        "status": t.status,
        "notes": t.notes,
        "stages": out,
        "next": {"stage": nxt["stage"], "label": nxt["label"], "due_at": nxt["due_at"], "state": nxt["state"]}
        if nxt
        else None,
        "complete": bool(out) and all(r["state"] in ("submitted", "not_required") for r in out),
    }


def tracks_for(db: Session, incidents: list[Incident]) -> dict[int, list[dict]]:
    """Computed tracks per incident id (two queries for any number of incidents)."""
    ids = [i.id for i in incidents]
    if not ids:
        return {}
    tracks = db.scalars(
        select(ReportTrack).where(ReportTrack.incident_id.in_(ids)).order_by(ReportTrack.id)
    ).all()
    stages: dict[int, list[ReportStage]] = defaultdict(list)
    if tracks:
        for s in db.scalars(select(ReportStage).where(ReportStage.track_id.in_([t.id for t in tracks]))):
            stages[s.track_id].append(s)
    profiles = {
        p.incident_id: p
        for p in db.scalars(select(IncidentProfile).where(IncidentProfile.incident_id.in_(ids)))
    }
    by_id = {i.id: i for i in incidents}
    now = utcnow()
    out: dict[int, list[dict]] = defaultdict(list)
    for t in tracks:
        out[t.incident_id].append(
            compute_track(t, by_id[t.incident_id], stages[t.id], profiles.get(t.incident_id), now)
        )
    return out


def next_deadline(tracks: list[dict]) -> dict | None:
    cands = [
        dict(
            t["next"],
            track_id=t["id"],
            entity_code=t["entity"]["code"],
            authority=t["authority"],
            regime=t["regime"],
        )
        for t in tracks
        if t["status"] == "active" and t["next"]
    ]
    return min(cands, key=lambda c: c["due_at"]) if cands else None


def mirror_legacy(db: Session, incident: Incident) -> None:
    """Keep the core incident's single reporting clock in step with its primary NIS-2 track."""
    tracks = db.scalars(
        select(ReportTrack)
        .where(
            ReportTrack.incident_id == incident.id,
            ReportTrack.regime == "nis2",
            ReportTrack.status == "active",
        )
        .order_by(ReportTrack.id)
    ).all()
    if not tracks:
        return
    primary = next((t for t in tracks if t.entity_id == incident.entity_id), tracks[0])
    rec = {s.stage: s for s in db.scalars(select(ReportStage).where(ReportStage.track_id == primary.id))}
    mapping = {
        "early_warning": "early_warning_at",
        "notification": "notification_at",
        "intermediate": "intermediate_report_at",
        "final": "final_report_at",
    }
    for stage, field in mapping.items():
        s = rec.get(stage)
        setattr(incident, field, s.submitted_at if s else None)
    if not incident.authority:
        incident.authority = primary.authority
    if primary.reference and not incident.authority_reference:
        incident.authority_reference = primary.reference


def incident_time(i: Incident) -> datetime:
    return i.aware_at or i.detected_at or i.created_at


def recurring_for(db: Session, incident: Incident, pr: Principal) -> dict | None:
    """IR Art. 4: incidents of the same entity with the same root cause category within 6 months.
    Only incidents the caller may read are considered (no disclosure of other entities' incidents)."""
    p = get_profile(db, incident.id)
    if not p or not p.root_cause_category or p.root_cause_category == "other":
        return None
    ents = set(p.affected_entity_ids or []) | ({incident.entity_id} if incident.entity_id else set())
    if not ents:
        return None
    t0 = incident_time(incident)
    window = timedelta(days=183)
    rows = db.execute(
        select(Incident, IncidentProfile)
        .join(IncidentProfile, IncidentProfile.incident_id == Incident.id)
        .where(IncidentProfile.root_cause_category == p.root_cause_category)
    ).all()
    related = []
    for inc, prof in rows:
        if not pr.can_read("incidents.read", inc.entity_id):
            continue
        other_ents = set(prof.affected_entity_ids or []) | ({inc.entity_id} if inc.entity_id else set())
        if not other_ents & ents:
            continue
        if abs(incident_time(inc) - t0) <= window:
            related.append((inc, prof))
    if len(related) < 2:
        return None
    related.sort(key=lambda r: incident_time(r[0]))
    loss = sum(prof.financial_loss_eur or 0 for _, prof in related)
    ent = db.get(Entity, incident.entity_id) if incident.entity_id else None
    threshold, known = financial_threshold(ent)
    return {
        "category": p.root_cause_category,
        "category_label": ROOT_CAUSE_CATEGORIES.get(p.root_cause_category),
        "count": len(related),
        "window_days": 183,
        "combined_loss_eur": loss,
        "threshold_eur": threshold,
        "turnover_known": known,
        "meets_financial_criterion": loss > threshold,
        "incidents": [
            {
                "id": i.id,
                "code": i.code,
                "title": i.title,
                "at": incident_time(i),
                "is_significant": i.is_significant,
                "financial_loss_eur": pr.financial_loss_eur,
            }
            for i, pr in related
        ],
    }
