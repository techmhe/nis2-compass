from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import doc_links_for, get_or_404
from app.core.deps import Principal, client_ip, get_principal, require, require_global
from app.db import get_db, utcnow
from app.models import (
    Answer,
    AnswerRevision,
    Assessment,
    AssessmentRound,
    Chapter,
    Comment,
    Entity,
    Requirement,
    Task,
    User,
)
from app.schemas.common import ORM, Ok, StakeholderBrief, UserBrief
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object
from app.services.scoring import recalc
from app.services.stats import assessment_stats, chapter_scores

router = APIRouter(tags=["assessments"])

Scope = Literal["In Scope", "Central at HQ", "Not Applicable"]
Impl = Literal["Yes", "Partial", "No", "N/A"]
Eff = Literal["Effective", "Partial", "Not Tested", "Ineffective", "N/A"]
Effort = Literal["Low", "Medium", "High"]


# --- rounds ---------------------------------------------------------------------------------------------


class RoundOut(ORM):
    id: int
    name: str
    description: str | None
    start_date: date | None
    end_date: date | None
    status: str
    is_current: bool
    targets_snapshot: dict | None


class RoundIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    copy_from_round_id: int | None = None  # pre-fill answers from a previous round
    make_current: bool = True


@router.get("/rounds", response_model=list[RoundOut])
def list_rounds(pr: Principal = Depends(require("assessments.read")), db: Session = Depends(get_db)):
    return db.scalars(select(AssessmentRound).order_by(AssessmentRound.id.desc())).all()


@router.post("/rounds", response_model=RoundOut)
def create_round(
    body: RoundIn,
    pr: Principal = Depends(require_global("assessments.manage")),
    db: Session = Depends(get_db),
):
    rnd = AssessmentRound(
        name=body.name,
        description=body.description,
        start_date=body.start_date,
        end_date=body.end_date,
        status="active",
    )
    db.add(rnd)
    db.flush()
    if body.make_current:
        for r in db.scalars(select(AssessmentRound).where(AssessmentRound.id != rnd.id)):
            r.is_current = False
        rnd.is_current = True
    reqs = db.scalars(select(Requirement).where(Requirement.is_active.is_(True))).all()
    prev: dict[tuple[int, int], Answer] = {}
    if body.copy_from_round_id:
        for a in db.scalars(
            select(Answer).join(Assessment).where(Assessment.round_id == body.copy_from_round_id)
        ):
            prev[(a.assessment.entity_id, a.requirement_id)] = a
    copy_fields = (
        "scope",
        "implemented",
        "documented",
        "effectiveness",
        "evidence",
        "gap_description",
        "recommended_action",
        "responsible_id",
        "target_date",
        "effort",
        "notes",
    )
    for ent in db.scalars(select(Entity).where(Entity.is_active.is_(True))):
        asm = Assessment(round_id=rnd.id, entity_id=ent.id)
        db.add(asm)
        db.flush()
        for r in reqs:
            a = Answer(assessment_id=asm.id, requirement_id=r.id, scope="In Scope")
            old = prev.get((ent.id, r.id))
            if old:
                for f in copy_fields:
                    setattr(a, f, getattr(old, f))
            a.requirement = r
            recalc(a, ent.finding_prefix)
            db.add(a)
    audit(db, pr, "create", "round", rnd.id, rnd.name, details={"copied_from": body.copy_from_round_id})
    db.commit()
    return rnd


class RoundUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: Literal["planned", "active", "closed"] | None = None
    is_current: bool | None = None


