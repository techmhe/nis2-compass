"""Register audit objects for comments/document links, global search, the approval workflow (effectiveness
review), the personal "My work" view, the reminder job, the management-report section and data-quality rules."""

from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.util import register_target
from app.core.deps import Principal
from app.features.approvals.models import ApprovalRequest
from app.features.approvals.service import ApprovalTarget, register_approval_target
from app.features.audits.models import Audit, AuditFinding, EffectivenessReview, ManagementReview
from app.services.audit import audit
from app.services.indexing import index_object, register_source

register_target("audit", Audit, "audits.read", "audits.manage")
register_target("audit_finding", AuditFinding, "audits.read", "audits.manage")
register_target("effectiveness_review", EffectivenessReview, "audits.read", "audits.manage")
register_target("management_review", ManagementReview, "audits.read", "audits.manage")


def _j(*parts) -> str:
    return "\n".join(str(p) for p in parts if p)


def _audit_build(db, a: Audit) -> list[dict]:
    return [
        {
            "title": f"{a.code} {a.scope}"[:600],
            "content": _j(
                f"Audit {a.code} ({a.type}), status {a.status}",
                f"Entity: {a.entity.name if a.entity else 'group-wide'}",
                a.scope,
                f"Requirement/chapter scope: {a.requirement_chapter}" if a.requirement_chapter else None,
                a.summary,
                a.conclusion,
            ),
            "entity_id": a.entity_id,
            "url": f"/audits/programme?audit={a.id}",
            "meta": {"code": a.code, "status": a.status},
        }
    ]


def _finding_build(db, f: AuditFinding) -> list[dict]:
    return [
        {
            "title": f"{f.audit.code} {f.number}: {f.description[:200]}",
            "content": _j(
                f"Audit finding {f.number} of {f.audit.code} ({f.type.replace('_', ' ')})", f.description
            ),
            "entity_id": f.entity_id if f.entity_id is not None else f.audit.entity_id,
            "url": f"/audits/findings?finding={f.id}",
            "meta": {"type": f.type, "status": f.status},
        }
    ]


register_source("audit", Audit, "audits.read", "Audit", _audit_build)
register_source("audit_finding", AuditFinding, "audits.read", "Audit finding", _finding_build)


def _review_build(db, r: EffectivenessReview) -> list[dict]:
    label = f"{r.period} {r.entity.code if r.entity else 'Group'}"
    return [
        {
            "title": f"Effectiveness review {label}",
            "content": _j(
                f"Cbb Art. 18 effectiveness evaluation {label}, status {r.status}",
                r.conclusion,
                *[
                    f"Chapter {row.get('chapter')}: {row.get('rating')} – {row.get('rationale') or ''}"
                    for row in (r.rows or [])
                ],
            ),
            "entity_id": r.entity_id,
            "url": f"/audits/effectiveness-reviews?review={r.id}",
            "meta": {"status": r.status, "period": r.period},
        }
    ]


def _mgmt_review_build(db, m: ManagementReview) -> list[dict]:
    return [
        {
            "title": f"Management review {m.date.isoformat()}",
            "content": _j(
                f"ISO/IEC 27001 9.3 management review of {m.entity.name if m.entity else 'the group'} "
                f"on {m.date.isoformat()}",
                m.participants,
                *[f"Decision: {d.get('text')}" for d in (m.decisions or [])],
            ),
            "entity_id": m.entity_id,
            "url": f"/audits/management-reviews?review={m.id}",
            "meta": {"date": m.date.isoformat()},
        }
    ]


register_source(
    "effectiveness_review", EffectivenessReview, "audits.read", "Effectiveness review", _review_build
)
register_source("management_review", ManagementReview, "audits.read", "Management review", _mgmt_review_build)


# --- effectiveness review approval (Cbb Art. 18) ---------------------------------------------------------------


def _review_version(db: Session, r: EffectivenessReview) -> tuple[str | None, str | None]:
    # a hash of the substantive content, not updated_at: requesting approval itself flips draft -> in_review,
    # which must not immediately look like a change made "after" the request
    import hashlib
    import json

    payload = json.dumps({"rows": r.rows or [], "conclusion": r.conclusion}, sort_keys=True, default=str)
    key = hashlib.sha256(payload.encode()).hexdigest()[:16]
    ts = r.updated_at
    return f"content:{key}", (f"state of {ts:%d %b %Y %H:%M}" if ts else None)


def _review_validate(db: Session, pr: Principal, r: EffectivenessReview) -> dict | None:
    if r.status == "approved":
        raise HTTPException(400, "This review has already been approved")
    if not r.rows:
        raise HTTPException(400, "Rate at least one chapter before requesting approval")
    if not (r.conclusion or "").strip():
        raise HTTPException(400, "Write the overall conclusion before requesting approval")
    if r.status == "draft":
        r.status = "in_review"
    return None


def _review_decision(db: Session, pr: Principal, req: ApprovalRequest, r: EffectivenessReview) -> None:
    if req.status != "approved":
        if r.status == "in_review":
            r.status = "draft"
        return
    r.status = "approved"
    r.approved_at = date.today()
    r.approved_by = pr.user.display_name[:200]
    audit(
        db,
        pr,
        "approve",
        "effectiveness_review",
        r.id,
        r.period,
        entity_id=r.entity_id,
        details={"approval_id": req.id},
    )
    db.flush()
    index_object(db, "effectiveness_review", r.id, commit=False)


def _review_withdraw(db: Session, pr: Principal, req: ApprovalRequest, r: EffectivenessReview) -> None:
    if r.status == "in_review":
        r.status = "draft"


