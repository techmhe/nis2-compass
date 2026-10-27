"""Legal-basis and jurisdiction tagging of requirements, entity profiles and the binding-gap figures."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import entity_ref, get_or_404
from app.core.deps import Principal, get_principal, require
from app.db import get_db
from app.features.governance.logic import effective_for_entity, legal_row_dict, rebuild_legal
from app.features.governance.models import EntityProfile, RequirementLegal
from app.features.governance.validation import BoundedDate, merge_update, partial_model
from app.models import Answer, Assessment, AssessmentRound, Entity, Provision, Requirement
from app.services.audit import apply_changes, audit

router = APIRouter()


def _can_curate(pr: Principal) -> bool:
    return "governance.manage" in pr.global_perms or "catalog.manage" in pr.global_perms


def _provs(db: Session, rows: list[RequirementLegal]) -> dict[int, Provision]:
    ids = {r.basis_provision_id for r in rows if r.basis_provision_id}
    return {p.id: p for p in db.scalars(select(Provision).where(Provision.id.in_(ids)))} if ids else {}


@router.get("/legal")
def list_legal(
    jurisdiction: str | None = None,
    pr: Principal = Depends(require("catalog.read")),
    db: Session = Depends(get_db),
):
    """All tags (compact) – used by the catalogue filter."""
    stmt = select(RequirementLegal)
    if jurisdiction:
        stmt = stmt.where(RequirementLegal.jurisdiction == jurisdiction)
    rows = list(db.scalars(stmt))
    provs = _provs(db, rows)
    return [legal_row_dict(r, provs.get(r.basis_provision_id)) for r in rows]


@router.get("/legal/requirements/{requirement_id}")
def requirement_legal(
    requirement_id: int, pr: Principal = Depends(require("catalog.read")), db: Session = Depends(get_db)
):
    req = get_or_404(db, Requirement, requirement_id, "Requirement")
    rows = list(db.scalars(select(RequirementLegal).where(RequirementLegal.requirement_id == req.id)))
    provs = _provs(db, rows)
    order = {"DE": 0, "NL": 1, "EU": 2}
    rows.sort(key=lambda r: order.get(r.jurisdiction, 9))
    entities = []
    for e in db.scalars(
        select(Entity).where(Entity.is_active.is_(True)).order_by(Entity.sort_order, Entity.id)
    ):
        eff = effective_for_entity(db, e, rows).get(req.id)
        entities.append({"entity": entity_ref(e), "effective": eff})
    return {
        "rows": [legal_row_dict(r, provs.get(r.basis_provision_id)) for r in rows],
        "entities": entities,
        "can_edit": _can_curate(pr),
    }


@router.get("/legal/entities/{entity_id}")
def entity_legal(
    entity_id: int, pr: Principal = Depends(require("catalog.read")), db: Session = Depends(get_db)
):
    """Effective status of every requirement for one entity (for badges and the 'binding only' filter)."""
    e = get_or_404(db, Entity, entity_id, "Entity")
    prof = db.scalar(select(EntityProfile).where(EntityProfile.entity_id == e.id))
    eff = effective_for_entity(db, e)
    return {
        "entity": entity_ref(e),
        "ir_2024_2690_applicable": bool(prof and prof.ir_2024_2690_applicable),
        "items": list(eff.values()),
    }


class LegalPatch(BaseModel):
    status: Literal["binding", "benchmark", "guidance"] | None = None
    basis_provision_id: int | None = None
    basis_label: str | None = Field(default=None, max_length=300)
    note: str | None = None


@router.patch("/legal/{row_id}")
def patch_legal(
    row_id: int, body: LegalPatch, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    if not _can_curate(pr):
        raise HTTPException(403, "Missing permission: governance.manage or catalog.manage (group-wide)")
    r = get_or_404(db, RequirementLegal, row_id, "Legal tag")
    data = body.model_dump(exclude_unset=True)
    if data.get("basis_provision_id") is not None:
        get_or_404(db, Provision, data["basis_provision_id"], "Provision")
    if "status" in data and data["status"] is None:
        del data["status"]
    diff = apply_changes(r, data)
    if diff:
        r.is_auto = False
        r.updated_by_id = pr.id
        req = db.get(Requirement, r.requirement_id)
        audit(
            db,
            pr,
            "update",
            "requirement_legal",
            r.id,
            f"{req.number if req else ''} {r.jurisdiction}",
            details=diff,
        )
    db.commit()
    return legal_row_dict(r, db.get(Provision, r.basis_provision_id) if r.basis_provision_id else None)


class RebuildIn(BaseModel):
    overwrite_curated: bool = False


@router.post("/legal/rebuild")
def rebuild(body: RebuildIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    if not _can_curate(pr):
        raise HTTPException(403, "Missing permission: governance.manage or catalog.manage (group-wide)")
    n = rebuild_legal(db, overwrite_curated=body.overwrite_curated)
    audit(
        db,
        pr,
        "rebuild",
        "requirement_legal",
        None,
        "Legal-basis tags",
        details={"rows": n, **body.model_dump()},
    )
    db.commit()
    return {"updated": n}


# --------------------------------------------------------------------------- entity profiles


class ProfileIn(BaseModel):
    nis2_entity_type: str | None = Field(default=None, max_length=300)
    ir_2024_2690_applicable: bool = False
    rationale: str | None = None
    reviewed_at: BoundedDate | None = None


ProfilePatch = partial_model(ProfileIn, "ProfilePatch")


def profile_out(e: Entity, p: EntityProfile | None) -> dict:
    return {
        "entity": entity_ref(e),
        "nis2_classification": e.nis2_classification,
        "activity_sector": e.activity_sector,
        "nis2_entity_type": p.nis2_entity_type if p else None,
        "ir_2024_2690_applicable": bool(p and p.ir_2024_2690_applicable),
        "rationale": p.rationale if p else None,
        "reviewed_at": p.reviewed_at if p else None,
    }


@router.get("/profiles")
def list_profiles(pr: Principal = Depends(require("governance.read")), db: Session = Depends(get_db)):
    profs = {p.entity_id: p for p in db.scalars(select(EntityProfile))}
    return [
        profile_out(e, profs.get(e.id))
        for e in db.scalars(
            select(Entity).where(Entity.is_active.is_(True)).order_by(Entity.sort_order, Entity.id)
        )
        if pr.can_read("governance.read", e.id)
    ]


@router.put("/profiles/{entity_id}")
@router.patch("/profiles/{entity_id}")
def put_profile(
    entity_id: int, body: ProfilePatch, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    e = get_or_404(db, Entity, entity_id, "Entity")
    pr.ensure("governance.manage", e.id, write=True)
    p = db.scalar(select(EntityProfile).where(EntityProfile.entity_id == e.id))
    if not p:
        p = EntityProfile(entity_id=e.id)
        db.add(p)
    diff = apply_changes(p, merge_update(p, body, ProfileIn).model_dump())
    p.updated_by_id = pr.id
    audit(db, pr, "update", "entity_profile", e.id, e.code, entity_id=e.id, details=diff)
    db.commit()
    return profile_out(e, p)


# --------------------------------------------------------------------------- binding gaps


def _is_unanswered(a: Answer) -> bool:
    return a.scope == "In Scope" and not any((a.implemented, a.documented, a.effectiveness))


@router.get("/binding-gaps")
def binding_gaps(
    round_id: int | None = None,
    pr: Principal = Depends(require("assessments.read")),
    db: Session = Depends(get_db),
):
    """Per entity: binding requirements with a finding (work package required) or not yet answered."""
    rnd = (
        db.get(AssessmentRound, round_id)
        if round_id
        else db.scalar(select(AssessmentRound).where(AssessmentRound.is_current.is_(True)))
    )
    if not rnd:
        return {"round_id": None, "entities": []}
    rows = list(db.scalars(select(RequirementLegal)))
    reqs = {r.id: r for r in db.scalars(select(Requirement))}
    out = []
    for asm in db.scalars(select(Assessment).where(Assessment.round_id == rnd.id)):
        e = asm.entity
        if not pr.can_read("assessments.read", e.id) or not e.is_active:
            continue
        eff = effective_for_entity(db, e, rows)
        binding = {rid: d for rid, d in eff.items() if d["status"] == "binding"}
        answers = {
            a.requirement_id: a for a in db.scalars(select(Answer).where(Answer.assessment_id == asm.id))
        }
        items = []
        for rid, d in binding.items():
            a = answers.get(rid)
            kind = None
            if a is None or _is_unanswered(a):
                kind = "unanswered"
            elif a.wp_required:
                kind = "finding"
            if kind:
                rq = reqs.get(rid)
                items.append(
                    {
                        "requirement_id": rid,
                        "number": rq.number if rq else "",
                        "section": rq.section if rq else "",
                        "sort": rq.sort_order if rq else 0,
                        "kind": kind,
                        "basis_label": d["basis_label"],
                        "score": a.score if a else None,
                    }
                )
        items.sort(key=lambda i: i["sort"])
        out.append(
            {
                "entity": entity_ref(e),
                "assessment_id": asm.id,
                "binding": len(binding),
                "findings": sum(1 for i in items if i["kind"] == "finding"),
                "unanswered": sum(1 for i in items if i["kind"] == "unanswered"),
                "open": len(items),
                "items": items,
                "sort": e.sort_order,
            }
        )
    out.sort(key=lambda x: (x["sort"], x["entity"]["id"]))
    return {"round_id": rnd.id, "round_name": rnd.name, "entities": out}
