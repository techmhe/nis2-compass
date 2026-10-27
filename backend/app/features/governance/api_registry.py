"""Registrations with the authorities (§ 33 BSIG / Cbw Art. 44 + Cbb Art. 27), the two-week change duty and the
obligation calendar."""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import get_or_404
from app.core.deps import Principal, get_principal, require
from app.core.jurisdictions import JURISDICTIONS, get_jurisdiction
from app.db import get_db, utcnow
from app.features.governance.logic import (
    CHANGE_REPORT_DAYS,
    due_state,
    governance_managers,
    next_due,
)
from app.features.governance.models import Obligation, Registration, RegistrationChange
from app.features.governance.validation import (
    BoundedDate,
    merge_update,
    not_future,
    owner_user_id,
    partial_model,
    user_can_read_gov,
)
from app.models import Entity, Stakeholder, User
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object, remove_object
from app.services.notify import notify

router = APIRouter()

CHANGE_REF = {"DE": "§ 33(5) BSIG", "NL": "Cbw Art. 44(2)"}

# Portal fields whose change must be reported within two weeks, with labels
FIELD_LABELS: dict[str, str] = {
    "legal_name": "Name of the entity",
    "legal_form": "Legal form",
    "register_number": "Commercial register number",
    "address": "Address",
    "entity_type": "Entity type",
    "sectors": "Sectors / sub-sectors",
    "contact_person": "Contact person",
    "contact_person_email": "Contact person e-mail",
    "contact_person_phone": "Contact person phone",
    "contact_point": "24/7 contact point",
    "contact_point_email": "24/7 contact point e-mail",
    "contact_point_phone": "24/7 contact point phone",
    "public_ip_ranges": "Public IP address ranges",
    "domain_names": "Domain names",
    "member_states": "Member states where services are provided",
    "authorities": "Competent authorities",
}


def _fmt(v) -> str | None:
    if v is None or v == "" or v == []:
        return None
    if isinstance(v, list):
        return "\n".join(str(x) for x in v)
    return str(v)


def _user_name(db: Session, uid: int | None) -> str | None:
    u = db.get(User, uid) if uid else None
    return u.display_name if u else None


def change_out(db: Session, c: RegistrationChange) -> dict:
    state = "reported" if c.reported_at else due_state(c.due_at, False)
    return {
        "id": c.id,
        "registration_id": c.registration_id,
        "entity_id": c.entity_id,
        "entity_code": c.registration.entity.code if c.registration else None,
        "jurisdiction": c.registration.jurisdiction if c.registration else None,
        "field": c.field,
        "field_label": c.field_label,
        "old_value": c.old_value,
        "new_value": c.new_value,
        "known_at": c.known_at,
        "due_at": c.due_at,
        "reported_at": c.reported_at,
        "reported_reference": c.reported_reference,
        "reported_by": _user_name(db, c.reported_by_id),
        "note": c.note,
        "created_by": _user_name(db, c.created_by_id),
        "created_at": c.created_at,
        "state": state,
        "days_left": None if c.reported_at else (c.due_at - date.today()).days,
    }


REG_FIELDS = [
    "portal",
    "status",
    "registration_number",
    "submitted_at",
    "registered_at",
    "legal_name",
    "legal_form",
    "register_number",
    "address",
    "entity_type",
    "contact_point",
    "contact_point_phone",
    "contact_point_email",
    "contact_person",
    "contact_person_phone",
    "contact_person_email",
    "public_ip_ranges",
    "domain_names",
    "sectors",
    "member_states",
    "authorities",
    "scope_rationale",
    "reviewed_at",
    "notes",
]


def reg_out(db: Session, r: Registration, pr: Principal, detail: bool = False) -> dict:
    changes = list(
        db.scalars(
            select(RegistrationChange)
            .where(RegistrationChange.registration_id == r.id)
            .order_by(RegistrationChange.known_at.desc(), RegistrationChange.id.desc())
        )
    )
    pending = [c for c in changes if not c.reported_at]
    d = {
        "id": r.id,
        "entity": {
            "id": r.entity.id,
            "code": r.entity.code,
            "name": r.entity.name,
            "country": r.entity.country,
        },
        "jurisdiction": r.jurisdiction,
        **{k: getattr(r, k) for k in REG_FIELDS},
        "updated_at": r.updated_at,
        "pending_changes": len(pending),
        "overdue_changes": sum(1 for c in pending if c.due_at < date.today()),
        "next_change_due": min((c.due_at for c in pending), default=None),
        "can_edit": pr.can_write("governance.manage", r.entity_id),
    }
    if detail:
        d["changes"] = [change_out(db, c) for c in changes]
        d["sheet"] = [
            {"field": f, "label": FIELD_LABELS[f], "ref": ref, "value": _fmt(getattr(r, f))}
            for f, ref in (get_jurisdiction(r.jurisdiction) or JURISDICTIONS["DE"]).sheet_order
        ]
        d["change_ref"] = CHANGE_REF.get(r.jurisdiction)
    return d


