"""Incident register with the NIS2 Art. 23 / § 32 BSIG / Cbw reporting clock.

Deadlines: early warning 24 h after becoming aware, incident notification 72 h after becoming aware,
final report one month after the incident notification (Art. 23(4)(d) NIS2)."""

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import cleanup_target, doc_links_for, get_or_404, next_code
from app.core.deps import Principal, get_principal, require
from app.db import get_db, utcnow
from app.features.incident_reporting.service import mirror_legacy, next_deadline, sync_handled, tracks_for
from app.models import Incident, User
from app.schemas.common import EntityBrief, Ok
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object, remove_object

router = APIRouter(prefix="/incidents", tags=["incidents"])


def _add_month(dt: datetime) -> datetime:
    month = dt.month % 12 + 1
    year = dt.year + (dt.month == 12)
    day = min(
        dt.day,
        [
            31,
            29 if year % 4 == 0 and (year % 100 or year % 400 == 0) else 28,
            31,
            30,
            31,
            30,
            31,
            31,
            30,
            31,
            30,
            31,
        ][month - 1],
    )
    return dt.replace(year=year, month=month, day=day)


def reporting_clock(i: Incident) -> list[dict]:
    if not i.is_significant or not i.aware_at:
        return []
    now = utcnow()
    steps = [
        ("early_warning", "Early warning (24 h)", i.aware_at + timedelta(hours=24), i.early_warning_at),
        ("notification", "Incident notification (72 h)", i.aware_at + timedelta(hours=72), i.notification_at),
    ]
    final_due = (
        _add_month(i.notification_at) if i.notification_at else _add_month(i.aware_at + timedelta(hours=72))
    )
    steps.append(("final_report", "Final report (1 month)", final_due, i.final_report_at))
    out = []
    for key, label, due, done in steps:
        state = "done" if done else ("overdue" if now > due else "pending")
        out.append(
            {
                "key": key,
                "label": label,
                "due": due,
                "done_at": done,
                "state": state,
                "hours_left": None if done else round((due - now).total_seconds() / 3600, 1),
            }
        )
    return out


class IncidentOut(BaseModel):
    id: int
    code: str
    entity: EntityBrief | None
    title: str
    description: str | None
    category: str | None
    severity: str
    status: str
    is_significant: bool | None
    significance_rationale: str | None
    detected_at: datetime | None
    aware_at: datetime | None
    early_warning_at: datetime | None
    notification_at: datetime | None
    intermediate_report_at: datetime | None
    final_report_at: datetime | None
    authority: str | None
    authority_reference: str | None
    suspected_malicious: bool | None
    cross_border_impact: bool | None
    impact: str | None
    indicators_of_compromise: str | None
    root_cause: str | None
    measures: str | None
    lessons_learned: str | None
    handler_id: int | None
    handler_name: str | None
    timeline: list
    reporting: list[dict]
    # per-entity report tracks (features/incident_reporting): number of active tracks and the next open deadline
    track_count: int = 0
    next_deadline: dict | None = None
    created_at: datetime
    updated_at: datetime


def out(db: Session, i: Incident, tracks: list[dict] | None = None) -> IncidentOut:
    handler = db.get(User, i.handler_id) if i.handler_id else None
    if tracks is None:
        tracks = tracks_for(db, [i]).get(i.id, [])
    active = [t for t in tracks if t["status"] == "active"]
    return IncidentOut(
        **{k: getattr(i, k) for k in IncidentOut.model_fields if hasattr(i, k) and k not in ("entity",)},
        entity=EntityBrief.model_validate(i.entity) if i.entity else None,
        handler_name=handler.display_name if handler else None,
        reporting=reporting_clock(i),
        track_count=len(active),
        next_deadline=next_deadline(active),
    )


class IncidentIn(BaseModel):
    entity_id: int | None = None
    title: str = Field(min_length=1, max_length=400)
    description: str | None = None
    category: str | None = Field(default=None, max_length=100)
    severity: Literal["Low", "Medium", "High", "Critical"] = "Medium"
    status: Literal["Open", "Contained", "Resolved", "Closed"] = "Open"
    is_significant: bool | None = None
    significance_rationale: str | None = None
    detected_at: datetime | None = None
    aware_at: datetime | None = None
    early_warning_at: datetime | None = None
    notification_at: datetime | None = None
    intermediate_report_at: datetime | None = None
    final_report_at: datetime | None = None
    authority: str | None = None
    authority_reference: str | None = None
    suspected_malicious: bool | None = None
    cross_border_impact: bool | None = None
    impact: str | None = None
    indicators_of_compromise: str | None = None
    root_cause: str | None = None
    measures: str | None = None
    lessons_learned: str | None = None
    handler_id: int | None = None

    @model_validator(mode="after")
    def _plausible_times(self):
        # bounded to avoid date overflow in the deadline arithmetic (e.g. year 9999 + 72 h)
        for k in (
            "detected_at",
            "aware_at",
            "early_warning_at",
            "notification_at",
            "intermediate_report_at",
            "final_report_at",
        ):
            v = getattr(self, k)
            if v is not None and not 1990 <= v.year <= 2100:
                raise ValueError(f"{k} must lie between 1990 and 2100")
        return self


