from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.util import doc_links_for, get_or_404
from app.core.deps import Principal, require, require_global
from app.db import get_db
from app.models import (
    Answer,
    Assessment,
    AssessmentRound,
    Provision,
    Regulation,
    Requirement,
    RequirementProvision,
)
from app.schemas.common import ORM, Ok
from app.services.audit import audit
from app.services.indexing import index_object
from app.services.search import search

router = APIRouter(prefix="/regulations", tags=["regulations"])


class RegulationOut(ORM):
    id: int
    code: str
    title: str
    short_title: str
    kind: str
    jurisdiction: str
    language: str
    version_date: date | None
    source_url: str | None
    status_note: str | None
    license_note: str | None
    is_builtin: bool
    provision_count: int = 0
    linked_requirements: int = 0


@router.get("", response_model=list[RegulationOut])
def list_regulations(pr: Principal = Depends(require("regulations.read")), db: Session = Depends(get_db)):
    counts = dict(
        db.execute(select(Provision.regulation_id, func.count()).group_by(Provision.regulation_id)).all()
    )
    linked = dict(
        db.execute(
            select(Provision.regulation_id, func.count(func.distinct(RequirementProvision.requirement_id)))
            .join(RequirementProvision, RequirementProvision.provision_id == Provision.id)
            .group_by(Provision.regulation_id)
        ).all()
    )
    out = []
    for r in db.scalars(select(Regulation).order_by(Regulation.sort_order, Regulation.id)):
        ro = RegulationOut.model_validate(r)
        ro.provision_count = counts.get(r.id, 0)
        ro.linked_requirements = linked.get(r.id, 0)
        out.append(ro)
    return out


@router.get("/search")
def search_regulations(
    q: str = Query(min_length=1, max_length=300),
    regulation_id: int | None = None,
    limit: int = Query(default=30, ge=1, le=100),
    pr: Principal = Depends(require("regulations.read")),
    db: Session = Depends(get_db),
):
    code = get_or_404(db, Regulation, regulation_id).code if regulation_id else None
    hits = search(db, pr, q, types=["provision"], limit=limit * (3 if regulation_id else 1))
    out = []
    for h in hits:
        if code and (h.meta or {}).get("regulation") != code:
            continue
        out.append(h.as_dict())
    return out[:limit]


@router.get("/{reg_id}")
def get_regulation(
    reg_id: int, pr: Principal = Depends(require("regulations.read")), db: Session = Depends(get_db)
):
    reg = get_or_404(db, Regulation, reg_id)
    provs = db.scalars(
        select(Provision).where(Provision.regulation_id == reg.id).order_by(Provision.sort_order)
    ).all()
    link_counts = dict(
        db.execute(
            select(RequirementProvision.provision_id, func.count())
            .join(Provision)
            .where(Provision.regulation_id == reg.id)
            .group_by(RequirementProvision.provision_id)
        ).all()
    )
    return {
        "regulation": RegulationOut.model_validate(reg),
        "provisions": [
            {
                "id": p.id,
                "parent_id": p.parent_id,
                "key": p.key,
                "ref": p.ref,
                "heading": p.heading,
                "text": p.text,
                "depth": p.depth,
                "links": link_counts.get(p.id, 0),
            }
            for p in provs
        ],
    }


