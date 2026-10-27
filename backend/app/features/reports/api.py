"""Management report, ISO/IEC 27001 statement-of-applicability view and evidence pack export."""

import csv
import html
import io
import tempfile
import zipfile
from collections.abc import Callable
from datetime import date, timedelta
from statistics import mean

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import can_see_document, get_or_404
from app.core.deps import Principal, get_principal, require
from app.db import get_db
from app.features.reports.models import ReportSnapshot
from app.models import (
    ActionItem,
    Activity,
    Answer,
    Assessment,
    AssessmentRound,
    Document,
    DocumentLink,
    Entity,
    Gate,
    Incident,
    Project,
    Provision,
    Regulation,
    RequirementProvision,
)
from app.services import storage
from app.services.audit import audit
from app.services.scoring import due_status, schedule_status
from app.services.stats import gap_dashboard

router = APIRouter(prefix="/reports", tags=["reports"])

# Other feature modules can contribute report sections: fn(db, principal, entity_id | None) -> dict | None
SECTION_PROVIDERS: dict[str, Callable] = {}


def register_section(key: str, fn: Callable) -> None:
    SECTION_PROVIDERS[key] = fn


def _current_round(db: Session) -> AssessmentRound:
    rnd = db.scalar(select(AssessmentRound).where(AssessmentRound.is_current.is_(True)))
    if not rnd:
        raise HTTPException(400, "No current assessment round")
    return rnd


def _scope(pr: Principal, entity_id: int | None) -> set[int] | None:
    scope = pr.entity_scope("assessments.read")
    if entity_id is not None:
        if scope is not None and entity_id not in scope:
            raise HTTPException(403, "No access to this entity")
        return {entity_id}
    return scope


# --- management report ----------------------------------------------------------------------------------