register_approval_target(
    "effectiveness_review",
    ApprovalTarget(
        model=EffectivenessReview,
        read_perm="audits.read",
        write_perm="audits.manage",
        noun="effectiveness review",
        label=lambda r: f"{r.period} {r.entity.code if r.entity else 'Group'} effectiveness review",
        url=lambda r: f"/audits/effectiveness-reviews?review={r.id}",
        version=_review_version,
        validate_request=_review_validate,
        on_decision=_review_decision,
        on_withdraw=_review_withdraw,
        approve_perm="audits.manage",
    ),
)


# --- personal "My work" view -------------------------------------------------------------------------------------


def _my_audit_work(db, pr, stakeholder_ids):
    items = []
    for a in db.scalars(
        select(Audit).where(Audit.lead_auditor_id.is_not(None), Audit.status.in_(("planned", "in_progress")))
    ):
        if a.lead_auditor_id == pr.id and pr.can_read("audits.read", a.entity_id):
            items.append(
                {
                    "kind": "audit",
                    "kind_label": "Audits",
                    "id": a.id,
                    "code": a.code,
                    "title": a.scope[:120],
                    "entity_code": a.entity.code if a.entity else None,
                    "due": a.planned_end,
                    "href": f"/audits/programme?audit={a.id}",
                    "status": a.status,
                }
            )
    for f in db.scalars(
        select(AuditFinding).where(AuditFinding.status != "closed", AuditFinding.due_date.is_not(None))
    ):
        ent = f.entity_id if f.entity_id is not None else f.audit.entity_id
        if f.audit.lead_auditor_id == pr.id and pr.can_read("audits.read", ent):
            items.append(
                {
                    "kind": "audit_finding",
                    "kind_label": "Audit findings",
                    "id": f.id,
                    "code": f"{f.audit.code} {f.number}",
                    "title": f.description[:120],
                    "entity_code": f.entity.code
                    if f.entity
                    else (f.audit.entity.code if f.audit.entity else None),
                    "due": f.due_date,
                    "href": f"/audits/findings?finding={f.id}",
                    "status": f.status,
                }
            )
    for r in db.scalars(
        select(EffectivenessReview).where(
            EffectivenessReview.status == "draft", EffectivenessReview.created_by_id.is_not(None)
        )
    ):
        if r.created_by_id == pr.id and pr.can_read("audits.read", r.entity_id):
            items.append(
                {
                    "kind": "effectiveness_review",
                    "kind_label": "Effectiveness reviews",
                    "id": r.id,
                    "code": None,
                    "title": f"{r.period} effectiveness evaluation",
                    "entity_code": r.entity.code if r.entity else None,
                    "due": None,
                    "href": f"/audits/effectiveness-reviews?review={r.id}",
                    "status": "Draft",
                }
            )
    return items


def _register_mywork():
    from app.services.mywork import register_provider

    register_provider("audits", _my_audit_work)


_register_mywork()


# --- reminders -------------------------------------------------------------------------------------------------


def _register_reminders():
    from app.features.audits.reminders import run_audit_reminders
    from app.services.notify import register_reminder_job

    register_reminder_job(run_audit_reminders)


_register_reminders()


# --- management-report section ----------------------------------------------------------------------------------


def _report_section(db, pr, entity_id):
    scope = {entity_id} if entity_id is not None else None
    findings = [
        f
        for f in db.scalars(select(AuditFinding).where(AuditFinding.status != "closed"))
        if pr.can_read("audits.read", f.entity_id if f.entity_id is not None else f.audit.entity_id)
        and (scope is None or (f.entity_id if f.entity_id is not None else f.audit.entity_id) in scope)
    ]
    by_type: dict[str, int] = {}
    for f in findings:
        by_type[f.type] = by_type.get(f.type, 0) + 1
    reviews = [
        r
        for r in db.scalars(select(EffectivenessReview).order_by(EffectivenessReview.period.desc()))
        if pr.can_read("audits.read", r.entity_id) and (scope is None or r.entity_id in scope)
    ]
    latest_by_entity: dict[int | None, EffectivenessReview] = {}
    for r in reviews:
        latest_by_entity.setdefault(r.entity_id, r)
    if not findings and not latest_by_entity:
        return None
    # same shape as every report section: title, items (label/value/tone) and notes
    items = [{"label": "Open audit findings", "value": len(findings), "tone": "alarm" if findings else None}]
    items += [{"label": t.replace("_", " ").capitalize(), "value": n} for t, n in sorted(by_type.items())]
    return {
        "title": "Audits & effectiveness (Cbb Art. 18, ISO 9.2)",
        "items": items,
        "notes": [
            f"Effectiveness review {r.entity.code if r.entity else 'Group'} {r.period}: {r.status.replace('_', ' ')}"
            for r in latest_by_entity.values()
        ],
    }


def _register_report_section():
    from app.features.reports.api import register_section

    register_section("audits", _report_section)


_register_report_section()


def _register_checks():
    import app.features.audits.checks  # noqa: F401


_register_checks()


def _register_link_labels():
    from app.api.documents import register_link_label

    register_link_label("audit", lambda o: (f"Audit {o.code}", f"/audits/programme?audit={o.id}"))
    register_link_label(
        "audit_finding", lambda o: (f"Finding {o.audit.code} {o.number}", f"/audits/findings?finding={o.id}")
    )
    register_link_label(
        "effectiveness_review",
        lambda o: (
            f"Effectiveness review {o.period} {o.entity.code if o.entity else 'Group'}",
            f"/audits/effectiveness-reviews?review={o.id}",
        ),
    )
    register_link_label(
        "management_review",
        lambda o: (f"Management review {o.date.isoformat()}", f"/audits/management-reviews?review={o.id}"),
    )


_register_link_labels()