@router.get("", response_model=list[IncidentOut])
def list_incidents(pr: Principal = Depends(require("incidents.read")), db: Session = Depends(get_db)):
    rows = [
        i
        for i in db.scalars(select(Incident).order_by(Incident.id.desc())).all()
        if pr.can_read("incidents.read", i.entity_id)
    ]
    tracks = tracks_for(db, rows)
    return [out(db, i, tracks.get(i.id, [])) for i in rows]


@router.post("", response_model=IncidentOut)
def create_incident(body: IncidentIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr.ensure("incidents.manage", body.entity_id, write=body.entity_id is None)
    i = Incident(
        code=next_code(db, Incident.code, "INC-"),
        **body.model_dump(),
        timeline=[{"at": utcnow().isoformat(), "text": "Incident recorded", "by": pr.user.display_name}],
    )
    db.add(i)
    db.flush()
    sync_handled(db, i)
    audit(db, pr, "create", "incident", i.id, i.code, entity_id=i.entity_id)
    db.commit()
    index_object(db, "incident", i.id)
    return out(db, i)


@router.get("/{incident_id}")
def get_incident(
    incident_id: int, pr: Principal = Depends(require("incidents.read")), db: Session = Depends(get_db)
):
    i = get_or_404(db, Incident, incident_id)
    pr.ensure("incidents.read", i.entity_id)
    return {
        "incident": out(db, i),
        "documents": doc_links_for(db, pr, "incident", i.id),
        "can_edit": pr.can_write("incidents.manage", i.entity_id),
    }


@router.put("/{incident_id}", response_model=IncidentOut)
def update_incident(
    incident_id: int, body: IncidentIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    i = get_or_404(db, Incident, incident_id)
    pr.ensure("incidents.manage", i.entity_id, write=True)
    pr.ensure("incidents.manage", body.entity_id, write=True)
    diff = apply_changes(i, body.model_dump())
    if diff:
        labels = {
            "status": "Status",
            "early_warning_at": "Early warning sent",
            "notification_at": "Notification sent",
            "final_report_at": "Final report sent",
            "is_significant": "Significance",
            "severity": "Severity",
        }
        notes = [f"{labels[k]}: {v[1]}" for k, v in diff.items() if k in labels]
        if notes:
            i.timeline = [
                *(i.timeline or []),
                {"at": utcnow().isoformat(), "text": "; ".join(notes), "by": pr.user.display_name},
            ]
    if "status" in diff:
        sync_handled(db, i)
    if diff.keys() & {"early_warning_at", "notification_at", "intermediate_report_at", "final_report_at"}:
        mirror_legacy(db, i)  # report tracks are authoritative once they exist
    audit(db, pr, "update", "incident", i.id, i.code, entity_id=i.entity_id, details=diff)
    db.commit()
    index_object(db, "incident", i.id)
    return out(db, i)


class TimelineIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    at: datetime | None = None


@router.post("/{incident_id}/timeline", response_model=IncidentOut)
def add_timeline(
    incident_id: int, body: TimelineIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    i = get_or_404(db, Incident, incident_id)
    pr.ensure("incidents.manage", i.entity_id, write=True)
    i.timeline = sorted(
        [
            *(i.timeline or []),
            {"at": (body.at or utcnow()).isoformat(), "text": body.text, "by": pr.user.display_name},
        ],
        key=lambda e: e["at"],
    )
    db.commit()
    return out(db, i)


@router.delete("/{incident_id}", response_model=Ok)
def delete_incident(incident_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    i = get_or_404(db, Incident, incident_id)
    pr.ensure("incidents.manage", i.entity_id, write=True)
    if i.is_significant:
        raise HTTPException(400, "Significant incidents cannot be deleted (reporting record)")
    audit(db, pr, "delete", "incident", i.id, i.code, entity_id=i.entity_id)
    cleanup_target(db, "incident", i.id)
    db.delete(i)
    db.commit()
    remove_object(db, "incident", incident_id)
    return Ok()