def management_report(db: Session, pr: Principal, entity_id: int | None, round_id: int | None) -> dict:
    rnd = get_or_404(db, AssessmentRound, round_id) if round_id else _current_round(db)
    scope = _scope(pr, entity_id)
    g = gap_dashboard(db, rnd.id, scope)
    today = date.today()

    trend = []
    for r in db.scalars(select(AssessmentRound).order_by(AssessmentRound.id)):
        d = g if r.id == rnd.id else gap_dashboard(db, r.id, scope)
        trend.append(
            {
                "round": r.name,
                "average_score": d["totals"]["average_score"],
                "coverage": d["totals"]["coverage"],
            }
        )

    chapters = sorted(g["chapters"], key=lambda c: -(c["gap_to_target"] or 0))
    items = [
        i
        for i in db.scalars(select(ActionItem))
        if pr.can("findings.read", i.entity_id) and (scope is None or i.entity_id in scope)
    ]
    overdue = [i for i in items if due_status(i.target_date, i.status, today) == "Overdue"]
    overdue.sort(key=lambda i: (i.priority != "High", i.target_date or today))

    project = None
    if pr.has_any("projects.read"):
        p = db.scalar(select(Project).order_by(Project.id))
        if p:
            acts = db.scalars(select(Activity).where(Activity.project_id == p.id)).all()
            gates = db.scalars(select(Gate).where(Gate.project_id == p.id).order_by(Gate.sort_order)).all()
            project = {
                "name": p.name,
                "planned_finish": p.planned_finish,
                "progress": mean([a.progress or 0 for a in acts]) if acts else 0,
                "completed": sum(a.status == "Completed" for a in acts),
                "total": len(acts),
                "overdue": [
                    {"code": a.code, "title": a.title, "planned_finish": a.planned_finish}
                    for a in acts
                    if schedule_status(a.planned_start, a.planned_finish, a.status, today) == "Red"
                ],
                "gates": [
                    {
                        "code": x.code,
                        "decision": x.decision,
                        "planned_date": x.planned_date,
                        "status": x.status,
                    }
                    for x in gates
                ],
            }

    incidents = None
    if pr.has_any("incidents.read"):
        since = today - timedelta(days=365)
        rows = [
            i
            for i in db.scalars(select(Incident))
            if pr.can_read("incidents.read", i.entity_id) and (entity_id is None or i.entity_id == entity_id)
        ]
        recent = [i for i in rows if i.created_at.date() >= since]
        significant = [i for i in recent if i.is_significant]
        on_time = [
            i
            for i in significant
            if i.aware_at and i.early_warning_at and (i.early_warning_at - i.aware_at) <= timedelta(hours=24)
        ]
        incidents = {
            "last_12_months": len(recent),
            "significant": len(significant),
            "early_warning_on_time": len(on_time),
            "open": sum(i.status in ("Open", "Contained") for i in rows),
        }

    documents = None
    if pr.has_any("documents.read"):
        docs = [
            d
            for d in db.scalars(select(Document))
            if can_see_document(pr, d) and (entity_id is None or d.entity_id in (None, entity_id))
        ]
        documents = {
            "total": len(docs),
            "review_overdue": sum(
                1 for d in docs if d.next_review_date and d.next_review_date < today and d.status != "Retired"
            ),
            "policies_not_approved": sum(
                1
                for d in docs
                if d.doc_type in ("Policy", "Guideline", "Procedure") and d.status in ("Draft", "In Review")
            ),
        }

    extra = {}
    for key, fn in SECTION_PROVIDERS.items():
        try:
            section = fn(db, pr, entity_id)
        except Exception:  # noqa: BLE001 - a broken optional section must not break the report
            section = None
        if section:
            extra[key] = section

    ent = db.get(Entity, entity_id) if entity_id else None
    return {
        "title": f"NIS-2 management report – {ent.name if ent else 'Group'}",
        "generated_at": today.isoformat(),
        "round": {"id": rnd.id, "name": rnd.name},
        "scope": {"entity_id": entity_id, "entity_name": ent.name if ent else None},
        "totals": g["totals"],
        "entities": [
            {
                "code": e["entity"]["code"],
                "name": e["entity"]["name"],
                "coverage": e["coverage"],
                "average_score": e["average_score"],
                "work_packages": e["work_packages"],
                "status": e["status"],
            }
            for e in g["entities"]
        ],
        "chapters": [
            {
                "chapter": c["chapter"],
                "title": c["title"],
                "target": c["target"],
                "group_average": c["group_average"],
                "gap_to_target": c["gap_to_target"],
                "work_packages": c["work_packages"],
            }
            for c in chapters
        ],
        "trend": trend,
        "action_plan": {
            **g["action_plan"],
            "overdue_items": [
                {
                    "code": i.code,
                    "title": i.title,
                    "entity": i.entity.code,
                    "priority": i.priority,
                    "target_date": i.target_date,
                    "responsible": i.responsible.name if i.responsible else None,
                }
                for i in overdue[:10]
            ],
        },
        "project": project,
        "incidents": incidents,
        "documents": documents,
        "sections": extra,
    }


@router.get("/management")
def get_management_report(
    entity_id: int | None = None,
    round_id: int | None = None,
    pr: Principal = Depends(require("assessments.read")),
    db: Session = Depends(get_db),
):
    return management_report(db, pr, entity_id, round_id)


@router.get("/management.pdf")
def management_pdf(
    entity_id: int | None = None,
    round_id: int | None = None,
    pr: Principal = Depends(require("reports.export", "assessments.read")),
    db: Session = Depends(get_db),
):
    from fastapi.responses import Response

    from app.features.reports.pdf import render_management_pdf

    if entity_id is not None:
        pr.ensure("reports.export", entity_id)
    data = management_report(db, pr, entity_id, round_id)
    pdf = render_management_pdf(data, pr.user.display_name)
    audit(db, pr, "export", "report", None, data["title"] + " (PDF)", entity_id=entity_id)
    db.commit()
    name = f"NIS2_management_report_{date.today().isoformat()}.pdf"
    return Response(
        pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'}
    )


# --- statement of applicability (ISO/IEC 27001:2022) ---------------------------------------------------


def _classify(scores: list[float | None], scopes: list[str]) -> str:
    if scopes and all(s != "In Scope" for s in scopes):
        return "Not applicable" if all(s == "Not Applicable" for s in scopes) else "Inherited (central at HQ)"
    vals = [s for s in scores if s is not None]
    if not vals:
        return "Not assessed"
    avg = mean(vals)
    if avg >= 0.75:
        return "Implemented"
    if avg >= 0.25:
        return "Partially implemented"
    return "Not implemented"


