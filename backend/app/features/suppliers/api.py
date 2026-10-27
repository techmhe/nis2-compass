"""Supplier register (IR 2024/2690 point 5.2), contract clause checklist (5.1.4), certificates with expiry,
supplier assessments with tier-based review cycle and questionnaires with an Excel round-trip.

Suppliers are group-level master records used by one or more entities. Everybody holding suppliers.read may
read the register; maintaining a supplier needs suppliers.manage group-wide or for one of its using entities."""

import asyncio
import io
from datetime import date
from typing import Literal

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from openpyxl.styles import Font, PatternFill
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, insert, or_, select
from sqlalchemy.orm import Session, selectinload

import app.features.suppliers.hooks  # noqa: F401  (registers search source and comment target)
from app.api.util import cleanup_target, doc_links_for, get_or_404, next_code
from app.config import get_settings
from app.core.deps import Principal, get_principal, require
from app.db import SessionLocal, get_db
from app.features.inventory.actions import create_action_item, reindex_after
from app.features.suppliers.logic import (
    ACCESS_TYPES,
    CERT_TYPES,
    CLAUSE_CODES,
    CLAUSE_STATUSES,
    CLAUSES,
    METHODS,
    RATINGS,
    REVIEW_MONTHS,
    STATUSES,
    TIERS,
    add_months,
    cert_state,
    dependency_map,
    due_state,
    effective_tier,
)
from app.features.suppliers.models import (
    QuestionnaireTemplate,
    Supplier,
    SupplierAssessment,
    SupplierCertificate,
    SupplierClause,
    supplier_entities,
    supplier_incidents,
)
from app.features.suppliers.questionnaire import build_questionnaire_xlsx, parse_questionnaire_xlsx, read_meta
from app.models import Document, Entity, Incident, Provision, Regulation, Stakeholder, User
from app.schemas.common import EntityBrief, Ok
from app.services.audit import apply_changes, audit
from app.services.indexing import index_object, remove_object