REGISTERED = ("submitted", "confirmed", "withdrawn")  # the authority holds the data: changes must be reported


class RegistrationIn(BaseModel):
    portal: str | None = Field(default=None, max_length=100)
    status: Literal["not_registered", "draft", "submitted", "confirmed", "withdrawn"] = "draft"
    registration_number: str | None = Field(default=None, max_length=200)
    submitted_at: BoundedDate | None = None
    registered_at: BoundedDate | None = None
    legal_name: str | None = Field(default=None, max_length=300)
    legal_form: str | None = Field(default=None, max_length=100)
    register_number: str | None = Field(default=None, max_length=100)
    address: str | None = None
    entity_type: str | None = Field(default=None, max_length=200)
    contact_point: str | None = Field(default=None, max_length=300)
    contact_point_phone: str | None = Field(default=None, max_length=100)
    contact_point_email: str | None = Field(default=None, max_length=320)
    contact_person: str | None = Field(default=None, max_length=200)
    contact_person_phone: str | None = Field(default=None, max_length=100)
    contact_person_email: str | None = Field(default=None, max_length=320)
    public_ip_ranges: list[str] = Field(default_factory=list)
    domain_names: list[str] = Field(default_factory=list)
    sectors: list[str] = Field(default_factory=list)
    member_states: list[str] = Field(default_factory=list)
    authorities: list[str] = Field(default_factory=list)
    scope_rationale: str | None = None
    reviewed_at: BoundedDate | None = None
    notes: str | None = None


class RegistrationCreate(RegistrationIn):
    entity_id: int
    jurisdiction: str

    @field_validator("jurisdiction")
    @classmethod
    def _known_jurisdiction(cls, v: str) -> str:
        if v not in JURISDICTIONS:
            raise ValueError(f"Unknown jurisdiction, expected one of {', '.join(JURISDICTIONS)}")
        return v


class RegistrationUpdate(partial_model(RegistrationIn, "RegistrationPartial")):
    """Only the fields sent are changed (PATCH semantics, also for PUT)."""

    known_at: BoundedDate | None = None  # when the change became known (default today)
    change_note: str | None = None


class WithdrawIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)
    withdrawn_at: BoundedDate | None = None


def _clean(data: dict) -> dict:
    for k in ("public_ip_ranges", "domain_names", "sectors", "member_states", "authorities"):
        if k in data:
            data[k] = [s.strip() for s in data[k] if s and s.strip()]
    for k, v in list(data.items()):
        if isinstance(v, str):
            data[k] = v.strip() or None
    return data


def sync_entity(db: Session, r: Registration) -> None:
    """Mirror the basic status into the entity master data (Entity.registration_*)."""
    e = db.get(Entity, r.entity_id)
    if not e or (e.country and e.country != r.jurisdiction):
        return
    e.registration_status = {"submitted": "submitted", "confirmed": "confirmed"}.get(
        r.status, "not_registered"
    )
    if r.status == "withdrawn":
        e.registration_date = None
        e.registration_reference = None
        return
    e.registration_date = r.registered_at or r.submitted_at
    e.registration_reference = r.registration_number


@router.get("/registrations")
def list_registrations(pr: Principal = Depends(require("governance.read")), db: Session = Depends(get_db)):
    regs = db.scalars(select(Registration).order_by(Registration.entity_id, Registration.jurisdiction)).all()
    return [reg_out(db, r, pr) for r in regs if pr.can_read("governance.read", r.entity_id)]