def statement_of_applicability(db: Session, pr: Principal, entity_id: int | None) -> dict:
    scope = _scope(pr, entity_id)
    rnd = _current_round(db)
    iso = db.scalar(select(Regulation).where(Regulation.code == "ISO27001"))
    if not iso:
        raise HTTPException(404, "ISO/IEC 27001 is not in the regulations library")
    provs = db.scalars(
        select(Provision).where(Provision.regulation_id == iso.id).order_by(Provision.sort_order)
    ).all()
    links = db.scalars(
        select(RequirementProvision).join(Provision).where(Provision.regulation_id == iso.id)
    ).all()
    reqs_by_prov: dict[int, set[int]] = {}
    for rp in links:
        reqs_by_prov.setdefault(rp.provision_id, set()).add(rp.requirement_id)
    answers: dict[int, list[Answer]] = {}
    for a in db.scalars(select(Answer).join(Assessment).where(Assessment.round_id == rnd.id)):
        if scope is None or a.assessment.entity_id in scope:
            answers.setdefault(a.requirement_id, []).append(a)
    rows = []
    for p in provs:
        is_control = p.key.startswith("A.") and p.key.count(".") == 2
        is_clause = not p.key.startswith("A") and p.key != "annexA" and "." in p.key
        if not (is_control or is_clause):
            continue
        req_ids = reqs_by_prov.get(p.id, set())
        ans = [a for rid in req_ids for a in answers.get(rid, [])]
        numbers = sorted(
            {a.requirement.number for a in ans} or set(), key=lambda n: [int(x) for x in n.split(".")]
        )
        gaps = [
            f"{a.assessment.entity.code} {a.requirement.number}: {a.gap_description}"
            for a in ans
            if a.gap_description
        ][:5]
        rows.append(
            {
                "key": p.key,
                "title": p.heading,
                "kind": "control" if is_control else "clause",
                "group": p.key.split(".")[0] + "." + p.key.split(".")[1]
                if is_control
                else p.key.split(".")[0],
                "requirements": numbers,
                "answers": len(ans),
                "status": _classify([a.score for a in ans], [a.scope for a in ans])
                if ans
                else "Not covered by NIS-2 catalogue",
                "average_score": mean([a.score for a in ans if a.score is not None])
                if any(a.score is not None for a in ans)
                else None,
                "findings": sum(1 for a in ans if a.wp_required),
                "gaps": gaps,
            }
        )
    summary: dict[str, int] = {}
    for r in rows:
        if r["kind"] == "control":
            summary[r["status"]] = summary.get(r["status"], 0) + 1
    ent = db.get(Entity, entity_id) if entity_id else None
    return {
        "title": f"Statement of applicability (ISO/IEC 27001:2022) – {ent.name if ent else 'Group'}",
        "round": rnd.name,
        "entity_id": entity_id,
        "generated_at": date.today().isoformat(),
        "summary": summary,
        "rows": rows,
        "note": "Derived from the NIS-2 assessment answers mapped to each control. ISO/IEC 27001 control titles "
        "only; the standard's text is licensed by ISO. Review the justifications before using this as "
        "a formal statement of applicability.",
    }


@router.get("/soa")
def get_soa(
    entity_id: int | None = None,
    pr: Principal = Depends(require("assessments.read", "regulations.read")),
    db: Session = Depends(get_db),
):
    return statement_of_applicability(db, pr, entity_id)


# --- snapshots ------------------------------------------------------------------------------------------


class SnapshotIn(BaseModel):
    kind: str = Field(pattern="^(management|soa)$")
    entity_id: int | None = None
    round_id: int | None = None
    title: str | None = Field(default=None, max_length=300)


@router.post("/snapshots")
def create_snapshot(
    body: SnapshotIn, pr: Principal = Depends(require("reports.export")), db: Session = Depends(get_db)
):
    if body.entity_id is not None:
        pr.ensure("reports.export", body.entity_id)
    data = (
        management_report(db, pr, body.entity_id, body.round_id)
        if body.kind == "management"
        else statement_of_applicability(db, pr, body.entity_id)
    )
    snap = ReportSnapshot(
        kind=body.kind,
        title=body.title or data["title"],
        entity_id=body.entity_id,
        round_id=body.round_id,
        data=_jsonable(data),
        created_by_id=pr.id,
    )
    db.add(snap)
    db.flush()
    audit(db, pr, "snapshot", "report", snap.id, snap.title, entity_id=body.entity_id)
    db.commit()
    return {"id": snap.id}