router = APIRouter(prefix="/suppliers", tags=["suppliers"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")

AccessType = Literal["none", "it_remote", "ot_remote", "cloud_data"]
Tier = Literal["critical", "high", "standard"]
SupStatus = Literal["active", "onboarding", "offboarded"]
Method = Literal["questionnaire", "certificate_review", "audit", "on_site"]
Rating = Literal["acceptable", "conditional", "not_acceptable"]
ClauseStatus = Literal["agreed", "partial", "missing", "na"]
Severity = Literal["high", "medium", "low"]


# --- permission helpers ----------------------------------------------------------------------------------


def _entity_ids(db: Session, supplier_id: int) -> list[int]:
    return list(
        db.scalars(
            select(supplier_entities.c.entity_id).where(supplier_entities.c.supplier_id == supplier_id)
        )
    )


def can_manage(pr: Principal, entity_ids: list[int]) -> bool:
    """Group-wide supplier managers, or managers of every using entity (shared master data)."""
    if "suppliers.manage" in pr.global_perms:
        return True
    return bool(entity_ids) and all(pr.can("suppliers.manage", e) for e in entity_ids)


def can_see(pr: Principal, entity_ids: list[int]) -> bool:
    """Group suppliers (no using entity) are visible to every supplier reader; others to readers of any using
    entity."""
    if "suppliers.read" in pr.global_perms:
        return True
    if not entity_ids:
        return pr.has_any("suppliers.read")
    return any(pr.can("suppliers.read", e) for e in entity_ids)


def visible_supplier_ids(db: Session, pr: Principal) -> set[int]:
    """Ids of all suppliers the caller may see (one query, for rendering and validating many at once)."""
    by_supplier: dict[int, list[int]] = {sid: [] for sid in db.scalars(select(Supplier.id))}
    for sid, eid in db.execute(select(supplier_entities.c.supplier_id, supplier_entities.c.entity_id)):
        by_supplier.setdefault(sid, []).append(eid)
    return {sid for sid, ents in by_supplier.items() if can_see(pr, ents)}


def _ensure_see(db: Session, pr: Principal, s: Supplier) -> list[int]:
    ids = _entity_ids(db, s.id)
    if not can_see(pr, ids):
        raise HTTPException(404, "Supplier not found")
    return ids


def _ensure_manage(db: Session, pr: Principal, s: Supplier) -> list[int]:
    ids = _ensure_see(db, pr, s)
    if not can_manage(pr, ids):
        raise HTTPException(403, "Missing permission: suppliers.manage")
    return ids


def _check_entity_change(db: Session, pr: Principal, old: list[int], new: list[int]) -> None:
    for eid in set(new) - set(old):
        if not db.get(Entity, eid):
            raise HTTPException(400, f"Entity {eid} not found")
    if "suppliers.manage" in pr.global_perms:
        return
    if not new:
        raise HTTPException(
            403, "Only group-wide supplier managers may maintain suppliers without a using entity"
        )
    for eid in set(old) ^ set(new):
        if not pr.can("suppliers.manage", eid):
            raise HTTPException(403, "You may only add or remove entities you manage suppliers for")


# --- schemas ---------------------------------------------------------------------------------------------


class Contact(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    role: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=60)


class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    legal_name: str | None = Field(default=None, max_length=300)
    country: str | None = Field(default=None, max_length=2)
    website: str | None = Field(default=None, max_length=300)
    description: str | None = None
    services_products: str | None = None
    category: str | None = Field(default=None, max_length=100)
    access_type: AccessType = "none"
    tier: Tier | None = None
    tier_overridden: bool = False
    tier_rationale: str | None = None
    status: SupStatus = "active"
    contacts: list[Contact] = Field(default_factory=list, max_length=30)
    relationship_owner_id: int | None = None
    contract_reference: str | None = Field(default=None, max_length=200)
    contract_end: date | None = None
    notes: str | None = None
    entity_ids: list[int] = Field(default_factory=list, max_length=50)

    @field_validator("country")
    @classmethod
    def _upper(cls, v: str | None) -> str | None:
        return v.strip().upper() or None if v else None


class CertificateIn(BaseModel):
    cert_type: str = Field(min_length=1, max_length=60)
    scope: str | None = None
    issuer: str | None = Field(default=None, max_length=200)
    valid_until: date | None = None
    document_id: int | None = None
    notes: str | None = None


class ClauseIn(BaseModel):
    status: ClauseStatus
    document_id: int | None = None
    reference: str | None = Field(default=None, max_length=200)
    note: str | None = None


class FindingIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    severity: Severity = "medium"
    question_id: str | None = Field(default=None, max_length=10)
    # action plan links are server state (set by the findings -> action item endpoint), never client input


class AssessmentIn(BaseModel):
    assessed_on: date
    method: Method
    score: float | None = Field(default=None, ge=0, le=100)
    rating: Rating | None = None
    summary: str | None = None
    findings: list[FindingIn] = Field(default_factory=list, max_length=200)
    next_due: date | None = None


class FindingActionIn(BaseModel):
    entity_id: int
    title: str | None = Field(default=None, max_length=4000)
    priority: Literal["High", "Medium", "Low"] = "Medium"
    target_date: date | None = None
    responsible_id: int | None = None
    requirement_number: str = Field(default="5.1.6", max_length=20)


class QuestionIn(BaseModel):
    id: str | None = Field(default=None, max_length=10)
    section: str | None = Field(default=None, max_length=100)
    text: str = Field(min_length=1, max_length=2000)
    reference: str | None = Field(default=None, max_length=200)
    weight: int = Field(default=1, ge=1, le=5)


class TemplateIn(BaseModel):
    tier: Tier
    title: str = Field(min_length=1, max_length=300)
    questions: list[QuestionIn] = Field(min_length=1, max_length=200)
    change_note: str | None = None


class IncidentLinkIn(BaseModel):
    incident_id: int


# --- output helpers --------------------------------------------------------------------------------------


def _entities_map(db: Session) -> dict[int, Entity]:
    return {e.id: e for e in db.scalars(select(Entity))}


def _sup_entities(db: Session) -> dict[int, list[int]]:
    out: dict[int, list[int]] = {}
    for sid, eid in db.execute(select(supplier_entities.c.supplier_id, supplier_entities.c.entity_id)):
        out.setdefault(sid, []).append(eid)
    return out


def _owner(db: Session, sid: int | None) -> dict | None:
    st = db.get(Stakeholder, sid) if sid else None
    return {"id": st.id, "name": st.name} if st else None


def _doc_brief(db: Session, pr: Principal, doc_id: int | None) -> dict | None:
    if not doc_id:
        return None
    from app.api.util import can_see_document

    d = db.get(Document, doc_id)
    if not d or not can_see_document(pr, d):
        return None
    return {"id": d.id, "title": d.title, "status": d.status}


def _cert_out(db: Session, pr: Principal, c: SupplierCertificate) -> dict:
    return {
        "id": c.id,
        "cert_type": c.cert_type,
        "scope": c.scope,
        "issuer": c.issuer,
        "valid_until": c.valid_until,
        "state": cert_state(c.valid_until),
        "document": _doc_brief(db, pr, c.document_id),
        "notes": c.notes,
    }


def _assessment_out(db: Session, a: SupplierAssessment) -> dict:
    assessor = db.get(User, a.assessor_id) if a.assessor_id else None
    return {
        "id": a.id,
        "assessed_on": a.assessed_on,
        "method": a.method,
        "score": a.score,
        "rating": a.rating,
        "summary": a.summary,
        "findings": a.findings or [],
        "answers": a.answers or [],
        "template_id": a.template_id,
        "template_version": a.template_version,
        "next_due": a.next_due,
        "assessor": assessor.display_name if assessor else None,
        "created_at": a.created_at,
    }


def _summary(
    s: Supplier,
    ents: dict[int, Entity],
    ent_ids: list[int],
    dep_svc: list[dict],
    dep_ast: list[dict],
    owner: dict | None,
) -> dict:
    tier, suggested, reason = effective_tier(s, dep_svc)
    last = s.assessments[0] if s.assessments else None
    next_due = (last.next_due or add_months(last.assessed_on, REVIEW_MONTHS[tier])) if last else None
    clause_map = {c.clause: c.status for c in s.clauses}
    clauses = {code: clause_map.get(code, "missing") for code in CLAUSE_CODES}
    counts = {k: sum(1 for v in clauses.values() if v == k) for k in CLAUSE_STATUSES}
    cert_states = [cert_state(c.valid_until) for c in s.certificates]
    return {
        "id": s.id,
        "code": s.code,
        "name": s.name,
        "legal_name": s.legal_name,
        "country": s.country,
        "category": s.category,
        "access_type": s.access_type,
        "tier": tier,
        "suggested_tier": suggested,
        "tier_reason": reason,
        "tier_overridden": s.tier_overridden,
        "status": s.status,
        "services_products": s.services_products,
        "entities": [EntityBrief.model_validate(ents[e]).model_dump() for e in sorted(ent_ids) if e in ents],
        "relationship_owner": owner,
        "clauses": clauses,
        "clause_counts": counts,
        "certificates": {
            "total": len(cert_states),
            "valid": cert_states.count("valid"),
            "expiring": cert_states.count("expiring"),
            "expired": cert_states.count("expired"),
            "types": sorted({c.cert_type for c in s.certificates if cert_state(c.valid_until) != "expired"}),
        },
        "last_assessment": {
            "id": last.id,
            "assessed_on": last.assessed_on,
            "method": last.method,
            "score": last.score,
            "rating": last.rating,
        }
        if last
        else None,
        "next_due": next_due,
        "due_state": due_state(next_due, last is not None, s.status),
        "dependent_services": len(dep_svc),
        "dependent_assets": len(dep_ast),
        "max_service_criticality": max((d["criticality"] for d in dep_svc), default=None),
        "updated_at": s.updated_at,
    }


def _load(db: Session, supplier_id: int) -> Supplier:
    s = db.scalar(
        select(Supplier)
        .where(Supplier.id == supplier_id)
        .options(
            selectinload(Supplier.certificates),
            selectinload(Supplier.clauses),
            selectinload(Supplier.assessments),
        )
        .execution_options(populate_existing=True)
    )
    if not s:
        raise HTTPException(404, "Supplier not found")
    return s


def _provision_link(db: Session) -> dict | None:
    row = db.execute(
        select(Provision.id, Provision.regulation_id)
        .join(Regulation)
        .where(Regulation.code == "IR2024/2690", Provision.key == "annex.5.1.4")
    ).first()
    return (
        {"regulation_id": row[1], "provision_id": row[0], "url": f"/regulations/{row[1]}?p={row[0]}"}
        if row
        else None
    )


def _detail(db: Session, pr: Principal, s: Supplier) -> dict:
    ents = _entities_map(db)
    ent_ids = _entity_ids(db, s.id)
    svc_map, ast_map = dependency_map(db)
    dep_svc, dep_ast = svc_map.get(s.id, []), ast_map.get(s.id, [])
    out = _summary(s, ents, ent_ids, dep_svc, dep_ast, _owner(db, s.relationship_owner_id))
    vis_svc = [d for d in dep_svc if pr.can_read("assets.read", d["entity_id"])]
    vis_ast = [d for d in dep_ast if pr.can_read("assets.read", d["entity_id"])]
    for d in vis_svc + vis_ast:
        e = ents.get(d["entity_id"]) if d["entity_id"] else None
        d["entity"] = EntityBrief.model_validate(e).model_dump() if e else None
    clause_rows = {c.clause: c for c in s.clauses}
    clauses = []
    for spec in CLAUSES:
        c = clause_rows.get(spec["clause"])
        clauses.append(
            {
                **spec,
                "id": c.id if c else None,
                "status": c.status if c else "missing",
                "reference": c.reference if c else None,
                "note": c.note if c else None,
                "document": _doc_brief(db, pr, c.document_id) if c else None,
                "updated_at": c.updated_at if c else None,
            }
        )
    out.update(
        {
            "website": s.website,
            "description": s.description,
            "tier_rationale": s.tier_rationale,
            "contacts": s.contacts or [],
            "relationship_owner_id": s.relationship_owner_id,
            "contract_reference": s.contract_reference,
            "contract_end": s.contract_end,
            "notes": s.notes,
            "entity_ids": ent_ids,
            "created_at": s.created_at,
            "certificate_list": [_cert_out(db, pr, c) for c in s.certificates],
            "clause_list": clauses,
            "provision": _provision_link(db),
            "assessments": [_assessment_out(db, a) for a in s.assessments],
            "services": vis_svc,
            "assets": vis_ast,
            "hidden_dependencies": (len(dep_svc) - len(vis_svc)) + (len(dep_ast) - len(vis_ast)),
            "documents": doc_links_for(db, pr, "supplier", s.id),
            "can_edit": can_manage(pr, ent_ids),
            "review_months": REVIEW_MONTHS,
        }
    )
    return out


# --- register --------------------------------------------------------------------------------------------


@router.get("/meta")
def meta(pr: Principal = Depends(require("suppliers.read")), db: Session = Depends(get_db)):
    return {
        "access_types": ACCESS_TYPES,
        "tiers": TIERS,
        "statuses": STATUSES,
        "methods": METHODS,
        "ratings": RATINGS,
        "clause_statuses": CLAUSE_STATUSES,
        "cert_types": CERT_TYPES,
        "clauses": CLAUSES,
        "review_months": REVIEW_MONTHS,
        "provision": _provision_link(db),
    }


@router.get("")
def list_suppliers(pr: Principal = Depends(require("suppliers.read")), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Supplier)
        .order_by(Supplier.name)
        .options(
            selectinload(Supplier.certificates),
            selectinload(Supplier.clauses),
            selectinload(Supplier.assessments),
        )
    ).all()
    ents = _entities_map(db)
    sup_ents = _sup_entities(db)
    svc_map, ast_map = dependency_map(db)
    owners = {st.id: {"id": st.id, "name": st.name} for st in db.scalars(select(Stakeholder))}
    manage_any = pr.has_any("suppliers.manage")
    out = []
    for s in rows:
        ids = sup_ents.get(s.id, [])
        if not can_see(pr, ids):
            continue
        d = _summary(
            s, ents, ids, svc_map.get(s.id, []), ast_map.get(s.id, []), owners.get(s.relationship_owner_id)
        )
        d["can_edit"] = manage_any and can_manage(pr, ids)
        out.append(d)
    return out


def _apply_entities(db: Session, s: Supplier, ids: list[int]) -> None:
    db.execute(delete(supplier_entities).where(supplier_entities.c.supplier_id == s.id))
    if ids:
        db.execute(
            insert(supplier_entities), [{"supplier_id": s.id, "entity_id": e} for e in sorted(set(ids))]
        )


def _validate_refs(db: Session, body: SupplierIn) -> None:
    if body.relationship_owner_id and not db.get(Stakeholder, body.relationship_owner_id):
        raise HTTPException(400, "Relationship owner not found")
    if body.tier_overridden and not body.tier:
        raise HTTPException(400, "Choose a tier when overriding the suggested tier")


@router.post("")
def create_supplier(body: SupplierIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    if not pr.has_any("suppliers.manage"):
        raise HTTPException(403, "Missing permission: suppliers.manage")
    _check_entity_change(db, pr, [], body.entity_ids)
    _validate_refs(db, body)
    data = body.model_dump(exclude={"entity_ids"})
    data["contacts"] = [c for c in data["contacts"] if any(c.values())]
    if not body.tier_overridden:
        data["tier"] = None
    s = Supplier(code=next_code(db, Supplier.code, "SUP-"), **data)
    db.add(s)
    db.flush()
    _apply_entities(db, s, body.entity_ids)
    audit(db, pr, "create", "supplier", s.id, f"{s.code} {s.name}")
    db.commit()
    index_object(db, "supplier", s.id)
    return _detail(db, pr, _load(db, s.id))


@router.get("/export.xlsx")
def export_register(
    pr: Principal = Depends(require("suppliers.read", "reports.export")), db: Session = Depends(get_db)
):
    data = list_suppliers(pr, db)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Suppliers"
    head = [
        "Code",
        "Name",
        "Legal name",
        "Country",
        "Category",
        "Access",
        "Tier",
        "Suggested tier",
        "Status",
        "Entities",
        "Services / products",
        "Relationship owner",
        "Dependent services",
        "Dependent assets",
        "Last assessment",
        "Score",
        "Next review due",
        "Review state",
        "Valid certificates",
        *[f"5.1.4({c})" for c in CLAUSE_CODES],
    ]
    _header(ws, head)
    for r, d in enumerate(data, start=2):
        vals = [
            d["code"],
            d["name"],
            d["legal_name"],
            d["country"],
            d["category"],
            ACCESS_TYPES.get(d["access_type"]),
            TIERS.get(d["tier"]),
            TIERS.get(d["suggested_tier"]),
            STATUSES.get(d["status"]),
            ", ".join(e["code"] for e in d["entities"]),
            d["services_products"],
            (d["relationship_owner"] or {}).get("name"),
            d["dependent_services"],
            d["dependent_assets"],
            d["last_assessment"]["assessed_on"] if d["last_assessment"] else None,
            d["last_assessment"]["score"] if d["last_assessment"] else None,
            d["next_due"],
            d["due_state"],
            ", ".join(d["certificates"]["types"]),
            *[CLAUSE_STATUSES[d["clauses"][c]] for c in CLAUSE_CODES],
        ]
        for c, v in enumerate(vals, start=1):
            _safe(ws, r, c, v)
    cert_ws = wb.create_sheet("Certificates")
    _header(cert_ws, ["Supplier", "Type", "Scope", "Issuer", "Valid until", "State"])
    r = 2
    visible = {d["id"] for d in data}
    for s in db.scalars(
        select(Supplier).order_by(Supplier.name).options(selectinload(Supplier.certificates))
    ):
        if s.id not in visible:
            continue
        for c in s.certificates:
            for col, v in enumerate(
                [s.name, c.cert_type, c.scope, c.issuer, c.valid_until, cert_state(c.valid_until)], start=1
            ):
                _safe(cert_ws, r, col, v)
            r += 1
    audit(db, pr, "export", "supplier", None, "Supplier register")
    db.commit()
    buf = io.BytesIO()
    wb.save(buf)
    return Response(
        buf.getvalue(),
        media_type=XLSX,
        headers={
            "Content-Disposition": f'attachment; filename="Supplier_register_{date.today().isoformat()}.xlsx"'
        },
    )


def _safe(ws, row: int, col: int, value):
    cell = ws.cell(row=row, column=col)
    cell.value = value
    if isinstance(value, str) and value.startswith(_FORMULA_START):
        cell.data_type = "s"
    return cell


def _header(ws, head: list[str]) -> None:
    for c, h in enumerate(head, start=1):
        cell = _safe(ws, 1, c, h)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="0D6770")
        ws.column_dimensions[openpyxl.utils.get_column_letter(c)].width = max(12, min(40, len(h) + 4))
    ws.freeze_panes = "A2"


# --- questionnaire templates -----------------------------------------------------------------------------


def _template_out(t: QuestionnaireTemplate, db: Session) -> dict:
    by = db.get(User, t.created_by_id) if t.created_by_id else None
    return {
        "id": t.id,
        "tier": t.tier,
        "version": t.version,
        "title": t.title,
        "questions": t.questions,
        "change_note": t.change_note,
        "created_at": t.created_at,
        "created_by": by.display_name if by else None,
    }


def latest_template(db: Session, tier: str) -> QuestionnaireTemplate | None:
    return db.scalar(
        select(QuestionnaireTemplate)
        .where(QuestionnaireTemplate.tier == tier)
        .order_by(QuestionnaireTemplate.version.desc())
        .limit(1)
    )


@router.get("/questionnaires")
def list_templates(pr: Principal = Depends(require("suppliers.read")), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(QuestionnaireTemplate).order_by(
            QuestionnaireTemplate.tier, QuestionnaireTemplate.version.desc()
        )
    ).all()
    latest: dict[str, dict] = {}
    for t in rows:
        latest.setdefault(t.tier, _template_out(t, db))
    return {
        "latest": latest,
        "versions": [
            {
                "id": t.id,
                "tier": t.tier,
                "version": t.version,
                "title": t.title,
                "questions": len(t.questions or []),
                "created_at": t.created_at,
                "change_note": t.change_note,
            }
            for t in rows
        ],
        "can_edit": "suppliers.manage" in pr.global_perms,
    }


@router.get("/questionnaires/{template_id}")
def get_template(
    template_id: int, pr: Principal = Depends(require("suppliers.read")), db: Session = Depends(get_db)
):
    return _template_out(get_or_404(db, QuestionnaireTemplate, template_id, "Questionnaire"), db)


@router.post("/questionnaires")
def create_template_version(
    body: TemplateIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    pr.ensure("suppliers.manage", None, write=True)
    prev = latest_template(db, body.tier)
    used = {q.id for q in body.questions if q.id}
    if len(used) != len([q for q in body.questions if q.id]):
        raise HTTPException(400, "Question IDs must be unique")
    n = max([int(i[1:]) for i in used if i[1:].isdigit()] + [0])
    questions = []
    for q in body.questions:
        qid = q.id
        if not qid:
            n += 1
            qid = f"Q{n:02d}"
        questions.append(
            {
                "id": qid,
                "section": q.section,
                "text": q.text.strip(),
                "reference": q.reference,
                "weight": q.weight,
            }
        )
    t = QuestionnaireTemplate(
        tier=body.tier,
        version=(prev.version + 1) if prev else 1,
        title=body.title,
        questions=questions,
        change_note=body.change_note,
        created_by_id=pr.id,
    )
    db.add(t)
    db.flush()
    audit(db, pr, "create", "supplier_questionnaire", t.id, f"{t.title} v{t.version}")
    db.commit()
    return _template_out(t, db)


# --- certificates / assessments by id (static prefixes before /{supplier_id}) -------------------------------


@router.put("/certificates/{cert_id}")
def update_certificate(
    cert_id: int, body: CertificateIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    c = get_or_404(db, SupplierCertificate, cert_id, "Certificate")
    _ensure_manage(db, pr, c.supplier)
    _check_document(db, pr, body.document_id)
    diff = apply_changes(c, body.model_dump())
    audit(
        db,
        pr,
        "update",
        "supplier",
        c.supplier_id,
        f"{c.supplier.code} certificate {c.cert_type}",
        details=diff,
    )
    db.commit()
    index_object(db, "supplier", c.supplier_id)
    return _cert_out(db, pr, c)


@router.delete("/certificates/{cert_id}", response_model=Ok)
def delete_certificate(cert_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    c = get_or_404(db, SupplierCertificate, cert_id, "Certificate")
    _ensure_manage(db, pr, c.supplier)
    sid = c.supplier_id
    audit(db, pr, "delete", "supplier", sid, f"{c.supplier.code} certificate {c.cert_type}")
    db.delete(c)
    db.commit()
    index_object(db, "supplier", sid)
    return Ok()


@router.put("/assessments/{assessment_id}")
def update_assessment(
    assessment_id: int,
    body: AssessmentIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    a = get_or_404(db, SupplierAssessment, assessment_id, "Assessment")
    _ensure_manage(db, pr, a.supplier)
    data = body.model_dump()
    if data["next_due"] is None:
        data["next_due"] = _default_next_due(db, a.supplier, body.assessed_on)
    data["findings"] = _merge_findings(a.findings or [], data["findings"])
    diff = apply_changes(a, data)
    audit(
        db,
        pr,
        "update",
        "supplier_assessment",
        a.id,
        f"{a.supplier.code} assessment {a.assessed_on}",
        details={k: v for k, v in diff.items() if k != "answers"},
    )
    db.commit()
    return _assessment_out(db, a)


def _merge_findings(old: list[dict], new: list[dict]) -> list[dict]:
    """Keep the server-side action plan link of findings whose text is unchanged."""
    links = {
        f.get("text"): (f.get("action_item_id"), f.get("action_item_code"))
        for f in old
        if f.get("action_item_id")
    }
    out = []
    for f in new:
        item_id, code = links.pop(f["text"], (None, None))
        out.append({**f, "action_item_id": item_id, "action_item_code": code})
    return out


@router.delete("/assessments/{assessment_id}", response_model=Ok)
def delete_assessment(
    assessment_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    a = get_or_404(db, SupplierAssessment, assessment_id, "Assessment")
    _ensure_manage(db, pr, a.supplier)
    audit(db, pr, "delete", "supplier_assessment", a.id, f"{a.supplier.code} assessment {a.assessed_on}")
    db.delete(a)
    db.commit()
    return Ok()


@router.post("/assessments/{assessment_id}/findings/{index}/action-item")
def finding_to_action(
    assessment_id: int,
    index: int,
    body: FindingActionIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    a = get_or_404(db, SupplierAssessment, assessment_id, "Assessment")
    _ensure_manage(db, pr, a.supplier)
    findings = [dict(f) for f in (a.findings or [])]
    if index < 0 or index >= len(findings):
        raise HTTPException(404, "Finding not found")
    f = findings[index]
    if f.get("action_item_id"):
        raise HTTPException(400, "An action plan item already exists for this finding")
    sev_prio = {"high": "High", "medium": "Medium", "low": "Low"}
    item = create_action_item(
        db,
        pr,
        entity_id=body.entity_id,
        requirement_number=body.requirement_number,
        title=body.title or f"Supplier {a.supplier.name}: {f['text'][:300]}",
        priority=body.priority or sev_prio.get(f.get("severity"), "Medium"),
        target_date=body.target_date,
        responsible_id=body.responsible_id,
        comments=f"From supplier assessment of {a.supplier.code} {a.supplier.name} on {a.assessed_on} "
        f"({METHODS.get(a.method, a.method)}). Finding: {f['text']}",
    )
    f["action_item_id"] = item.id
    f["action_item_code"] = item.code
    findings[index] = f
    a.findings = findings
    audit(db, pr, "update", "supplier_assessment", a.id, f"{a.supplier.code} finding → {item.code}")
    db.commit()
    reindex_after(db, action_item_id=item.id)
    return _assessment_out(db, a)


# --- single supplier -------------------------------------------------------------------------------------


@router.get("/{supplier_id}")
def get_supplier(
    supplier_id: int, pr: Principal = Depends(require("suppliers.read")), db: Session = Depends(get_db)
):
    s = _load(db, supplier_id)
    _ensure_see(db, pr, s)
    return _detail(db, pr, s)


@router.put("/{supplier_id}")
def update_supplier(
    supplier_id: int, body: SupplierIn, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    s = _load(db, supplier_id)
    old_ids = _ensure_manage(db, pr, s)
    _check_entity_change(db, pr, old_ids, body.entity_ids)
    _validate_refs(db, body)
    data = body.model_dump(exclude={"entity_ids"})
    data["contacts"] = [c for c in data["contacts"] if any(c.values())]
    if not body.tier_overridden:
        data["tier"] = None
    diff = apply_changes(s, data)
    if sorted(set(old_ids)) != sorted(set(body.entity_ids)):
        _apply_entities(db, s, body.entity_ids)
        diff["entity_ids"] = [sorted(set(old_ids)), sorted(set(body.entity_ids))]
    audit(db, pr, "update", "supplier", s.id, f"{s.code} {s.name}", details=diff)
    db.commit()
    index_object(db, "supplier", s.id)
    return _detail(db, pr, _load(db, s.id))


@router.delete("/{supplier_id}", response_model=Ok)
def delete_supplier(supplier_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    s = _load(db, supplier_id)
    _ensure_manage(db, pr, s)
    audit(db, pr, "delete", "supplier", s.id, f"{s.code} {s.name}")
    cleanup_target(db, "supplier", s.id)
    db.delete(s)
    db.commit()
    remove_object(db, "supplier", supplier_id)
    return Ok()


def _check_document(db: Session, pr: Principal, doc_id: int | None) -> None:
    if doc_id is None:
        return
    from app.api.util import can_see_document

    d = db.get(Document, doc_id)
    if not d or not can_see_document(pr, d):
        raise HTTPException(400, "Document not found")


@router.put("/{supplier_id}/clauses/{clause}")
def set_clause(
    supplier_id: int,
    clause: str,
    body: ClauseIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    s = _load(db, supplier_id)
    _ensure_manage(db, pr, s)
    if clause not in CLAUSE_CODES:
        raise HTTPException(404, "Unknown clause; use a–h (IR 2024/2690 Annex point 5.1.4)")
    _check_document(db, pr, body.document_id)
    c = db.scalar(
        select(SupplierClause).where(SupplierClause.supplier_id == s.id, SupplierClause.clause == clause)
    )
    if not c:
        c = SupplierClause(supplier_id=s.id, clause=clause)
        db.add(c)
        diff = {k: [None, v] for k, v in body.model_dump().items() if v is not None}
        for k, v in body.model_dump().items():
            setattr(c, k, v)
    else:
        diff = apply_changes(c, body.model_dump())
    audit(db, pr, "update", "supplier", s.id, f"{s.code} clause 5.1.4({clause})", details=diff)
    db.commit()
    return _detail(db, pr, _load(db, s.id))


@router.post("/{supplier_id}/certificates")
def add_certificate(
    supplier_id: int,
    body: CertificateIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    s = _load(db, supplier_id)
    _ensure_manage(db, pr, s)
    _check_document(db, pr, body.document_id)
    c = SupplierCertificate(supplier_id=s.id, **body.model_dump())
    db.add(c)
    db.flush()
    audit(db, pr, "update", "supplier", s.id, f"{s.code} certificate {c.cert_type} added")
    db.commit()
    index_object(db, "supplier", s.id)
    return _cert_out(db, pr, c)


def _default_next_due(db: Session, s: Supplier, assessed_on: date) -> date:
    svc_map, _ = dependency_map(db)
    tier, _s, _r = effective_tier(s, svc_map.get(s.id, []))
    return add_months(assessed_on, REVIEW_MONTHS[tier])


@router.post("/{supplier_id}/assessments")
def add_assessment(
    supplier_id: int,
    body: AssessmentIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    s = _load(db, supplier_id)
    _ensure_manage(db, pr, s)
    data = body.model_dump()
    if data["next_due"] is None:
        data["next_due"] = _default_next_due(db, s, body.assessed_on)
    data["findings"] = _merge_findings([], data["findings"])
    a = SupplierAssessment(supplier_id=s.id, assessor_id=pr.id, answers=[], **data)
    db.add(a)
    db.flush()
    audit(db, pr, "create", "supplier_assessment", a.id, f"{s.code} assessment {a.assessed_on}")
    db.commit()
    return _assessment_out(db, a)


# --- questionnaire round-trip ----------------------------------------------------------------------------


@router.get("/{supplier_id}/questionnaire.xlsx")
def questionnaire_export(
    supplier_id: int,
    template_id: int | None = None,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    s = _load(db, supplier_id)
    _ensure_manage(db, pr, s)
    if template_id:
        t = get_or_404(db, QuestionnaireTemplate, template_id, "Questionnaire")
    else:
        svc_map, _ = dependency_map(db)
        tier, _s, _r = effective_tier(s, svc_map.get(s.id, []))
        t = latest_template(db, tier)
        if not t:
            raise HTTPException(400, f"No questionnaire exists for tier {tier}")
    data = build_questionnaire_xlsx(s, t)
    audit(db, pr, "export", "supplier", s.id, f"{s.code} questionnaire {t.tier} v{t.version}")
    db.commit()
    safe_code = "".join(ch for ch in s.code if ch.isalnum() or ch == "-")
    return Response(
        data,
        media_type=XLSX,
        headers={
            "Content-Disposition": f'attachment; filename="Supplier_questionnaire_{safe_code}_{t.tier}_v{t.version}.xlsx"'
        },
    )


async def _read_xlsx(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(400, "Please upload the completed .xlsx questionnaire")
    limit = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, "File too large")
    if not data.startswith(b"PK"):
        raise HTTPException(400, "Not a valid .xlsx file")
    from app.services.extract import zip_is_safe

    if not zip_is_safe(data):
        raise HTTPException(400, "Workbook is too large when uncompressed")
    return data


def _import_questionnaire(supplier_id: int, data: bytes, pr: Principal, dry_run: bool) -> dict:
    db = SessionLocal()
    try:
        s = _load(db, supplier_id)
        _ensure_manage(db, pr, s)
        try:
            meta_vals = read_meta(data)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, "The file could not be read as an Excel workbook") from e
        if meta_vals.get("supplier_id") not in (None, "") and str(meta_vals["supplier_id"]) != str(s.id):
            raise HTTPException(
                400,
                f"This questionnaire was issued to another supplier "
                f"({meta_vals.get('supplier_code') or meta_vals['supplier_id']})",
            )
        svc_map, _ = dependency_map(db)
        tier, _s, _r = effective_tier(s, svc_map.get(s.id, []))
        t = None
        if meta_vals.get("template_id"):
            try:
                t = db.get(QuestionnaireTemplate, int(meta_vals["template_id"]))
            except (TypeError, ValueError):
                t = None
            # the workbook metadata is client-controlled: only accept a version of the supplier's current tier
            if t is None or t.tier != tier:
                raise HTTPException(
                    400,
                    f"This questionnaire does not match the supplier's current tier ({tier}). "
                    "Download the current questionnaire and send it again.",
                )
        if not t:
            t = latest_template(db, tier)
        if not t:
            raise HTTPException(400, "No questionnaire template found for this supplier")
        try:
            result = parse_questionnaire_xlsx(data, t)
        except ValueError as e:
            raise HTTPException(400, f"Workbook does not match the questionnaire format: {e}") from e
        result.update(
            {
                "dry_run": dry_run,
                "template": {"id": t.id, "tier": t.tier, "version": t.version, "title": t.title},
                "assessment_id": None,
            }
        )
        if not dry_run:
            if not result["answered"]:
                raise HTTPException(400, "The questionnaire contains no valid answers")
            today = date.today()
            a = SupplierAssessment(
                supplier_id=s.id,
                assessed_on=today,
                method="questionnaire",
                score=result["score"],
                rating=result["rating"],
                answers=result["answers"],
                findings=result["findings"],
                summary=f"Questionnaire {t.title} v{t.version}: {result['answered']} of {result['questions']} "
                f"questions answered, {len(result['findings'])} negative or partial answers.",
                template_id=t.id,
                template_version=t.version,
                next_due=_default_next_due(db, s, today),
                assessor_id=pr.id,
            )
            db.add(a)
            db.flush()
            audit(
                db,
                pr,
                "import",
                "supplier_assessment",
                a.id,
                f"{s.code} questionnaire v{t.version}",
                details={"score": result["score"], "answered": result["answered"]},
            )
            db.commit()
            result["assessment_id"] = a.id
        return result
    finally:
        db.close()


@router.post("/{supplier_id}/questionnaire/import")
async def questionnaire_import(
    supplier_id: int,
    file: UploadFile = File(...),
    dry_run: bool = True,
    pr: Principal = Depends(get_principal),
):
    if not pr.has_any("suppliers.manage"):
        raise HTTPException(403, "Missing permission: suppliers.manage")
    data = await _read_xlsx(file)
    return await asyncio.to_thread(_import_questionnaire, supplier_id, data, pr, dry_run)


# --- incidents -------------------------------------------------------------------------------------------


def _incident_brief(i: Incident) -> dict:
    return {
        "id": i.id,
        "code": i.code,
        "title": i.title,
        "severity": i.severity,
        "status": i.status,
        "is_significant": i.is_significant,
        "detected_at": i.detected_at,
        "aware_at": i.aware_at,
        "entity": EntityBrief.model_validate(i.entity).model_dump() if i.entity else None,
    }


@router.get("/{supplier_id}/incidents")
def supplier_incidents_list(
    supplier_id: int, pr: Principal = Depends(require("suppliers.read")), db: Session = Depends(get_db)
):
    s = get_or_404(db, Supplier, supplier_id, "Supplier")
    _ensure_see(db, pr, s)
    if not pr.has_any("incidents.read"):
        return {"linked": [], "mentions": [], "can_read_incidents": False}
    linked_ids = set(
        db.scalars(select(supplier_incidents.c.incident_id).where(supplier_incidents.c.supplier_id == s.id))
    )
    linked = (
        [
            i
            for i in db.scalars(
                select(Incident).where(Incident.id.in_(linked_ids)).order_by(Incident.id.desc())
            )
            if pr.can_read("incidents.read", i.entity_id)
        ]
        if linked_ids
        else []
    )
    terms = [t for t in {s.name, s.legal_name, s.code} if t and len(t) >= 3]
    mentions = []
    if terms:
        conds = []
        for t in terms:
            esc = t.replace("%", "\\%").replace("_", "\\_")
            pat = f"%{esc}%"
            conds += [
                Incident.title.ilike(pat),
                Incident.description.ilike(pat),
                Incident.impact.ilike(pat),
                Incident.root_cause.ilike(pat),
                Incident.measures.ilike(pat),
            ]
        mentions = [
            i
            for i in db.scalars(select(Incident).where(or_(*conds)).order_by(Incident.id.desc()).limit(50))
            if i.id not in linked_ids and pr.can_read("incidents.read", i.entity_id)
        ]
    return {
        "linked": [_incident_brief(i) for i in linked],
        "mentions": [_incident_brief(i) for i in mentions],
        "can_read_incidents": True,
    }


@router.post("/{supplier_id}/incidents", response_model=Ok)
def link_incident(
    supplier_id: int,
    body: IncidentLinkIn,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    s = _load(db, supplier_id)
    _ensure_manage(db, pr, s)
    i = get_or_404(db, Incident, body.incident_id, "Incident")
    pr.ensure("incidents.read", i.entity_id)
    exists = db.scalar(
        select(supplier_incidents.c.incident_id).where(
            supplier_incidents.c.supplier_id == s.id, supplier_incidents.c.incident_id == i.id
        )
    )
    if not exists:
        db.execute(insert(supplier_incidents).values(supplier_id=s.id, incident_id=i.id))
        audit(db, pr, "update", "supplier", s.id, f"{s.code} linked to incident {i.code}")
        db.commit()
    return Ok()


@router.delete("/{supplier_id}/incidents/{incident_id}", response_model=Ok)
def unlink_incident(
    supplier_id: int, incident_id: int, pr: Principal = Depends(get_principal), db: Session = Depends(get_db)
):
    s = _load(db, supplier_id)
    _ensure_manage(db, pr, s)
    i = get_or_404(db, Incident, incident_id, "Incident")
    pr.ensure("incidents.read", i.entity_id)
    db.execute(
        delete(supplier_incidents).where(
            supplier_incidents.c.supplier_id == s.id, supplier_incidents.c.incident_id == incident_id
        )
    )
    audit(db, pr, "update", "supplier", s.id, f"{s.code} unlinked from incident {i.code}")
    db.commit()
    return Ok()