@router.post("/registrations")
def create_registration(
    body: RegistrationCreate, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    e = get_or_404(db, Entity, body.entity_id, "Entity")
    pr.ensure("governance.manage", e.id, write=True)
    if body.status == "withdrawn":
        raise HTTPException(400, "A new registration record cannot start as withdrawn")
    if db.scalar(
        select(Registration.id).where(
            Registration.entity_id == e.id, Registration.jurisdiction == body.jurisdiction
        )
    ):
        raise HTTPException(409, f"{e.code} already has a {body.jurisdiction} registration record")
    data = _clean(body.model_dump())
    data["portal"] = data.get("portal") or JURISDICTIONS[body.jurisdiction].portal
    r = Registration(**data)
    db.add(r)
    db.flush()
    sync_entity(db, r)
    audit(db, pr, "create", "registration", r.id, f"{e.code} {r.jurisdiction}", entity_id=e.id)
    db.commit()
    return reg_out(db, r, pr, detail=True)


@router.get("/registrations/{reg_id}")
def get_registration(
    reg_id: int, pr: Principal = Depends(require("governance.read")), db: Session = Depends(get_db)
):
    r = get_or_404(db, Registration, reg_id, "Registration")
    pr.ensure("governance.read", r.entity_id)
    return reg_out(db, r, pr, detail=True)


@router.put("/registrations/{reg_id}")
@router.patch("/registrations/{reg_id}")
def update_registration(
    reg_id: int,
    body: RegistrationUpdate,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    r = get_or_404(db, Registration, reg_id, "Registration")
    pr.ensure("governance.manage", r.entity_id, write=True)
    not_future(body.known_at, "known_at")
    merged = merge_update(r, body, RegistrationIn)
    sent = body.model_dump(exclude_unset=True, exclude={"known_at", "change_note"})
    data = _clean({k: getattr(merged, k) for k in sent})
    was_registered = r.status in REGISTERED
    new_status = data.get("status", r.status)
    if was_registered and new_status in ("draft", "not_registered"):
        raise HTTPException(
            400,
            "A submitted registration cannot go back to draft; use 'Withdraw registration' "
            "to record a deregistration",
        )
    if new_status == "withdrawn" and r.status != "withdrawn":
        raise HTTPException(400, "Use 'Withdraw registration' to withdraw a registration")
    diff = apply_changes(r, data)
    known = body.known_at or date.today()
    created: list[RegistrationChange] = []
    if was_registered:
        for f, (old, new) in diff.items():
            if f not in FIELD_LABELS:
                continue
            c = RegistrationChange(
                registration_id=r.id,
                entity_id=r.entity_id,
                field=f,
                field_label=FIELD_LABELS[f],
                old_value=_fmt(old),
                new_value=_fmt(new),
                known_at=known,
                due_at=known + timedelta(days=CHANGE_REPORT_DAYS),
                note=body.change_note,
                created_by_id=pr.id,
            )
            db.add(c)
            created.append(c)
    sync_entity(db, r)
    audit(
        db,
        pr,
        "update",
        "registration",
        r.id,
        f"{r.entity.code} {r.jurisdiction}",
        entity_id=r.entity_id,
        details=diff,
    )
    db.flush()
    if created:
        due = created[0].due_at
        fields = ", ".join(c.field_label for c in created)
        for uid in governance_managers(db, r.entity_id):
            notify(
                db,
                uid,
                "registration_change",
                f"Report registration change for {r.entity.code} by {due.isoformat()}",
                f"/governance/registrations?registration={r.id}",
                body=f"Changed: {fields}. {CHANGE_REF.get(r.jurisdiction, '')} requires reporting within two weeks.",
                actor_id=pr.id,
            )
    db.commit()
    return reg_out(db, r, pr, detail=True)


@router.delete("/registrations/{reg_id}")
def delete_registration(reg_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    r = get_or_404(db, Registration, reg_id, "Registration")
    pr.ensure("governance.manage", r.entity_id, write=True)
    if r.status in REGISTERED or r.submitted_at or r.registered_at:
        raise HTTPException(400, "Registrations that were submitted cannot be deleted; withdraw them instead")
    if db.scalar(select(RegistrationChange.id).where(RegistrationChange.registration_id == r.id).limit(1)):
        raise HTTPException(400, "This registration has a change history and cannot be deleted")
    audit(db, pr, "delete", "registration", r.id, f"{r.entity.code} {r.jurisdiction}", entity_id=r.entity_id)
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.post("/registrations/{reg_id}/withdraw")
def withdraw_registration(
    reg_id: int, body: WithdrawIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    """Record a deregistration (entity left the scope, merged ...). The change history is kept, and later edits
    are still recorded as changes."""
    r = get_or_404(db, Registration, reg_id, "Registration")
    pr.ensure("governance.manage", r.entity_id, write=True)
    if r.status not in ("submitted", "confirmed"):
        raise HTTPException(400, "Only submitted or confirmed registrations can be withdrawn")
    not_future(body.withdrawn_at, "withdrawn_at")
    when = body.withdrawn_at or date.today()
    old = r.status
    r.status = "withdrawn"
    r.notes = (
        (r.notes + "\n") if r.notes else ""
    ) + f"Withdrawn on {when.isoformat()}: {body.reason.strip()}"
    sync_entity(db, r)
    audit(
        db,
        pr,
        "withdraw",
        "registration",
        r.id,
        f"{r.entity.code} {r.jurisdiction}",
        entity_id=r.entity_id,
        details={
            "status": [old, "withdrawn"],
            "withdrawn_at": when.isoformat(),
            "reason": body.reason.strip(),
        },
    )
    db.commit()
    return reg_out(db, r, pr, detail=True)


@router.get("/registration-changes")
def list_changes(
    state: Literal["open", "all"] = "open",
    pr: Principal = Depends(require("governance.read")),
    db: Session = Depends(get_db),
):
    stmt = select(RegistrationChange).order_by(RegistrationChange.due_at, RegistrationChange.id)
    if state == "open":
        stmt = stmt.where(RegistrationChange.reported_at.is_(None))
    return [change_out(db, c) for c in db.scalars(stmt) if pr.can_read("governance.read", c.entity_id)]


class ReportIn(BaseModel):
    reported_at: BoundedDate
    reference: str = Field(min_length=1, max_length=200)
    note: str | None = None
    change_ids: list[int] = Field(default_factory=list)  # further changes reported in the same submission


@router.post("/registration-changes/{change_id}/report")
def report_change(
    change_id: int, body: ReportIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    ids = {change_id, *body.change_ids}
    out = []
    for cid in sorted(ids):
        c = get_or_404(db, RegistrationChange, cid, "Registration change")
        pr.ensure("governance.manage", c.entity_id, write=True)
        if c.reported_at:
            raise HTTPException(
                409, f"The change of {c.field_label} was already reported on {c.reported_at.isoformat()}"
            )
        if body.reported_at < c.known_at:
            raise HTTPException(400, "The report date cannot be before the change became known")
        if body.reported_at > date.today():
            raise HTTPException(400, "The report date cannot be in the future")
        c.reported_at = body.reported_at
        c.reported_reference = body.reference.strip()
        c.reported_by_id = pr.id
        if body.note:
            c.note = ((c.note + "\n") if c.note else "") + body.note
        audit(
            db,
            pr,
            "report",
            "registration_change",
            c.id,
            f"{c.field_label}",
            entity_id=c.entity_id,
            details={"reported_at": body.reported_at.isoformat(), "reference": body.reference},
        )
        out.append(c)
    db.commit()
    return [change_out(db, c) for c in out]


# --------------------------------------------------------------------------- obligations

KINDS = [
    "policy_review",
    "measures_approval",
    "oversight_review",
    "training",
    "registration_review",
    "risk_review",
    "bcm_test",
    "supplier_review",
    "access_review",
    "effectiveness_review",
    "other",
]


def obligation_out(db: Session, o: Obligation, pr: Principal | None = None) -> dict:
    st = db.get(Stakeholder, o.owner_stakeholder_id) if o.owner_stakeholder_id else None
    return {
        "id": o.id,
        "entity": (
            {"id": o.entity.id, "code": o.entity.code, "name": o.entity.name, "country": o.entity.country}
            if o.entity
            else None
        ),
        "entity_id": o.entity_id,
        "kind": o.kind,
        "title": o.title,
        "description": o.description,
        "legal_ref": o.legal_ref,
        "due_date": o.due_date,
        "recurrence": o.recurrence,
        "owner_stakeholder_id": o.owner_stakeholder_id,
        "owner_stakeholder": st.name if st else None,
        "owner_user_id": o.owner_user_id,
        "owner_user": _user_name(db, o.owner_user_id),
        "status": o.status,
        "state": due_state(o.due_date, o.status != "open"),
        "completed_at": o.completed_at,
        "completed_by": _user_name(db, o.completed_by_id),
        "completion_note": o.completion_note,
        "source": o.source,
        "source_type": o.source_type,
        "source_id": o.source_id,
        "previous_id": o.previous_id,
        "can_edit": pr.can_write("governance.manage", o.entity_id) if pr else False,
        "can_complete": _can_complete(db, pr, o) if pr else False,
    }


def _is_owner(db: Session, pr: Principal, o: Obligation) -> bool:
    return owner_user_id(db, o.owner_user_id, o.owner_stakeholder_id) == pr.id and pr.can_read(
        "governance.read", o.entity_id
    )


def _auto_managed(o: Obligation) -> bool:
    """Training obligations of board members close automatically when a qualifying training is recorded."""
    return o.source_type == "board_member"


def _can_complete(db: Session, pr: Principal, o: Obligation) -> bool:
    return (
        o.status == "open"
        and not _auto_managed(o)
        and (pr.can_write("governance.manage", o.entity_id) or _is_owner(db, pr, o))
    )


def _check_owner(db: Session, entity_id: int | None, user: int | None, stakeholder: int | None) -> None:
    """The owner must be allowed to see the obligation (governance.read for its entity)."""
    if stakeholder:
        get_or_404(db, Stakeholder, stakeholder, "Stakeholder")
    if user:
        get_or_404(db, User, user, "User")
    for uid, what in ((user, "owner"), (owner_user_id(db, None, stakeholder), "user of the owner role")):
        if uid and not user_can_read_gov(db, uid, entity_id):
            raise HTTPException(
                400,
                f"The {what} cannot see governance data of this entity; choose someone with "
                "governance read access",
            )


class ObligationIn(BaseModel):
    entity_id: int | None = None
    kind: str = Field(default="other", max_length=40)
    title: str = Field(min_length=1, max_length=400)
    description: str | None = None
    legal_ref: str | None = Field(default=None, max_length=200)
    due_date: BoundedDate
    recurrence: Literal["none", "monthly", "quarterly", "semiannual", "annual", "biennial"] = "none"
    owner_stakeholder_id: int | None = None
    owner_user_id: int | None = None


ObligationPatch = partial_model(ObligationIn, "ObligationPatch")


def _notify_owner(db: Session, o: Obligation, actor_id: int | None) -> None:
    uid = owner_user_id(db, o.owner_user_id, o.owner_stakeholder_id)
    if not user_can_read_gov(db, uid, o.entity_id):
        return
    notify(
        db,
        uid,
        "obligation_assigned",
        f"Obligation assigned: {o.title} (due {o.due_date.isoformat()})",
        f"/governance/obligations?obligation={o.id}",
        actor_id=actor_id,
    )


@router.get("/obligations")
def list_obligations(
    entity_id: int | None = None,
    status: str | None = None,
    pr: Principal = Depends(require("governance.read")),
    db: Session = Depends(get_db),
):
    stmt = select(Obligation).order_by(Obligation.due_date, Obligation.id)
    if entity_id:
        stmt = stmt.where(Obligation.entity_id == entity_id)
    if status in ("open", "done", "cancelled"):
        stmt = stmt.where(Obligation.status == status)
    return [
        obligation_out(db, o, pr) for o in db.scalars(stmt) if pr.can_read("governance.read", o.entity_id)
    ]


@router.post("/obligations")
def create_obligation(
    body: ObligationIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    pr.ensure("governance.manage", body.entity_id, write=True)
    if body.entity_id:
        get_or_404(db, Entity, body.entity_id, "Entity")
    _check_owner(db, body.entity_id, body.owner_user_id, body.owner_stakeholder_id)
    o = Obligation(**body.model_dump(), source="manual")
    db.add(o)
    db.flush()
    audit(db, pr, "create", "obligation", o.id, o.title, entity_id=o.entity_id)
    _notify_owner(db, o, pr.id)
    db.commit()
    index_object(db, "obligation", o.id)
    return obligation_out(db, o, pr)


@router.put("/obligations/{ob_id}")
@router.patch("/obligations/{ob_id}")
def update_obligation(
    ob_id: int, body: ObligationPatch, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    o = get_or_404(db, Obligation, ob_id, "Obligation")
    pr.ensure("governance.manage", o.entity_id, write=True)
    merged = merge_update(o, body, ObligationIn)
    pr.ensure("governance.manage", merged.entity_id, write=True)
    if merged.entity_id:
        get_or_404(db, Entity, merged.entity_id, "Entity")
    _check_owner(db, merged.entity_id, merged.owner_user_id, merged.owner_stakeholder_id)
    old_owner = (o.owner_user_id, o.owner_stakeholder_id)
    diff = apply_changes(o, merged.model_dump())
    audit(db, pr, "update", "obligation", o.id, o.title, entity_id=o.entity_id, details=diff)
    if (o.owner_user_id, o.owner_stakeholder_id) != old_owner:
        _notify_owner(db, o, pr.id)
    db.commit()
    index_object(db, "obligation", o.id)
    return obligation_out(db, o, pr)


class CompleteIn(BaseModel):
    completed_at: BoundedDate | None = None
    note: str | None = None


@router.post("/obligations/{ob_id}/complete")
def complete_obligation(
    ob_id: int, body: CompleteIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    o = get_or_404(db, Obligation, ob_id, "Obligation")
    pr.ensure("governance.read", o.entity_id)
    if o.status != "open":
        raise HTTPException(400, "Only open obligations can be completed")
    if _auto_managed(o):
        raise HTTPException(
            400, "Training obligations close automatically when a qualifying training is recorded"
        )
    if not _can_complete(db, pr, o):
        raise HTTPException(403, "Only the owner or a governance manager can complete this obligation")
    done_on = body.completed_at or date.today()
    not_future(done_on, "completed_at")
    created = o.created_at.date() if o.created_at else None
    if created and done_on < created:
        raise HTTPException(
            400, f"The completion date cannot be before the obligation was recorded ({created.isoformat()})"
        )
    o.status = "done"
    o.completed_at = done_on
    o.completed_by_id = pr.id
    o.completion_note = body.note
    nxt = None
    nd = next_due(o.due_date, o.recurrence)
    if nd:
        nxt = Obligation(
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
        db.add(nxt)
    db.flush()
    audit(
        db,
        pr,
        "complete",
        "obligation",
        o.id,
        o.title,
        entity_id=o.entity_id,
        details={"completed_at": o.completed_at.isoformat(), "next_id": nxt.id if nxt else None},
    )
    db.commit()
    index_object(db, "obligation", o.id)
    if nxt:
        index_object(db, "obligation", nxt.id)
    return {"completed": obligation_out(db, o, pr), "next": obligation_out(db, nxt, pr) if nxt else None}


@router.post("/obligations/{ob_id}/reopen")
def reopen_obligation(ob_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    o = get_or_404(db, Obligation, ob_id, "Obligation")
    pr.ensure("governance.manage", o.entity_id, write=True)
    if o.status == "open":
        raise HTTPException(400, "Obligation is already open")
    o.status = "open"
    o.completed_at = None
    o.completed_by_id = None
    audit(db, pr, "reopen", "obligation", o.id, o.title, entity_id=o.entity_id)
    db.commit()
    return obligation_out(db, o, pr)


@router.delete("/obligations/{ob_id}")
def delete_obligation(ob_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    o = get_or_404(db, Obligation, ob_id, "Obligation")
    pr.ensure("governance.manage", o.entity_id, write=True)
    audit(db, pr, "delete", "obligation", o.id, o.title, entity_id=o.entity_id)
    for later in db.scalars(select(Obligation).where(Obligation.previous_id == o.id)):
        later.previous_id = None
    db.delete(o)
    db.commit()
    remove_object(db, "obligation", ob_id)
    return {"ok": True}


@router.get("/my-obligations")
def my_obligations(pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Personal view: open obligations the caller owns (directly or via a stakeholder role) and, for governance
    managers, registration changes that still have to be reported."""
    my_st = {s.id for s in db.scalars(select(Stakeholder).where(Stakeholder.user_id == pr.id))}
    obs = db.scalars(
        select(Obligation).where(Obligation.status == "open").order_by(Obligation.due_date)
    ).all()
    mine = [
        o
        for o in obs
        if (o.owner_user_id == pr.id or (o.owner_stakeholder_id in my_st))
        and pr.can_read("governance.read", o.entity_id)
    ]
    changes = []
    if pr.has_any("governance.manage"):
        changes = [
            change_out(db, c)
            for c in db.scalars(
                select(RegistrationChange)
                .where(RegistrationChange.reported_at.is_(None))
                .order_by(RegistrationChange.due_at)
            )
            if pr.can_write("governance.manage", c.entity_id)
        ]
    return {
        "obligations": [obligation_out(db, o, pr) for o in mine],
        "registration_changes": changes,
        "generated_at": utcnow(),
    }