def _jsonable(obj):
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, date):
        return obj.isoformat()
    return obj


@router.get("/snapshots")
def list_snapshots(pr: Principal = Depends(require("reports.export")), db: Session = Depends(get_db)):
    # snapshots are frozen with their creator's view, so only report exporters (a trusted, broad-read role) see them
    scope = pr.entity_scope("reports.export")
    rows = db.scalars(select(ReportSnapshot).order_by(ReportSnapshot.created_at.desc()).limit(200)).all()
    return [
        {"id": s.id, "kind": s.kind, "title": s.title, "entity_id": s.entity_id, "created_at": s.created_at}
        for s in rows
        if s.entity_id is None
        and scope is None
        or s.entity_id is not None
        and (scope is None or s.entity_id in scope)
    ]


@router.get("/snapshots/{snap_id}")
def get_snapshot(
    snap_id: int, pr: Principal = Depends(require("reports.export")), db: Session = Depends(get_db)
):
    s = get_or_404(db, ReportSnapshot, snap_id)
    scope = pr.entity_scope("reports.export")
    if scope is not None and (s.entity_id is None or s.entity_id not in scope):
        raise HTTPException(404, "Snapshot not found")
    return {
        "id": s.id,
        "kind": s.kind,
        "title": s.title,
        "entity_id": s.entity_id,
        "created_at": s.created_at,
        "data": s.data,
    }


# --- evidence pack --------------------------------------------------------------------------------------

MAX_PACK_BYTES = 400 * 1024 * 1024


