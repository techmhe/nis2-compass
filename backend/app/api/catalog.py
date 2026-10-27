from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import doc_links_for, get_or_404
from app.core.deps import Principal, require, require_global
from app.db import get_db
from app.models import (
    ActionItem,
    Answer,
    Assessment,
    AssessmentRound,
    Chapter,
    ChapterTargetChange,
    Provision,
    Requirement,
    RequirementProvision,
    User,
)
from app.schemas.common import ORM, Ok
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object

router = APIRouter(tags=["catalog"])


class ChapterOut(ORM):
    id: int
    number: int
    title: str
    target: float
    source: str
    description: str | None
    requirement_count: int = 0


@router.get("/chapters", response_model=list[ChapterOut])
def list_chapters(pr: Principal = Depends(require("catalog.read")), db: Session = Depends(get_db)):
    chapters = db.scalars(select(Chapter).order_by(Chapter.number)).all()
    counts: dict[int, int] = {}
    for cid in db.scalars(select(Requirement.chapter_id).where(Requirement.is_active.is_(True))):
        counts[cid] = counts.get(cid, 0) + 1
    out = []
    for c in chapters:
        co = ChapterOut.model_validate(c)
        co.requirement_count = counts.get(c.id, 0)
        out.append(co)
    return out


class TargetIn(BaseModel):
    target: float = Field(ge=0, le=1)
    reason: str = Field(min_length=3, max_length=2000)


@router.post("/chapters/{chapter_id}/target", response_model=ChapterOut)
def change_target(
    chapter_id: int,
    body: TargetIn,
    pr: Principal = Depends(require_global("catalog.manage")),
    db: Session = Depends(get_db),
):
    c = get_or_404(db, Chapter, chapter_id)
    db.add(
        ChapterTargetChange(
            chapter_id=c.id,
            old_target=c.target,
            new_target=body.target,
            reason=body.reason,
            changed_by_id=pr.id,
        )
    )
    audit(
        db,
        pr,
        "target_changed",
        "chapter",
        c.id,
        f"{c.number} {c.title}",
        details={"old": c.target, "new": body.target, "reason": body.reason},
    )
    c.target = body.target
    db.commit()
    return ChapterOut.model_validate(c)


@router.get("/chapters/target-history")
def target_history(pr: Principal = Depends(require("catalog.read")), db: Session = Depends(get_db)):
    rows = db.execute(
        select(ChapterTargetChange, Chapter, User)
        .join(Chapter, Chapter.id == ChapterTargetChange.chapter_id)
        .outerjoin(User, User.id == ChapterTargetChange.changed_by_id)
        .order_by(ChapterTargetChange.changed_at.desc())
    ).all()
    return [
        {
            "id": t.id,
            "chapter": f"{c.number} {c.title}",
            "old_target": t.old_target,
            "new_target": t.new_target,
            "reason": t.reason,
            "changed_at": t.changed_at,
            "changed_by": u.display_name if u else None,
        }
        for t, c, u in rows
    ]


class RequirementOut(ORM):
    id: int
    number: str
    chapter_id: int
    section: str
    text: str
    check_points: str | None
    legal_reference: str | None
    iso_reference: str | None
    is_core: bool
    guidance: str | None
    sort_order: int
    is_active: bool


@router.get("/requirements", response_model=list[RequirementOut])
def list_requirements(
    chapter: int | None = None,
    core: bool | None = None,
    pr: Principal = Depends(require("catalog.read")),
    db: Session = Depends(get_db),
):
    stmt = select(Requirement).where(Requirement.is_active.is_(True)).order_by(Requirement.sort_order)
    if chapter is not None:
        stmt = stmt.join(Chapter).where(Chapter.number == chapter)
    if core is not None:
        stmt = stmt.where(Requirement.is_core.is_(core))
    return db.scalars(stmt).all()


class ProvisionLinkOut(BaseModel):
    link_id: int
    relation: str
    is_auto: bool
    note: str | None
    provision_id: int
    regulation_id: int
    regulation_code: str
    regulation_title: str
    jurisdiction: str
    language: str
    ref: str
    heading: str | None
    text: str | None


def provision_links(db: Session, requirement_id: int) -> list[ProvisionLinkOut]:
    rows = db.scalars(
        select(RequirementProvision).where(RequirementProvision.requirement_id == requirement_id)
    ).all()
    out = []
    for rp in rows:
        p = rp.provision
        reg = p.regulation
        heading = p.heading
        if not heading and p.parent_id:  # show the article heading for paragraph-level links
            parent = db.get(Provision, p.parent_id)
            while parent is not None and not parent.heading and parent.parent_id:
                parent = db.get(Provision, parent.parent_id)
            heading = parent.heading if parent else None
        out.append(
            ProvisionLinkOut(
                link_id=rp.id,
                relation=rp.relation,
                is_auto=rp.is_auto,
                note=rp.note,
                provision_id=p.id,
                regulation_id=reg.id,
                regulation_code=reg.code,
                regulation_title=reg.short_title,
                jurisdiction=reg.jurisdiction,
                language=reg.language,
                ref=p.ref,
                heading=heading,
                text=p.text,
            )
        )
    order = {"IR2024/2690": 0, "NIS2": 1, "BSIG": 2, "CBW": 3, "CBB": 4, "STOERFALLV": 5, "ISO27001": 6}
    out.sort(key=lambda x: (order.get(x.regulation_code, 9), x.provision_id))
    return out


