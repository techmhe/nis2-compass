"""Management body register: members, decisions, training records, training rules and the status matrix
(§ 38 BSIG, Cbw Art. 24, Cbb Art. 22)."""

from datetime import date, time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import cleanup_target, doc_links_for, entity_ref, get_or_404, next_code
from app.core.deps import Principal, get_principal, require
from app.db import get_db
from app.features.governance.logic import (
    governance_managers,
    is_active_member,
    member_training_status,
    sync_training_obligation,
    training_rule_for,
)
from app.features.governance.models import (
    BoardDecision,
    BoardMember,
    Obligation,
    TrainingRecord,
    TrainingRule,
)
from app.features.governance.validation import BoundedDate, merge_update, partial_model, user_can_read_gov
from app.models import Entity, User
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object, remove_object
from app.services.notify import notify

router = APIRouter()


def _uname(db: Session, uid: int | None) -> str | None:
    u = db.get(User, uid) if uid else None
    return u.display_name if u else None


# --------------------------------------------------------------------------- members


def member_out(
    db: Session, m: BoardMember, pr: Principal, trainings: list[TrainingRecord] | None = None
) -> dict:
    if trainings is None:
        trainings = list(db.scalars(select(TrainingRecord)))
    rule = training_rule_for(db, m.entity)
    return {
        "id": m.id,
        "entity": entity_ref(m.entity),
        "entity_id": m.entity_id,
        "name": m.name,
        "function": m.function,
        "user_id": m.user_id,
        "user_name": _uname(db, m.user_id),
        "email": m.email,
        "appointed_at": m.appointed_at,
        "left_at": m.left_at,
        "notes": m.notes,
        "active": is_active_member(m),
        "training": member_training_status(m, rule, trainings),
        "rule_id": rule.id if rule else None,
        "can_edit": pr.can_write("governance.manage", m.entity_id),
    }


class MemberIn(BaseModel):
    entity_id: int
    name: str = Field(min_length=1, max_length=200)
    function: str | None = Field(default=None, max_length=200)
    user_id: int | None = None
    email: str | None = Field(default=None, max_length=320)
    appointed_at: BoundedDate | None = None
    left_at: BoundedDate | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _dates(self):
        if self.appointed_at and self.left_at and self.left_at < self.appointed_at:
            raise ValueError("The leaving date cannot be before the appointment date")
        return self


MemberPatch = partial_model(MemberIn, "MemberPatch")


def _check_member_user(db: Session, user_id: int | None) -> None:
    if user_id:
        get_or_404(db, User, user_id, "User")


@router.get("/board-members")
def list_members(
    entity_id: int | None = None,
    include_former: bool = True,
    pr: Principal = Depends(require("governance.read")),
    db: Session = Depends(get_db),
):
    stmt = select(BoardMember).order_by(BoardMember.entity_id, BoardMember.appointed_at, BoardMember.id)
    if entity_id:
        stmt = stmt.where(BoardMember.entity_id == entity_id)
    trainings = list(db.scalars(select(TrainingRecord)))
    return [
        member_out(db, m, pr, trainings)
        for m in db.scalars(stmt)
        if pr.can_read("governance.read", m.entity_id) and (include_former or is_active_member(m))
    ]