def _csv(rows: list[list]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    for r in rows:
        # neutralise spreadsheet formula injection
        w.writerow(
            [
                ("'" + str(v))
                if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r")
                else ("" if v is None else v)
                for v in r
            ]
        )
    return ("﻿" + buf.getvalue()).encode("utf-8")


@router.get("/evidence-pack")
def evidence_pack(
    entity_id: int,
    include_files: bool = True,
    pr: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    pr.ensure("reports.export", entity_id)
    pr.ensure("assessments.read", entity_id)
    ent = get_or_404(db, Entity, entity_id)
    rnd = _current_round(db)
    asm = db.scalar(select(Assessment).where(Assessment.round_id == rnd.id, Assessment.entity_id == ent.id))
    if not asm:
        raise HTTPException(404, "No assessment for this entity in the current round")
    answers = sorted(
        db.scalars(select(Answer).where(Answer.assessment_id == asm.id)),
        key=lambda a: a.requirement.sort_order,
    )
    links = db.scalars(
        select(DocumentLink).where(
            DocumentLink.target_type == "answer", DocumentLink.target_id.in_([a.id for a in answers])
        )
    ).all()
    docs_by_answer: dict[int, list[Document]] = {}
    docs: dict[int, Document] = {}
    for link in links:
        d = link.document
        if can_see_document(pr, d):
            docs_by_answer.setdefault(link.target_id, []).append(d)
            docs[d.id] = d
    for d in db.scalars(select(Document).where(Document.status == "Approved")):
        if (
            d.entity_id in (None, ent.id)
            and d.doc_type in ("Policy", "Guideline", "Procedure", "Standard", "Concept")
            and can_see_document(pr, d)
        ):
            docs[d.id] = d
    items = (
        db.scalars(select(ActionItem).where(ActionItem.entity_id == ent.id).order_by(ActionItem.code)).all()
        if pr.can("findings.read", ent.id)
        else []
    )

    # Requirements operated centrally by HQ: the subsidiary stays accountable, so its pack carries HQ's answer
    # and evidence (only what the exporting user may read).
    hq_by_req: dict[int, Answer] = {}
    hq_docs: dict[int, list[Document]] = {}
    hq = db.scalar(select(Entity).where(Entity.is_headquarters.is_(True)))
    central = [a for a in answers if a.scope == "Central at HQ"]
    if hq and hq.id != ent.id and central and pr.can("assessments.read", hq.id):
        hq_asm = db.scalar(
            select(Assessment).where(Assessment.round_id == rnd.id, Assessment.entity_id == hq.id)
        )
        if hq_asm:
            req_ids = [a.requirement_id for a in central]
            for ha in db.scalars(
                select(Answer).where(Answer.assessment_id == hq_asm.id, Answer.requirement_id.in_(req_ids))
            ):
                hq_by_req[ha.requirement_id] = ha
            for link in db.scalars(
                select(DocumentLink).where(
                    DocumentLink.target_type == "answer",
                    DocumentLink.target_id.in_([ha.id for ha in hq_by_req.values()]),
                )
            ):
                if can_see_document(pr, link.document):
                    hq_docs.setdefault(link.target_id, []).append(link.document)
                    docs[link.document.id] = link.document

    # spooled to disk above 16 MB so large packs do not exhaust memory
    buf = tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024)  # noqa: SIM115 - closed by the response
    total = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "answers.csv",
            _csv(
                [
                    [
                        "No.",
                        "Chapter",
                        "Section",
                        "Scope",
                        "Implemented",
                        "Documented",
                        "Effectiveness",
                        "Score",
                        "Work package required",
                        "Finding ID",
                        "Evidence / source",
                        "Gap",
                        "Recommended action",
                        "Responsible",
                        "Target date",
                        "Linked documents",
                        "Operated by HQ: implemented",
                        "HQ documented",
                        "HQ effectiveness",
                        "HQ score",
                        "HQ evidence / source",
                        "HQ open gap",
                        "HQ documents",
                    ]
                ]
                + [
                    [
                        a.requirement.number,
                        a.requirement.chapter.number,
                        a.requirement.section,
                        a.scope,
                        a.implemented,
                        a.documented,
                        a.effectiveness,
                        None if a.score is None else round(a.score, 4),
                        {True: "Yes", False: "No"}.get(a.wp_required, ""),
                        a.finding_id,
                        a.evidence,
                        a.gap_description,
                        a.recommended_action,
                        a.responsible.name if a.responsible else None,
                        a.target_date.isoformat() if a.target_date else None,
                        ", ".join(d.title for d in docs_by_answer.get(a.id, [])),
                    ]
                    + _hq_cols(a, hq_by_req, hq_docs)
                    for a in answers
                ]
            ),
        )
        z.writestr(
            "action_plan.csv",
            _csv(
                [
                    [
                        "Code",
                        "Requirement",
                        "Work package",
                        "Priority",
                        "Acceptance criterion",
                        "Expected evidence",
                        "Responsible",
                        "Target date",
                        "Status",
                    ]
                ]
                + [
                    [
                        i.code,
                        i.requirement.number,
                        i.title,
                        i.priority,
                        i.acceptance_criterion,
                        i.expected_evidence,
                        i.responsible.name if i.responsible else None,
                        i.target_date.isoformat() if i.target_date else None,
                        i.status,
                    ]
                    for i in items
                ]
            ),
        )
        doc_rows = [["File", "Title", "Type", "Status", "Version", "Approved on", "Approved by", "SHA-256"]]
        for d in sorted(docs.values(), key=lambda d: d.title):
            v = d.current_version
            fname = None
            if v and include_files and total + v.size <= MAX_PACK_BYTES:
                try:
                    data = storage.read(v.storage_key)
                    fname = f"documents/{d.id}-{storage.safe_filename(v.filename)}"
                    z.writestr(fname, data)
                    total += len(data)
                except (FileNotFoundError, ValueError):
                    fname = None
            doc_rows.append(
                [
                    fname or "(not included)",
                    d.title,
                    d.doc_type,
                    d.status,
                    d.version_label,
                    d.approved_at.isoformat() if d.approved_at else None,
                    d.approved_by,
                    v.sha256 if v else None,
                ]
            )
        z.writestr("documents.csv", _csv(doc_rows))
        z.writestr("index.html", _pack_index(ent, rnd, asm, answers, items, docs_by_answer, pr, hq_by_req))
    audit(
        db,
        pr,
        "export",
        "evidence_pack",
        ent.id,
        f"Evidence pack {ent.code}",
        entity_id=ent.id,
        details={"documents": len(docs), "bytes": total},
    )
    db.commit()
    buf.seek(0)

    def chunks():
        try:
            while data := buf.read(1024 * 1024):
                yield data
        finally:
            buf.close()

    return StreamingResponse(
        chunks(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="NIS2_evidence_pack_{ent.code}_{date.today().isoformat()}.zip"'
        },
    )


