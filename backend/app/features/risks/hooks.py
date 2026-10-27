"""Registers risks for comments/document links, global search and the approval workflow (risk acceptance)."""

from datetime import date

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.util import register_target
from app.core.deps import Principal
from app.db import utcnow
from app.features.approvals.models import ApprovalRequest
from app.features.approvals.service import ApprovalTarget, register_approval_target
from app.features.risks.models import Risk
from app.features.risks.service import acceptance_version, add_months, effective_method, transfer_only
from app.models import Entity
from app.services.audit import audit
from app.services.indexing import index_object, register_source


def _j(*parts) -> str:
    return "\n".join(str(p) for p in parts if p)


def _build(db: Session, r: Risk) -> list[dict]:
    m = effective_method(db, r.entity_id)
    inh = m.level(r.inherent_likelihood, r.inherent_impact)
    res = m.level(r.residual_likelihood, r.residual_impact)
    return [
        {
            "title": f"{r.code} {r.title}"[:600],
            "content": _j(
                f"Risk {r.code} ({r.entity.name if r.entity else 'group-wide'}), status {r.status.replace('_', ' ')}",
                r.title,
                r.scenario,
                f"Threat: {r.threat.code} {r.threat.title}" if r.threat else None,
                f"Category: {r.category}" if r.category else None,
                f"Inherent risk: {inh.replace('_', ' ')}" if inh else None,
                f"Residual risk: {res.replace('_', ' ')}" if res else None,
                f"Existing controls: {r.existing_controls}" if r.existing_controls else None,
                f"Treatment: {', '.join(r.treatments or [])}" if r.treatments else None,
                r.treatment_justification,
            ),
            "entity_id": r.entity_id,
            "url": f"/risks/{r.id}",
            "meta": {"status": r.status, "residual_level": res},
        }
    ]


register_target("risk", Risk, "risks.read", "risks.manage")
register_source("risk", Risk, "risks.read", "Risk", _build)


# --- risk acceptance through the approval workflow -------------------------------------------------------------


def _validate(db: Session, pr: Principal, r: Risk) -> dict:
    if r.status == "closed":
        raise HTTPException(400, "Closed risks cannot be accepted")
    if "accept" not in (r.treatments or []):
        raise HTTPException(400, "Choose the treatment option Accept before requesting acceptance")
    if not r.residual_likelihood or not r.residual_impact:
        raise HTTPException(400, "Rate the residual likelihood and impact before requesting acceptance")
    if not r.acceptance_category:
        raise HTTPException(400, "Choose a justification category for the acceptance")
    if not (r.treatment_justification or "").strip():
        raise HTTPException(400, "Describe why the residual risk can be accepted (treatment justification)")
    m = effective_method(db, r.entity_id)
    lvl = m.level(r.residual_likelihood, r.residual_impact)
    above = m.above_appetite(lvl)
    return {
        "residual_level": lvl,
        "residual_score": r.residual_likelihood * r.residual_impact,
        "appetite_level": m.appetite_level,
        "above_appetite": above,
        "requires_management_body": above,
        "transfer_only": transfer_only(r),
        "acceptance_category": r.acceptance_category,
    }


def _board_member(db: Session, user_id: int, entity_id: int | None) -> bool:
    """Active member of the management body of the entity (group risks: of the headquarters), linked to the user
    in the governance module (management body register)."""
    try:
        from app.features.governance.models import BoardMember
    except ImportError:  # governance module not installed
        return False
    ids = (
        [entity_id]
        if entity_id is not None
        else list(db.scalars(select(Entity.id).where(Entity.is_headquarters.is_(True))))
    )
    if not ids:
        return False
    return (
        db.scalar(
            select(BoardMember.id)
            .where(
                BoardMember.user_id == user_id,
                BoardMember.entity_id.in_(ids),
                or_(BoardMember.left_at.is_(None), BoardMember.left_at > date.today()),
            )
            .limit(1)
        )
        is not None
    )


