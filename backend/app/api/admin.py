import asyncio
import os
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.deps import Principal, require, require_global
from app.db import SessionLocal, get_db
from app.models import AssessmentRound, AuditEvent, SearchChunk, Setting, User
from app.services.audit import audit
from app.services.export import export_filename, export_gap, export_project, import_gap
from app.services.indexing import reindex_all
from app.services.search import search

router = APIRouter(tags=["admin"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/search")
def global_search(
    q: str = Query(min_length=1, max_length=300),
    types: list[str] | None = Query(default=None),
    entity_id: int | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    pr: Principal = Depends(require("entities.read")),
    db: Session = Depends(get_db),
):
    hits = search(db, pr, q, types=types, entity_id=entity_id, limit=limit)
    return [h.as_dict() for h in hits]


@router.get("/audit")
def audit_log(
    q: str | None = Query(default=None, max_length=200),
    action: str | None = None,
    target_type: str | None = None,
    actor_id: int | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    pr: Principal = Depends(require("audit.read")),
    db: Session = Depends(get_db),
):
    stmt = select(AuditEvent)
    scope = pr.entity_scope("audit.read")
    if scope is not None:
        stmt = stmt.where(AuditEvent.entity_id.in_(scope))
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    if target_type:
        stmt = stmt.where(AuditEvent.target_type == target_type)
    if actor_id:
        stmt = stmt.where(AuditEvent.actor_id == actor_id)
    if since:
        stmt = stmt.where(AuditEvent.at >= since)
    if until:
        stmt = stmt.where(AuditEvent.at <= until)
    if q:
        like = f"%{q[:100]}%"
        stmt = stmt.where(or_(AuditEvent.target_label.ilike(like), AuditEvent.actor_label.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(AuditEvent.at.desc()).offset(offset).limit(limit)).all()
    return {
        "total": total,
        "items": [
            {
                "id": e.id,
                "at": e.at,
                "actor": e.actor_label,
                "actor_id": e.actor_id,
                "action": e.action,
                "target_type": e.target_type,
                "target_id": e.target_id,
                "target_label": e.target_label,
                "entity_id": e.entity_id,
                "details": e.details,
                "ip": e.ip,
            }
            for e in rows
        ],
    }


def _tls_info() -> dict:
    """Read-only view of the deployment's certificate settings. They live in deploy/.env (operator-controlled) and
    cannot be changed from the application."""
    issuer = os.environ.get("TLS_ISSUER") or "default"
    mode = os.environ.get("TLS_MODE") or "internal"
    kind = (
        "acme_custom"
        if issuer in ("acme", "acme_eab")
        else "internal"
        if mode == "internal"
        else "letsencrypt"
    )
    extra = os.environ.get("NIS2_EXTRA_CA_CERTS")
    ca_url = (os.environ.get("ACME_CA_URL") or None) if kind == "acme_custom" else None
    return {
        "issuer": kind,
        "acme_ca_url": ca_url,
        "eab": issuer == "acme_eab",
        "extra_ca_certs": extra.split(",") if extra else [],
    }


@router.get("/admin/system")
def system_info(pr: Principal = Depends(require_global("settings.manage")), db: Session = Depends(get_db)):
    s = get_settings()
    return {
        "app_name": s.app_name,
        "env": s.env,
        "base_url": s.base_url,
        "auth": {
            "local_enabled": s.local_auth_enabled,
            "oidc_enabled": s.oidc_enabled,
            "oidc_issuer": s.oidc_issuer,
            "oidc_client_id": s.oidc_client_id,
            "oidc_groups_claim": s.oidc_groups_claim,
            "oidc_role_mapping": s.oidc_role_mapping,
            "oidc_default_role": s.oidc_default_role,
            "session_idle_minutes": s.session_idle_minutes,
            "session_absolute_hours": s.session_absolute_hours,
        },
        "uploads": {"max_upload_mb": s.max_upload_mb, "allowed_extensions": s.allowed_extensions},
        "smtp_configured": bool(s.smtp_host and s.smtp_from),
        "tls": _tls_info(),
        "index": {"chunks": db.scalar(select(func.count(SearchChunk.id)))},
        "users": db.scalar(select(func.count(User.id))),
        "db_version": db.scalar(select(func.version())),
    }


@router.get("/admin/settings")
def get_general_settings(
    pr: Principal = Depends(require_global("settings.manage")), db: Session = Depends(get_db)
):
    return {row.key: row.value for row in db.scalars(select(Setting).where(~Setting.key.like("ai.%")))}


@router.put("/admin/settings")
def put_general_settings(
    body: dict, pr: Principal = Depends(require_global("settings.manage")), db: Session = Depends(get_db)
):
    allowed = {"branding.org_name", "reminders.due_soon_days", "branding.banner"}
    for k, v in body.items():
        if k not in allowed:
            raise HTTPException(400, f"Unknown setting {k}")
        row = db.get(Setting, k)
        if row:
            row.value = v
        else:
            db.add(Setting(key=k, value=v))
    audit(db, pr, "update", "settings", None, "general settings", details=body)
    db.commit()
    return {"ok": True}


@router.post("/admin/reindex")
def reindex(pr: Principal = Depends(require_global("settings.manage")), db: Session = Depends(get_db)):
    n = reindex_all(db)
    audit(db, pr, "reindex", "settings", None, "search index", details={"chunks": n})
    db.commit()
    return {"chunks": n}


# --- import / export ------------------------------------------------------------------------------------


def _with_session(fn, *args):
    db = SessionLocal()
    try:
        return fn(db, *args)
    finally:
        db.close()


def _current_round(db: Session) -> int:
    rid = db.scalar(select(AssessmentRound.id).where(AssessmentRound.is_current.is_(True)))
    if not rid:
        raise HTTPException(400, "No current assessment round")
    return rid


@router.get("/export/gap-workbook")
def gap_workbook(
    round_id: int | None = None,
    pr: Principal = Depends(require("reports.export", "assessments.read")),
    db: Session = Depends(get_db),
):
    read, export = pr.entity_scope("assessments.read"), pr.entity_scope("reports.export")
    scope = export if read is None else read if export is None else read & export
    data = export_gap(db, round_id or _current_round(db), scope)
    audit(db, pr, "export", "assessment", None, "GAP workbook")
    db.commit()
    return Response(
        data,
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{export_filename("NIS2_GAP_Analysis")}"'},
    )


@router.get("/export/project-workbook/{project_id}")
def project_workbook(
    project_id: int,
    pr: Principal = Depends(require_global("reports.export", "projects.read")),
    db: Session = Depends(get_db),
):
    data = export_project(db, project_id)
    audit(db, pr, "export", "project", project_id, "Project workbook")
    db.commit()
    return Response(
        data,
        media_type=XLSX,
        headers={
            "Content-Disposition": f'attachment; filename="{export_filename("NIS2_Implementation_Project_Plan")}"'
        },
    )


@router.post("/import/gap-workbook")
async def gap_import(
    file: UploadFile = File(...),
    dry_run: bool = True,
    round_id: int | None = None,
    pr: Principal = Depends(require("assessments.edit")),
    db: Session = Depends(get_db),
):
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(400, "Please upload an .xlsx workbook")
    data = await file.read(get_settings().max_upload_mb * 1024 * 1024 + 1)
    if len(data) > get_settings().max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "File too large")
    if not data.startswith(b"PK"):
        raise HTTPException(400, "Not a valid .xlsx file")
    rid = round_id or _current_round(db)
    rnd = db.get(AssessmentRound, rid)
    if not rnd or rnd.status == "closed":
        raise HTTPException(400, "Import is only possible into an open assessment round")
    from app.services.extract import zip_is_safe

    if not zip_is_safe(data):
        raise HTTPException(400, "Workbook is too large when uncompressed")
    try:
        result = await asyncio.to_thread(_with_session, import_gap, data, rid, pr, dry_run)
    except (KeyError, ValueError, IndexError) as e:
        raise HTTPException(400, f"Workbook does not match the GAP template: {e}") from e
    if not dry_run:
        from app.services.indexing import reindex_all as _ri

        await asyncio.to_thread(_with_session, _ri, ["answer", "action_item"])
        audit(db, pr, "import", "assessment", None, file.filename, details=result)
        db.commit()
    return result