def _hq_cols(a: Answer, hq_by_req: dict, hq_docs: dict) -> list:
    if a.scope != "Central at HQ":
        return [None] * 7
    h = hq_by_req.get(a.requirement_id)
    if not h:
        return ["(HQ answer not available to the exporting user)"] + [None] * 6
    return [
        h.implemented,
        h.documented,
        h.effectiveness,
        None if h.score is None else round(h.score, 4),
        h.evidence,
        h.gap_description,
        ", ".join(d.title for d in hq_docs.get(h.id, [])),
    ]


def _pack_index(ent, rnd, asm, answers, items, docs_by_answer, pr, hq_by_req=None) -> str:
    e = html.escape
    hq_by_req = hq_by_req or {}

    def hq_note(a) -> str:
        if a.scope != "Central at HQ":
            return ""
        h = hq_by_req.get(a.requirement_id)
        if not h:
            return "<br><em>Operated by HQ (HQ answer not included)</em>"
        score = "" if h.score is None else f", score {h.score:.0%}"
        return (
            f"<br><em>Operated by HQ: implemented {e(h.implemented or '–')}, documented {e(h.documented or '–')}, "
            f"effectiveness {e(h.effectiveness or '–')}{score}</em>"
        )

    rows = "\n".join(
        f"<tr><td>{e(a.requirement.number)}</td><td>{e(a.requirement.section)}</td><td>{e(a.scope)}</td>"
        f"<td>{e(a.implemented or '')}</td><td>{e(a.documented or '')}</td><td>{e(a.effectiveness or '')}</td>"
        f"<td>{'' if a.score is None else f'{a.score:.0%}'}</td><td>{e(a.evidence or '')}</td>"
        f"<td>{e(a.gap_description or '')}{hq_note(a)}</td>"
        f"<td>{e(', '.join(d.title for d in docs_by_answer.get(a.id, [])))}</td></tr>"
        for a in answers
    )
    ap = "\n".join(
        f"<tr><td>{e(i.code)}</td><td>{e(i.requirement.number)}</td><td>{e(i.title)}</td>"
        f"<td>{e(i.status)}</td><td>{e(str(i.target_date or ''))}</td></tr>"
        for i in items
    )
    scored = [a.score for a in answers if a.score is not None]
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Evidence pack {e(ent.name)}</title>
<style>body{{font:13px/1.5 system-ui,sans-serif;margin:32px;color:#1b2230}}table{{border-collapse:collapse;width:100%;margin:12px 0 28px}}
th,td{{border:1px solid #dde2e0;padding:4px 6px;vertical-align:top;text-align:left}}th{{background:#f2f4f3}}h1{{font-size:22px}}</style></head><body>
<h1>NIS-2 evidence pack: {e(ent.name)} ({e(ent.code)})</h1>
<p>Assessment round {e(rnd.name)}; status {e(asm.status)}; generated {date.today().isoformat()} by {e(pr.user.display_name)}.
Average score {f"{mean(scored):.0%}" if scored else "–"}; {sum(1 for a in answers if a.wp_required)} findings.</p>
<p>Files: <code>answers.csv</code>, <code>action_plan.csv</code>, <code>documents.csv</code> and the current version of
linked documents and approved policies in <code>documents/</code>.</p>
<h2>Assessment answers</h2><table><tr><th>No.</th><th>Section</th><th>Scope</th><th>Impl.</th><th>Doc.</th><th>Eff.</th><th>Score</th><th>Evidence</th><th>Gap</th><th>Documents</th></tr>
{rows}</table><h2>Action plan</h2><table><tr><th>Code</th><th>Req.</th><th>Work package</th><th>Status</th><th>Target date</th></tr>{ap}</table>
</body></html>"""