@router.post("/board-members")
def create_member(body: MemberIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    e = get_or_404(db, Entity, body.entity_id, "Entity")
    pr.ensure("governance.manage", e.id, write=True)
    _check_member_user(db, body.user_id)
    m = BoardMember(**body.model_dump())
    db.add(m)
    db.flush()
    ob = sync_training_obligation(db, m, actor_id=pr.id)
    audit(db, pr, "create", "board_member", m.id, f"{e.code} {m.name}", entity_id=e.id)
    if ob:
        msg = f"New management body member {m.name} ({e.code}): training due by {ob.due_date.isoformat()}"
        recipients = set(governance_managers(db, e.id))
        if user_can_read_gov(db, m.user_id, e.id):
            recipients.add(m.user_id)
        for uid in recipients:
            notify(db, uid, "board_training", msg, f"/governance/management?member={m.id}", actor_id=pr.id)
    db.commit()
    return member_out(db, m, pr)


@router.put("/board-members/{member_id}")
@router.patch("/board-members/{member_id}")
def update_member(
    member_id: int, body: MemberPatch, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    m = get_or_404(db, BoardMember, member_id, "Board member")
    pr.ensure("governance.manage", m.entity_id, write=True)
    merged = merge_update(m, body, MemberIn)
    pr.ensure("governance.manage", merged.entity_id, write=True)
    get_or_404(db, Entity, merged.entity_id, "Entity")
    _check_member_user(db, merged.user_id)
    diff = apply_changes(m, merged.model_dump())
    db.flush()
    sync_training_obligation(db, m, actor_id=pr.id)
    audit(db, pr, "update", "board_member", m.id, m.name, entity_id=m.entity_id, details=diff)
    db.commit()
    db.refresh(m)
    return member_out(db, m, pr)


@router.delete("/board-members/{member_id}")
def delete_member(member_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    m = get_or_404(db, BoardMember, member_id, "Board member")
    pr.ensure("governance.manage", m.entity_id, write=True)
    for o in db.scalars(
        select(Obligation).where(
            Obligation.source_type == "board_member",
            Obligation.source_id == m.id,
            Obligation.status == "open",
        )
    ):
        db.delete(o)
    for t in db.scalars(select(TrainingRecord)):
        if m.id in (t.board_member_ids or []):
            t.board_member_ids = [x for x in t.board_member_ids if x != m.id]
    audit(db, pr, "delete", "board_member", m.id, m.name, entity_id=m.entity_id)
    db.delete(m)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- decisions


def decision_out(db: Session, d: BoardDecision, pr: Principal, detail: bool = False) -> dict:
    out = {
        "id": d.id,
        "code": d.code,
        "entity": entity_ref(d.entity),
        "entity_id": d.entity_id,
        "decided_on": d.decided_on,
        "decision_type": d.decision_type,
        "subject": d.subject,
        "description": d.description,
        "participants": d.participants,
        "linked": d.linked or [],
        "created_by": _uname(db, d.created_by_id),
        "created_at": d.created_at,
        "can_edit": pr.can_write("governance.manage", d.entity_id),
    }
    if detail:
        out["documents"] = doc_links_for(db, pr, "board_decision", d.id)
    return out


class LinkedRef(BaseModel):
    type: str = Field(max_length=40)
    id: int | None = None
    label: str = Field(min_length=1, max_length=300)
    # internal app path only: no scheme, no protocol-relative '//' or backslash tricks, no whitespace
    url: str | None = Field(default=None, max_length=400, pattern=r"^/([^/\\\s][^\s\\]*)?$")


class DecisionIn(BaseModel):
    entity_id: int
    decided_on: BoundedDate
    decision_type: Literal[
        "approve_measures", "approve_policy", "accept_risk", "budget", "oversight_review", "other"
    ]
    subject: str = Field(min_length=1, max_length=400)
    description: str | None = None
    participants: str | None = None
    linked: list[LinkedRef] = Field(default_factory=list, max_length=50)
    complete_obligation_id: int | None = None  # e.g. the annual measures approval this decision fulfils

    @model_validator(mode="after")
    def _past(self):
        if self.decided_on > date.today():
            raise ValueError("The decision date cannot be in the future")
        return self


DecisionPatch = partial_model(DecisionIn, "DecisionPatch")


@router.get("/decisions")
def list_decisions(
    entity_id: int | None = None,
    pr: Principal = Depends(require("governance.read")),
    db: Session = Depends(get_db),
):
    stmt = select(BoardDecision).order_by(BoardDecision.decided_on.desc(), BoardDecision.id.desc())
    if entity_id:
        stmt = stmt.where(BoardDecision.entity_id == entity_id)
    return [decision_out(db, d, pr) for d in db.scalars(stmt) if pr.can_read("governance.read", d.entity_id)]


@router.get("/decisions/{decision_id}")
def get_decision(
    decision_id: int, pr: Principal = Depends(require("governance.read")), db: Session = Depends(get_db)
):
    d = get_or_404(db, BoardDecision, decision_id, "Decision")
    pr.ensure("governance.read", d.entity_id)
    return decision_out(db, d, pr, detail=True)


def _complete_linked_obligation(db: Session, pr: Principal, d: BoardDecision, ob_id: int | None) -> None:
    if not ob_id:
        return
    from app.features.governance.logic import next_due

    o = get_or_404(db, Obligation, ob_id, "Obligation")
    if o.entity_id != d.entity_id or o.status != "open":
        raise HTTPException(400, "The obligation must be open and belong to the same entity")
    if o.source_type == "board_member":
        raise HTTPException(
            400, "Training obligations close automatically when a qualifying training is recorded"
        )
    o.status = "done"
    o.completed_at = d.decided_on
    o.completed_by_id = pr.id
    o.completion_note = f"Decision {d.code}: {d.subject}"
    nd = next_due(o.due_date, o.recurrence)
    if nd:
        db.add(
            Obligation(
                entity_id=o.entity_id,
                kind=o.kind,
                title=o.title,
                description=o.description,
                legal_ref=o.legal_ref,
                due_date=nd,
                recurrence=o.recurrence,
                owner_stakeholder_id=o.owner_stakeholder_id,
                owner_user_id=o.owner_user_id,
                source=o.source,
                source_type=o.source_type,
                source_id=o.source_id,
                previous_id=o.id,
            )
        )
    d.linked = [
        *(d.linked or []),
        {
            "type": "obligation",
            "id": o.id,
            "label": o.title,
            "url": f"/governance/obligations?obligation={o.id}",
        },
    ]


@router.post("/decisions")
def create_decision(body: DecisionIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    e = get_or_404(db, Entity, body.entity_id, "Entity")
    pr.ensure("governance.manage", e.id, write=True)
    data = body.model_dump(exclude={"complete_obligation_id"})
    d = BoardDecision(code=next_code(db, BoardDecision.code, "BD-"), created_by_id=pr.id, **data)
    db.add(d)
    db.flush()
    _complete_linked_obligation(db, pr, d, body.complete_obligation_id)
    audit(db, pr, "create", "board_decision", d.id, f"{d.code} {d.subject}", entity_id=e.id)
    db.commit()
    index_object(db, "board_decision", d.id)
    return decision_out(db, d, pr, detail=True)


@router.put("/decisions/{decision_id}")
@router.patch("/decisions/{decision_id}")
def update_decision(
    decision_id: int,
    body: DecisionPatch,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    d = get_or_404(db, BoardDecision, decision_id, "Decision")
    pr.ensure("governance.manage", d.entity_id, write=True)
    merged = merge_update(d, body, DecisionIn, extra_current={"complete_obligation_id": None})
    pr.ensure("governance.manage", merged.entity_id, write=True)
    get_or_404(db, Entity, merged.entity_id, "Entity")
    diff = apply_changes(d, merged.model_dump(exclude={"complete_obligation_id"}))
    _complete_linked_obligation(db, pr, d, merged.complete_obligation_id)
    audit(db, pr, "update", "board_decision", d.id, d.code, entity_id=d.entity_id, details=diff)
    db.commit()
    index_object(db, "board_decision", d.id)
    return decision_out(db, d, pr, detail=True)


@router.delete("/decisions/{decision_id}")
def delete_decision(decision_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    d = get_or_404(db, BoardDecision, decision_id, "Decision")
    pr.ensure("governance.manage", d.entity_id, write=True)
    audit(db, pr, "delete", "board_decision", d.id, d.code, entity_id=d.entity_id)
    cleanup_target(db, "board_decision", d.id)
    db.delete(d)
    db.commit()
    remove_object(db, "board_decision", decision_id)
    return {"ok": True}


# --------------------------------------------------------------------------- trainings


def _training_visible(pr: Principal, t: TrainingRecord, write: bool = False) -> bool:
    ents = t.entity_ids or []
    if not ents:
        return pr.can_write("governance.manage", None) if write else pr.has_any("governance.read")
    if write:
        return all(pr.can_write("governance.manage", e) for e in ents)
    return any(pr.can_read("governance.read", e) for e in ents)


def training_out(db: Session, t: TrainingRecord, pr: Principal, detail: bool = False) -> dict:
    ents = {e.id: e for e in db.scalars(select(Entity).where(Entity.id.in_(t.entity_ids or [])))}
    members = {
        m.id: m for m in db.scalars(select(BoardMember).where(BoardMember.id.in_(t.board_member_ids or [])))
    }
    out = {
        "id": t.id,
        "person_name": t.person_name,
        "person_role": t.person_role,
        "user_id": t.user_id,
        "board_member_ids": t.board_member_ids or [],
        "board_members": [
            {"id": m.id, "name": m.name, "entity_code": m.entity.code} for m in members.values()
        ],
        "entity_ids": t.entity_ids or [],
        "entities": [entity_ref(ents[i]) for i in (t.entity_ids or []) if i in ents],
        "title": t.title,
        "provider": t.provider,
        "delivery": t.delivery,
        "training_date": t.training_date,
        "start_time": t.start_time.strftime("%H:%M") if t.start_time else None,
        "end_time": t.end_time.strftime("%H:%M") if t.end_time else None,
        "duration_minutes": t.duration_minutes,
        "topics": t.topics or [],
        "legal_refs": t.legal_refs or [],
        "has_certificate": t.has_certificate,
        "cert_holder_name": t.cert_holder_name,
        "cert_issued_on": t.cert_issued_on,
        "cert_dates": t.cert_dates,
        "cert_topics": t.cert_topics,
        "cert_provider": t.cert_provider,
        "cert_language": t.cert_language,
        "notes": t.notes,
        "can_edit": _training_visible(pr, t, write=True),
    }
    if detail:
        out["documents"] = doc_links_for(db, pr, "training", t.id)
    return out


class TrainingIn(BaseModel):
    person_name: str = Field(min_length=1, max_length=200)
    person_role: str | None = Field(default=None, max_length=200)
    user_id: int | None = None
    board_member_ids: list[int] = Field(default_factory=list)
    entity_ids: list[int] = Field(default_factory=list)
    title: str = Field(min_length=1, max_length=300)
    provider: str | None = Field(default=None, max_length=200)
    delivery: Literal["internal", "external"] = "external"
    training_date: BoundedDate
    start_time: time | None = None
    end_time: time | None = None
    duration_minutes: int | None = Field(default=None, ge=0, le=100_000)
    topics: list[str] = Field(default_factory=list)
    legal_refs: list[str] = Field(default_factory=list)
    has_certificate: bool = False
    cert_holder_name: str | None = Field(default=None, max_length=200)
    cert_issued_on: BoundedDate | None = None
    cert_dates: str | None = Field(default=None, max_length=200)
    cert_topics: str | None = None
    cert_provider: str | None = Field(default=None, max_length=200)
    cert_language: Literal["NL", "EN", "DE"] | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _times(self):
        if self.start_time and self.end_time:
            if self.end_time <= self.start_time:
                raise ValueError("End time must be after the start time")
            if self.duration_minutes is None:
                self.duration_minutes = (self.end_time.hour * 60 + self.end_time.minute) - (
                    self.start_time.hour * 60 + self.start_time.minute
                )
        return self


TrainingPatch = partial_model(TrainingIn, "TrainingPatch")


def _prepare_training(db: Session, body: TrainingIn) -> dict:
    data = body.model_dump()
    ents = set(data["entity_ids"])
    for mid in data["board_member_ids"]:
        m = get_or_404(db, BoardMember, mid, "Board member")
        ents.add(m.entity_id)
    for eid in ents:
        get_or_404(db, Entity, eid, "Entity")
    data["entity_ids"] = sorted(ents)
    data["topics"] = [s.strip() for s in data["topics"] if s.strip()]
    data["legal_refs"] = [s.strip() for s in data["legal_refs"] if s.strip()]
    return data


def _resync_members(db: Session, member_ids: set[int], actor_id: int) -> None:
    trainings = list(db.scalars(select(TrainingRecord)))
    for mid in member_ids:
        m = db.get(BoardMember, mid)
        if m:
            sync_training_obligation(db, m, trainings, actor_id=actor_id)


@router.get("/trainings")
def list_trainings(
    entity_id: int | None = None,
    pr: Principal = Depends(require("governance.read")),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(TrainingRecord).order_by(TrainingRecord.training_date.desc(), TrainingRecord.id.desc())
    )
    return [
        training_out(db, t, pr)
        for t in rows
        if _training_visible(pr, t) and (entity_id is None or entity_id in (t.entity_ids or []))
    ]


@router.get("/trainings/{training_id}")
def get_training(
    training_id: int, pr: Principal = Depends(require("governance.read")), db: Session = Depends(get_db)
):
    t = get_or_404(db, TrainingRecord, training_id, "Training record")
    if not _training_visible(pr, t):
        raise HTTPException(403, "No access to this training record")
    return training_out(db, t, pr, detail=True)


@router.post("/trainings")
def create_training(body: TrainingIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    data = _prepare_training(db, body)
    t = TrainingRecord(**data)
    if not _training_visible(pr, t, write=True):
        raise HTTPException(403, "Missing permission: governance.manage for every entity of this record")
    db.add(t)
    db.flush()
    _resync_members(db, set(t.board_member_ids), pr.id)
    audit(
        db,
        pr,
        "create",
        "training",
        t.id,
        f"{t.person_name}: {t.title}",
        entity_id=t.entity_ids[0] if len(t.entity_ids) == 1 else None,
    )
    db.commit()
    return training_out(db, t, pr, detail=True)


@router.put("/trainings/{training_id}")
@router.patch("/trainings/{training_id}")
def update_training(
    training_id: int,
    body: TrainingPatch,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    t = get_or_404(db, TrainingRecord, training_id, "Training record")
    if not _training_visible(pr, t, write=True):
        raise HTTPException(403, "Missing permission: governance.manage for every entity of this record")
    before = set(t.board_member_ids or [])
    sent = body.model_dump(exclude_unset=True)
    extra = {}
    if ("start_time" in sent or "end_time" in sent) and "duration_minutes" not in sent:
        extra["duration_minutes"] = None  # recalculated from the new times
    merged = merge_update(t, body, TrainingIn, extra_current=extra)
    data = _prepare_training(db, merged)
    diff = apply_changes(t, data)
    if not _training_visible(pr, t, write=True):
        raise HTTPException(403, "Missing permission: governance.manage for every entity of this record")
    db.flush()
    _resync_members(db, before | set(t.board_member_ids), pr.id)
    audit(db, pr, "update", "training", t.id, t.title, details=diff)
    db.commit()
    return training_out(db, t, pr, detail=True)


@router.delete("/trainings/{training_id}")
def delete_training(training_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    t = get_or_404(db, TrainingRecord, training_id, "Training record")
    if not _training_visible(pr, t, write=True):
        raise HTTPException(403, "Missing permission: governance.manage for every entity of this record")
    members = set(t.board_member_ids or [])
    audit(db, pr, "delete", "training", t.id, t.title)
    cleanup_target(db, "training", t.id)
    db.delete(t)
    db.flush()
    _resync_members(db, members, pr.id)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- rules and matrix


def rule_out(r: TrainingRule) -> dict:
    return {
        k: getattr(r, k)
        for k in (
            "id",
            "jurisdiction",
            "label",
            "is_statutory",
            "legal_ref",
            "initial_months",
            "count_from",
            "cadence_months",
            "requires_certificate",
            "note",
        )
    }


class RuleIn(BaseModel):
    label: str = Field(min_length=1, max_length=300)
    initial_months: int = Field(ge=1, le=120)
    count_from: BoundedDate | None = None
    cadence_months: int | None = Field(default=None, ge=1, le=120)
    requires_certificate: bool = False
    note: str | None = None


RulePatch = partial_model(RuleIn, "RulePatch")


@router.get("/training-rules")
def list_rules(pr: Principal = Depends(require("governance.read")), db: Session = Depends(get_db)):
    return [rule_out(r) for r in db.scalars(select(TrainingRule).order_by(TrainingRule.jurisdiction))]


@router.put("/training-rules/{rule_id}")
@router.patch("/training-rules/{rule_id}")
def update_rule(
    rule_id: int, body: RulePatch, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    r = get_or_404(db, TrainingRule, rule_id, "Training rule")
    pr.ensure("governance.manage", None, write=True)
    diff = apply_changes(r, merge_update(r, body, RuleIn).model_dump())
    db.flush()
    trainings = list(db.scalars(select(TrainingRecord)))
    for m in db.scalars(select(BoardMember)):
        if m.entity and m.entity.country == r.jurisdiction:
            sync_training_obligation(db, m, trainings, actor_id=pr.id)
    audit(db, pr, "update", "training_rule", r.id, r.label, details=diff)
    db.commit()
    return rule_out(r)


@router.get("/training-matrix")
def training_matrix(pr: Principal = Depends(require("governance.read")), db: Session = Depends(get_db)):
    """Active board members × training status, grouped by entity."""
    trainings = list(db.scalars(select(TrainingRecord)))
    rules = {r.jurisdiction: r for r in db.scalars(select(TrainingRule))}
    out = []
    for e in db.scalars(
        select(Entity).where(Entity.is_active.is_(True)).order_by(Entity.sort_order, Entity.id)
    ):
        if not pr.can_read("governance.read", e.id):
            continue
        members = [
            m
            for m in db.scalars(
                select(BoardMember)
                .where(BoardMember.entity_id == e.id)
                .order_by(BoardMember.appointed_at, BoardMember.id)
            )
            if is_active_member(m)
        ]
        rule = rules.get(e.country or "")
        rows = []
        for m in members:
            st = member_training_status(m, rule, trainings)
            mine = [t for t in trainings if m.id in (t.board_member_ids or [])]
            mine.sort(key=lambda t: t.training_date, reverse=True)
            rows.append(
                {
                    "member": {
                        "id": m.id,
                        "name": m.name,
                        "function": m.function,
                        "appointed_at": m.appointed_at,
                    },
                    **st,
                    "latest": (
                        {"id": mine[0].id, "title": mine[0].title, "has_certificate": mine[0].has_certificate}
                        if mine
                        else None
                    ),
                }
            )
        out.append({"entity": entity_ref(e), "rule": rule_out(rule) if rule else None, "members": rows})
    return out


@router.get("/overview")
def overview(pr: Principal = Depends(require("governance.read")), db: Session = Depends(get_db)):
    """Counts for the governance landing view."""
    from app.features.governance.api_registry import change_out
    from app.features.governance.logic import due_state
    from app.features.governance.models import Registration, RegistrationChange

    today = date.today()
    obs = [
        o
        for o in db.scalars(select(Obligation).where(Obligation.status == "open"))
        if pr.can_read("governance.read", o.entity_id)
    ]
    states = [due_state(o.due_date, False, today) for o in obs]
    changes = [
        c
        for c in db.scalars(select(RegistrationChange).where(RegistrationChange.reported_at.is_(None)))
        if pr.can_read("governance.read", c.entity_id)
    ]
    matrix = training_matrix(pr, db)
    tstat = [r["status"] for e in matrix for r in e["members"]]
    regs = {}
    for r in db.scalars(select(Registration)):
        if pr.can_read("governance.read", r.entity_id):
            regs.setdefault(r.entity_id, []).append(
                {"id": r.id, "jurisdiction": r.jurisdiction, "status": r.status}
            )
    ents = [
        {"entity": entity_ref(e), "registrations": regs.get(e.id, [])}
        for e in db.scalars(
            select(Entity).where(Entity.is_active.is_(True)).order_by(Entity.sort_order, Entity.id)
        )
        if pr.can_read("governance.read", e.id)
    ]
    return {
        "obligations": {
            "open": len(obs),
            "overdue": states.count("overdue"),
            "due_soon": states.count("due_soon"),
        },
        "registration_changes": {
            "pending": len(changes),
            "overdue": sum(1 for c in changes if c.due_at < today),
            "items": [change_out(db, c) for c in changes],
        },
        "training": {
            "members": len(tstat),
            "compliant": tstat.count("compliant"),
            "due": tstat.count("due"),
            "overdue": tstat.count("overdue"),
        },
        "entities": ents,
    }