@router.patch("/rounds/{round_id}", response_model=RoundOut)
def update_round(
    round_id: int,
    body: RoundUpdate,
    pr: Principal = Depends(require_global("assessments.manage")),
    db: Session = Depends(get_db),
):
    rnd = get_or_404(db, AssessmentRound, round_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("is_current"):
        for r in db.scalars(select(AssessmentRound)):
            r.is_current = False
    if data.get("status") == "closed" and rnd.status != "closed":
        rnd.targets_snapshot = {str(c.number): c.target for c in db.scalars(select(Chapter))}
    diff = apply_changes(rnd, data)
    audit(db, pr, "update", "round", rnd.id, rnd.name, details=diff)
    db.commit()
    return rnd


# --- assessments ----------------------------------------------------------------------------------------


class AssessmentOut(ORM):
    id: int
    round_id: int
    entity_id: int
    status: str
    assessment_date: date | None
    due_date: date | None
    respondents: str | None
    assessors: str | None
    lead_user_id: int | None
    summary: str | None
    locked: bool
    completed_at: datetime | None


@router.get("/assessments")
def list_assessments(
    round_id: int | None = None,
    pr: Principal = Depends(require("assessments.read")),
    db: Session = Depends(get_db),
):
    if round_id is None:
        round_id = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    rows = db.scalars(select(Assessment).where(Assessment.round_id == round_id)).all()
    out = []
    for asm in sorted(rows, key=lambda a: a.entity.sort_order):
        if not pr.can("assessments.read", asm.entity_id):
            continue
        answers = db.scalars(select(Answer).where(Answer.assessment_id == asm.id)).all()
        out.append(
            {
                **AssessmentOut.model_validate(asm).model_dump(),
                "entity": {
                    "id": asm.entity.id,
                    "code": asm.entity.code,
                    "name": asm.entity.name,
                    "country": asm.entity.country,
                },
                "round_name": asm.round.name,
                "stats": assessment_stats(answers),
            }
        )
    return out


@router.get("/assessments/{assessment_id}")
def get_assessment(
    assessment_id: int, pr: Principal = Depends(require("assessments.read")), db: Session = Depends(get_db)
):
    asm = get_or_404(db, Assessment, assessment_id)
    pr.ensure("assessments.read", asm.entity_id)
    answers = db.scalars(select(Answer).where(Answer.assessment_id == asm.id)).all()
    lead = db.get(User, asm.lead_user_id) if asm.lead_user_id else None
    return {
        **AssessmentOut.model_validate(asm).model_dump(),
        "entity": {
            "id": asm.entity.id,
            "code": asm.entity.code,
            "name": asm.entity.name,
            "country": asm.entity.country,
            "finding_prefix": asm.entity.finding_prefix,
        },
        "round": RoundOut.model_validate(asm.round).model_dump(),
        "lead": UserBrief.model_validate(lead).model_dump() if lead else None,
        "stats": assessment_stats(answers),
        "chapters": chapter_scores(answers),
        "can_edit": pr.can("assessments.edit", asm.entity_id)
        and (not asm.locked or pr.can("assessments.manage", asm.entity_id)),
        "can_manage": pr.can("assessments.manage", asm.entity_id),
    }


class AssessmentUpdate(BaseModel):
    status: Literal["not_started", "in_progress", "in_review", "completed"] | None = None
    assessment_date: date | None = None
    due_date: date | None = None
    respondents: str | None = None
    assessors: str | None = None
    lead_user_id: int | None = None
    summary: str | None = None
    locked: bool | None = None


@router.patch("/assessments/{assessment_id}", response_model=AssessmentOut)
def update_assessment(
    assessment_id: int,
    body: AssessmentUpdate,
    request: Request,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    asm = get_or_404(db, Assessment, assessment_id)
    data = body.model_dump(exclude_unset=True)
    manage_fields = {"status", "locked", "lead_user_id", "due_date"}
    if manage_fields & set(data) or asm.locked:
        pr.ensure("assessments.manage", asm.entity_id, write=True)
    else:
        pr.ensure("assessments.edit", asm.entity_id, write=True)
    if data.get("status") == "completed" and asm.status != "completed":
        asm.completed_at = utcnow()
    diff = apply_changes(asm, data)
    audit(
        db,
        pr,
        "update",
        "assessment",
        asm.id,
        f"{asm.entity.code} {asm.round.name}",
        entity_id=asm.entity_id,
        details=diff,
        ip=client_ip(request),
    )
    db.commit()
    return asm


# --- answers --------------------------------------------------------------------------------------------


class AnswerRow(BaseModel):
    id: int
    requirement_id: int
    number: str
    chapter: int
    section: str
    text: str
    is_core: bool
    scope: str
    implemented: str | None
    documented: str | None
    effectiveness: str | None
    evidence: str | None
    gap_description: str | None
    recommended_action: str | None
    responsible: StakeholderBrief | None
    target_date: date | None
    effort: str | None
    notes: str | None
    review_status: str
    score: float | None
    wp_required: bool | None
    finding_id: str | None
    updated_at: datetime
    doc_count: int = 0
    comment_count: int = 0


def _row(
    a: Answer, doc_counts: dict[int, int] | None = None, comment_counts: dict[int, int] | None = None
) -> AnswerRow:
    r = a.requirement
    return AnswerRow(
        id=a.id,
        requirement_id=r.id,
        number=r.number,
        chapter=r.chapter.number,
        section=r.section,
        text=r.text,
        is_core=r.is_core,
        scope=a.scope,
        implemented=a.implemented,
        documented=a.documented,
        effectiveness=a.effectiveness,
        evidence=a.evidence,
        gap_description=a.gap_description,
        recommended_action=a.recommended_action,
        responsible=StakeholderBrief.model_validate(a.responsible) if a.responsible else None,
        target_date=a.target_date,
        effort=a.effort,
        notes=a.notes,
        review_status=a.review_status,
        score=a.score,
        wp_required=a.wp_required,
        finding_id=a.finding_id,
        updated_at=a.updated_at,
        doc_count=(doc_counts or {}).get(a.id, 0),
        comment_count=(comment_counts or {}).get(a.id, 0),
    )


@router.get("/assessments/{assessment_id}/answers", response_model=list[AnswerRow])
def list_answers(
    assessment_id: int, pr: Principal = Depends(require("assessments.read")), db: Session = Depends(get_db)
):
    from sqlalchemy import func

    from app.models import DocumentLink

    asm = get_or_404(db, Assessment, assessment_id)
    pr.ensure("assessments.read", asm.entity_id)
    answers = db.scalars(select(Answer).where(Answer.assessment_id == asm.id)).all()
    ids = [a.id for a in answers]
    docs = dict(
        db.execute(
            select(DocumentLink.target_id, func.count())
            .where(DocumentLink.target_type == "answer", DocumentLink.target_id.in_(ids))
            .group_by(DocumentLink.target_id)
        ).all()
    )
    comments = dict(
        db.execute(
            select(Comment.target_id, func.count())
            .where(Comment.target_type == "answer", Comment.target_id.in_(ids))
            .group_by(Comment.target_id)
        ).all()
    )
    answers.sort(key=lambda a: a.requirement.sort_order)
    return [_row(a, docs, comments) for a in answers]


class AnswerUpdate(BaseModel):
    scope: Scope | None = None
    implemented: Impl | None = None
    documented: Impl | None = None
    effectiveness: Eff | None = None
    evidence: str | None = Field(default=None, max_length=10000)
    gap_description: str | None = Field(default=None, max_length=10000)
    recommended_action: str | None = Field(default=None, max_length=10000)
    responsible_id: int | None = None
    target_date: date | None = None
    effort: Effort | None = None
    notes: str | None = Field(default=None, max_length=20000)
    review_status: Literal["draft", "reviewed"] | None = None


def _check_answer_write(pr: Principal, a: Answer) -> None:
    pr.ensure("assessments.edit", a.assessment.entity_id, write=True)
    if a.assessment.locked and not pr.can("assessments.manage", a.assessment.entity_id):
        raise HTTPException(423, "Assessment is locked")


def _apply_answer_update(db: Session, pr: Principal, a: Answer, data: dict) -> dict:
    # empty strings from the UI mean "clear"
    for k in ("implemented", "documented", "effectiveness", "effort"):
        if k in data and data[k] == "":
            data[k] = None
    diff = apply_changes(a, data)
    if not diff:
        return {}
    recalc(a, a.assessment.entity.finding_prefix)
    a.updated_by_id = pr.id
    db.add(AnswerRevision(answer_id=a.id, changed_by_id=pr.id, changes=diff))
    if a.assessment.status == "not_started":
        a.assessment.status = "in_progress"
    return diff


@router.patch("/answers/{answer_id}", response_model=AnswerRow)
def update_answer(
    answer_id: int, body: AnswerUpdate, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    a = get_or_404(db, Answer, answer_id)
    _check_answer_write(pr, a)
    diff = _apply_answer_update(db, pr, a, body.model_dump(exclude_unset=True))
    if diff:
        audit(
            db,
            pr,
            "update",
            "answer",
            a.id,
            f"{a.assessment.entity.code} {a.requirement.number}",
            entity_id=a.assessment.entity_id,
            details=diff,
        )
    db.commit()
    index_object(db, "answer", a.id)
    return _row(a)


class BulkUpdate(BaseModel):
    answer_ids: list[int] = Field(min_length=1, max_length=500)
    changes: AnswerUpdate


@router.post("/assessments/{assessment_id}/answers/bulk", response_model=Ok)
def bulk_update(
    assessment_id: int,
    body: BulkUpdate,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    asm = get_or_404(db, Assessment, assessment_id)
    data = body.changes.model_dump(exclude_unset=True)
    changed = []
    for a in db.scalars(select(Answer).where(Answer.assessment_id == asm.id, Answer.id.in_(body.answer_ids))):
        _check_answer_write(pr, a)
        if _apply_answer_update(db, pr, a, dict(data)):
            changed.append(a.id)
    audit(
        db,
        pr,
        "bulk_update",
        "assessment",
        asm.id,
        asm.entity.code,
        entity_id=asm.entity_id,
        details={"answers": len(changed), "changes": {k: str(v) for k, v in data.items()}},
    )
    db.commit()
    for aid in changed:
        index_object(db, "answer", aid, commit=False)
    db.commit()
    return Ok()


@router.get("/answers/{answer_id}")
def answer_detail(
    answer_id: int, pr: Principal = Depends(require("assessments.read")), db: Session = Depends(get_db)
):
    a = get_or_404(db, Answer, answer_id)
    pr.ensure("assessments.read", a.assessment.entity_id)
    others = []
    for o in db.scalars(
        select(Answer)
        .join(Assessment)
        .where(
            Answer.requirement_id == a.requirement_id,
            Assessment.round_id == a.assessment.round_id,
            Answer.id != a.id,
        )
    ):
        if pr.can("assessments.read", o.assessment.entity_id):
            others.append(
                {
                    "answer_id": o.id,
                    "assessment_id": o.assessment_id,
                    "entity_code": o.assessment.entity.code,
                    "entity_name": o.assessment.entity.name,
                    **_row(o).model_dump(
                        include={
                            "scope",
                            "implemented",
                            "documented",
                            "effectiveness",
                            "evidence",
                            "score",
                            "gap_description",
                            "recommended_action",
                            "finding_id",
                        }
                    ),
                }
            )
    # same entity, previous rounds
    history = []
    for o in db.scalars(
        select(Answer)
        .join(Assessment)
        .where(
            Answer.requirement_id == a.requirement_id,
            Assessment.entity_id == a.assessment.entity_id,
            Answer.id != a.id,
        )
    ):
        history.append(
            {
                "answer_id": o.id,
                "round": o.assessment.round.name,
                "score": o.score,
                "implemented": o.implemented,
                "documented": o.documented,
                "effectiveness": o.effectiveness,
            }
        )
    revs = db.execute(
        select(AnswerRevision, User)
        .outerjoin(User, User.id == AnswerRevision.changed_by_id)
        .where(AnswerRevision.answer_id == a.id)
        .order_by(AnswerRevision.changed_at.desc())
        .limit(100)
    ).all()
    tasks = db.scalars(select(Task).where(Task.answer_id == a.id)).all()
    return {
        "answer": _row(a),
        "requirement": {
            "id": a.requirement.id,
            "number": a.requirement.number,
            "section": a.requirement.section,
            "text": a.requirement.text,
            "check_points": a.requirement.check_points,
            "legal_reference": a.requirement.legal_reference,
            "iso_reference": a.requirement.iso_reference,
            "guidance": a.requirement.guidance,
            "is_core": a.requirement.is_core,
            "chapter": {"number": a.requirement.chapter.number, "title": a.requirement.chapter.title},
        },
        "entity": {
            "id": a.assessment.entity.id,
            "code": a.assessment.entity.code,
            "name": a.assessment.entity.name,
        },
        "other_entities": others,
        "history": history,
        "revisions": [
            {
                "id": r.id,
                "changed_at": r.changed_at,
                "changes": r.changes,
                "by": u.display_name if u else None,
            }
            for r, u in revs
        ],
        "documents": doc_links_for(db, pr, "answer", a.id),
        "tasks": [
            {
                "id": t.id,
                "key": t.key,
                "title": t.title,
                "status": t.status,
                "assignee": t.assignee.display_name if t.assignee else None,
                "due_date": t.due_date,
            }
            for t in tasks
        ],
        "can_edit": pr.can("assessments.edit", a.assessment.entity_id)
        and (not a.assessment.locked or pr.can("assessments.manage", a.assessment.entity_id)),
    }


class CopyIn(BaseModel):
    source_answer_id: int
    fields: list[str] = [
        "scope",
        "implemented",
        "documented",
        "effectiveness",
        "evidence",
        "gap_description",
        "recommended_action",
    ]


@router.post("/answers/{answer_id}/copy", response_model=AnswerRow)
def copy_answer(
    answer_id: int, body: CopyIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    a = get_or_404(db, Answer, answer_id)
    _check_answer_write(pr, a)
    src = get_or_404(db, Answer, body.source_answer_id)
    pr.ensure("assessments.read", src.assessment.entity_id)
    if src.requirement_id != a.requirement_id:
        raise HTTPException(400, "Source answer belongs to a different requirement")
    allowed = set(AnswerUpdate.model_fields) - {"review_status"}
    data = {f: getattr(src, f) for f in body.fields if f in allowed}
    diff = _apply_answer_update(db, pr, a, data)
    audit(
        db,
        pr,
        "copy",
        "answer",
        a.id,
        f"{a.assessment.entity.code} {a.requirement.number}",
        entity_id=a.assessment.entity_id,
        details={"from": src.id, **diff},
    )
    db.commit()
    index_object(db, "answer", a.id)
    return _row(a)


@router.post("/answers/{answer_id}/restore/{revision_id}", response_model=AnswerRow)
def restore_revision(
    answer_id: int, revision_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    """Revert the changes of one revision (sets fields back to their 'old' values)."""
    a = get_or_404(db, Answer, answer_id)
    _check_answer_write(pr, a)
    rev = get_or_404(db, AnswerRevision, revision_id)
    if rev.answer_id != a.id:
        raise HTTPException(400, "Revision does not belong to this answer")
    allowed = set(AnswerUpdate.model_fields)
    data = {}
    for k, (old, _new) in rev.changes.items():
        if k not in allowed:
            continue
        if k == "target_date" and old:
            old = date.fromisoformat(old)
        data[k] = old
    AnswerUpdate(**{k: v for k, v in data.items()})  # validate
    diff = _apply_answer_update(db, pr, a, data)
    audit(
        db,
        pr,
        "restore",
        "answer",
        a.id,
        f"{a.assessment.entity.code} {a.requirement.number}",
        entity_id=a.assessment.entity_id,
        details={"revision": rev.id, **diff},
    )
    db.commit()
    index_object(db, "answer", a.id)
    return _row(a)