@router.get("/provisions/{prov_id}")
def provision_detail(
    prov_id: int, pr: Principal = Depends(require("regulations.read")), db: Session = Depends(get_db)
):
    p = get_or_404(db, Provision, prov_id)
    ancestors = []
    cur = p
    while cur.parent_id:
        cur = db.get(Provision, cur.parent_id)
        ancestors.insert(0, {"id": cur.id, "ref": cur.ref, "heading": cur.heading})
    # collect this provision and all descendants for "linked via sub-provisions"
    ids = {p.id}
    frontier = [p.id]
    while frontier:
        kids = db.scalars(select(Provision.id).where(Provision.parent_id.in_(frontier))).all()
        frontier = [k for k in kids if k not in ids]
        ids.update(frontier)
    links = db.scalars(select(RequirementProvision).where(RequirementProvision.provision_id.in_(ids))).all()
    req_ids = sorted({rp.requirement_id for rp in links})
    reqs = {r.id: r for r in db.scalars(select(Requirement).where(Requirement.id.in_(req_ids)))}
    rnd = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    status: dict[int, list[dict]] = {}
    if pr.has_any("assessments.read") and req_ids and rnd:
        for a in db.scalars(
            select(Answer)
            .join(Assessment)
            .where(Answer.requirement_id.in_(req_ids), Assessment.round_id == rnd)
        ):
            if pr.can("assessments.read", a.assessment.entity_id):
                status.setdefault(a.requirement_id, []).append(
                    {
                        "entity_code": a.assessment.entity.code,
                        "score": a.score,
                        "scope": a.scope,
                        "implemented": a.implemented,
                        "assessment_id": a.assessment_id,
                    }
                )
    requirements = []
    for rp in links:
        r = reqs.get(rp.requirement_id)
        if not r:
            continue
        requirements.append(
            {
                "link_id": rp.id,
                "relation": rp.relation,
                "direct": rp.provision_id == p.id,
                "is_auto": rp.is_auto,
                "requirement": {
                    "id": r.id,
                    "number": r.number,
                    "section": r.section,
                    "chapter": r.chapter.number,
                    "is_core": r.is_core,
                },
                "status": sorted(status.get(r.id, []), key=lambda x: x["entity_code"]),
            }
        )
    requirements.sort(key=lambda x: (not x["direct"], reqs[x["requirement"]["id"]].sort_order))
    # de-duplicate requirements that are linked via several sub-provisions
    seen, uniq = set(), []
    for x in requirements:
        if x["requirement"]["id"] in seen:
            continue
        seen.add(x["requirement"]["id"])
        uniq.append(x)
    children = db.scalars(
        select(Provision).where(Provision.parent_id == p.id).order_by(Provision.sort_order)
    ).all()
    return {
        "provision": {
            "id": p.id,
            "key": p.key,
            "ref": p.ref,
            "heading": p.heading,
            "text": p.text,
            "depth": p.depth,
            "regulation": RegulationOut.model_validate(p.regulation),
        },
        "ancestors": ancestors,
        "children": [{"id": c.id, "ref": c.ref, "heading": c.heading, "text": c.text} for c in children],
        "requirements": uniq,
        "documents": doc_links_for(db, pr, "provision", p.id) if pr.has_any("documents.read") else [],
    }


# --- custom regulations (internal standards, contracts, sector rules ...) -------------------------------


class ProvisionIn(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    ref: str = Field(min_length=1, max_length=120)
    heading: str | None = None
    text: str | None = None
    children: list["ProvisionIn"] = []


class RegulationIn(BaseModel):
    code: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_\-/.]+$")
    title: str = Field(min_length=1)
    short_title: str = Field(min_length=1, max_length=200)
    kind: str = Field(default="internal_standard", max_length=40)
    jurisdiction: str = Field(default="INT", max_length=10)
    language: str = Field(default="en", max_length=5)
    version_date: date | None = None
    source_url: str | None = Field(default=None, pattern=r"^https?://")
    status_note: str | None = None
    license_note: str | None = None
    provisions: list[ProvisionIn] = []


@router.post("", response_model=RegulationOut)
def create_regulation(
    body: RegulationIn,
    pr: Principal = Depends(require_global("regulations.manage")),
    db: Session = Depends(get_db),
):
    if db.scalar(select(Regulation).where(Regulation.code == body.code)):
        raise HTTPException(409, "Regulation code exists")
    reg = Regulation(
        **body.model_dump(exclude={"provisions"}),
        is_builtin=False,
        sort_order=(db.scalar(select(func.max(Regulation.sort_order))) or 0) + 1,
    )
    db.add(reg)
    db.flush()
    counter = [0]
    keys: set[str] = set()

    def add(nodes: list[ProvisionIn], parent_id, depth):
        for n in nodes:
            if n.key in keys:
                raise HTTPException(400, f"Duplicate provision key {n.key}")
            keys.add(n.key)
            counter[0] += 1
            prov = Provision(
                regulation_id=reg.id,
                parent_id=parent_id,
                key=n.key,
                ref=n.ref,
                heading=n.heading,
                text=n.text,
                depth=depth,
                sort_order=counter[0] * 10,
            )
            db.add(prov)
            db.flush()
            add(n.children, prov.id, depth + 1)

    add(body.provisions, None, 0)
    audit(db, pr, "create", "regulation", reg.id, reg.code, details={"provisions": counter[0]})
    db.commit()
    for pid in db.scalars(select(Provision.id).where(Provision.regulation_id == reg.id)):
        index_object(db, "provision", pid, commit=False)
    db.commit()
    return RegulationOut.model_validate(reg)


@router.delete("/{reg_id}", response_model=Ok)
def delete_regulation(
    reg_id: int, pr: Principal = Depends(require_global("regulations.manage")), db: Session = Depends(get_db)
):
    reg = get_or_404(db, Regulation, reg_id)
    if reg.is_builtin:
        raise HTTPException(400, "Built-in regulations cannot be deleted")
    from app.models import SearchChunk

    pids = list(db.scalars(select(Provision.id).where(Provision.regulation_id == reg.id)))
    db.query(SearchChunk).filter(
        SearchChunk.source_type == "provision", SearchChunk.source_id.in_(pids)
    ).delete()
    audit(db, pr, "delete", "regulation", reg.id, reg.code)
    db.delete(reg)
    db.commit()
    return Ok()