@router.get("/requirements/{req_id}")
def requirement_detail(
    req_id: int,
    round_id: int | None = None,
    pr: Principal = Depends(require("catalog.read")),
    db: Session = Depends(get_db),
):
    r = get_or_404(db, Requirement, req_id)
    if round_id is None:
        round_id = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    answers = []
    if pr.has_any("assessments.read"):
        rows = db.scalars(
            select(Answer)
            .join(Assessment)
            .where(Answer.requirement_id == r.id, Assessment.round_id == round_id)
        ).all()
        for a in sorted(rows, key=lambda a: a.assessment.entity.sort_order):
            ent = a.assessment.entity
            if not pr.can("assessments.read", ent.id):
                continue
            answers.append(
                {
                    "answer_id": a.id,
                    "assessment_id": a.assessment_id,
                    "entity": {"id": ent.id, "code": ent.code, "name": ent.name},
                    "scope": a.scope,
                    "implemented": a.implemented,
                    "documented": a.documented,
                    "effectiveness": a.effectiveness,
                    "score": a.score,
                    "wp_required": a.wp_required,
                    "finding_id": a.finding_id,
                    "evidence": a.evidence,
                    "gap_description": a.gap_description,
                    "recommended_action": a.recommended_action,
                    "responsible": a.responsible.name if a.responsible else None,
                    "updated_at": a.updated_at,
                }
            )
    items = []
    if pr.has_any("findings.read"):
        for it in db.scalars(select(ActionItem).where(ActionItem.requirement_id == r.id)):
            if pr.can("findings.read", it.entity_id):
                items.append(
                    {
                        "id": it.id,
                        "code": it.code,
                        "title": it.title,
                        "status": it.status,
                        "priority": it.priority,
                        "entity_code": it.entity.code,
                        "target_date": it.target_date,
                    }
                )
    return {
        "requirement": RequirementOut.model_validate(r),
        "chapter": ChapterOut.model_validate(r.chapter),
        "provisions": provision_links(db, r.id) if pr.has_any("regulations.read") else [],
        "answers": answers,
        "action_items": items,
        "documents": doc_links_for(db, pr, "requirement", r.id) if pr.has_any("documents.read") else [],
        "round_id": round_id,
    }


class RequirementUpdate(BaseModel):
    guidance: str | None = None
    is_core: bool | None = None
    section: str | None = Field(default=None, max_length=400)
    text: str | None = None
    check_points: str | None = None
    legal_reference: str | None = Field(default=None, max_length=400)
    iso_reference: str | None = Field(default=None, max_length=400)


@router.patch("/requirements/{req_id}", response_model=RequirementOut)
def update_requirement(
    req_id: int,
    body: RequirementUpdate,
    pr: Principal = Depends(require_global("catalog.manage")),
    db: Session = Depends(get_db),
):
    r = get_or_404(db, Requirement, req_id)
    diff = apply_changes(r, body.model_dump(exclude_unset=True))
    audit(db, pr, "update", "requirement", r.id, r.number, details=diff)
    db.commit()
    index_object(db, "requirement", r.id)
    return r


class LinkIn(BaseModel):
    provision_id: int
    relation: str = Field(
        default="related", pattern="^(benchmark|legal_basis|national_equivalent|iso_mapping|related)$"
    )
    note: str | None = None


@router.post("/requirements/{req_id}/provisions", response_model=Ok)
def add_provision_link(
    req_id: int,
    body: LinkIn,
    pr: Principal = Depends(require_global("regulations.manage")),
    db: Session = Depends(get_db),
):
    r = get_or_404(db, Requirement, req_id)
    p = get_or_404(db, Provision, body.provision_id)
    if db.scalar(
        select(RequirementProvision).where(
            RequirementProvision.requirement_id == r.id, RequirementProvision.provision_id == p.id
        )
    ):
        raise HTTPException(409, "Already linked")
    db.add(
        RequirementProvision(
            requirement_id=r.id, provision_id=p.id, relation=body.relation, note=body.note, is_auto=False
        )
    )
    audit(db, pr, "link", "requirement", r.id, f"{r.number} -> {p.regulation.code} {p.ref}")
    db.commit()
    return Ok()


@router.delete("/requirement-provisions/{link_id}", response_model=Ok)
def remove_provision_link(
    link_id: int, pr: Principal = Depends(require_global("regulations.manage")), db: Session = Depends(get_db)
):
    rp = get_or_404(db, RequirementProvision, link_id)
    audit(
        db,
        pr,
        "unlink",
        "requirement",
        rp.requirement_id,
        f"{rp.provision.regulation.code} {rp.provision.ref}",
    )
    db.delete(rp)
    db.commit()
    return Ok()