def _check_approver(db: Session, apr: Principal, r: Risk, meta: dict | None) -> str | None:
    """Who may accept a residual risk.

    - Within the risk appetite: a person with risks.manage for the risk's entity (group-wide for group risks), or
      a member of that entity's management body.
    - Above the risk appetite ("requires management body decision", BSI guidance on § 30 BSIG, Cbw Art. 24):
      a member of the entity's management body (user linked in the governance module), or a person holding both
      governance.manage and risks.manage for the entity, who records the board decision on its behalf.
    The rule is checked when requesting and again when deciding."""
    ent = r.entity_id
    m = effective_method(db, ent)
    above = bool((meta or {}).get("requires_management_body")) or m.above_appetite(
        m.level(r.residual_likelihood, r.residual_impact)
    )
    name = apr.user.display_name
    where = r.entity.name if r.entity else "the group"
    if _board_member(db, apr.id, ent):
        return None
    if above:
        if apr.can_write("governance.manage", ent) and apr.can_write("risks.manage", ent):
            return None
        return (
            f"The residual risk is above the risk appetite: only a member of the management body of {where} "
            f"(linked user in the management body register) or someone with governance and risk management "
            f"rights for {where} may accept it. {name} is neither."
        )
    if apr.can_write("risks.manage", ent):
        return None
    return f"{name} cannot accept risks of {where}: risk management rights or management body membership are required"


def _decision(db: Session, pr: Principal, req: ApprovalRequest, r: Risk) -> None:
    if req.status != "approved":
        return
    if r.status == "closed":
        raise HTTPException(409, "The risk has been closed; it cannot be accepted")
    m = effective_method(db, r.entity_id)
    old = r.status
    r.status = "accepted"
    r.accepted_at = utcnow()
    r.accepted_by = pr.user.display_name[:200]
    r.last_reviewed_at = date.today()
    r.next_review_date = add_months(date.today(), m.review_cycle_months or 12)
    audit(
        db,
        pr,
        "update",
        "risk",
        r.id,
        f"{r.code} {r.title}",
        entity_id=r.entity_id,
        details={
            "status": [old, "accepted"],
            "next_review_date": [None, r.next_review_date.isoformat()],
            "approval_id": req.id,
        },
    )
    # the acceptance now covers the accepted state: pin it (closing or reopening the risk ends the acceptance)
    req.target_version, req.target_version_label = acceptance_version(r, m)
    db.flush()
    index_object(db, "risk", r.id, commit=False)


register_approval_target(
    "risk_acceptance",
    ApprovalTarget(
        model=Risk,
        read_perm="risks.read",
        write_perm="risks.manage",
        noun="risk acceptance",
        label=lambda r: f"{r.code} {r.title}",
        url=lambda r: f"/risks/{r.id}",
        version=lambda db, r: acceptance_version(r, effective_method(db, r.entity_id)),
        custom_access=True,
        validate_request=_validate,
        on_decision=_decision,
        check_approver=_check_approver,
    ),
)


def _my_risk_reviews(db, pr, stakeholder_ids):
    from datetime import date, timedelta

    from sqlalchemy import select

    from app.features.risks.models import Risk

    items = []
    soon = date.today() + timedelta(days=30)
    for r in db.scalars(select(Risk).where(Risk.status != "closed")):
        if not pr.can_read("risks.read", r.entity_id):
            continue
        owner = getattr(r, "owner_user_id", None) == pr.id or (
            getattr(r, "owner_stakeholder_id", None) in stakeholder_ids
        )
        if owner and r.next_review_date and r.next_review_date <= soon:
            items.append(
                {
                    "kind": "risk_review",
                    "kind_label": "Risk reviews",
                    "id": r.id,
                    "code": r.code,
                    "title": r.title,
                    "entity_code": r.entity.code if getattr(r, "entity", None) else None,
                    "due": r.next_review_date,
                    "href": f"/risks/{r.id}",
                    "status": "Review",
                }
            )
    return items


def _register_mywork():
    from app.services.mywork import register_provider

    register_provider("risks", _my_risk_reviews)


_register_mywork()


def _register_reminders():
    from app.features.risks.service import run_risk_reminders
    from app.services.notify import register_reminder_job

    register_reminder_job(run_risk_reminders)


_register_reminders()
