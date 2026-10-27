"""Audits & reviews demo seed: one 2026 audit programme, two audits, three findings and one draft effectiveness
review. Demo data only; idempotent."""

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.features.audits.models import (
    Audit,
    AuditFinding,
    AuditProgramme,
    EffectivenessReview,
)
from app.models import Entity, Requirement, User


def seed_demo(db: Session) -> None:
    if db.scalar(select(func.count(AuditProgramme.id))):
        return
    ents = {e.code: e for e in db.scalars(select(Entity))}
    if not all(c in ents for c in ("ATL", "ATS", "ATN")):
        return
    isb = db.scalar(select(User.id).where(User.email == "isb@demo.local"))
    atl, ats, atn = ents["ATL"], ents["ATS"], ents["ATN"]

    programme = AuditProgramme(
        year=2026,
        title="2026 internal audit programme",
        scope="Internal audits of the information security management system across the "
        "group, plus preparation for the first Cbb Art. 18 effectiveness evaluation.",
        approved_by="Dr. Katrin Vogel",
        approved_on=date(2026, 1, 20),
    )
    db.add(programme)
    db.flush()

    a1 = Audit(
        code="AUD-2026-01",
        programme_id=programme.id,
        type="internal",
        entity_id=atl.id,
        scope="Access control and identity management (chapter 9)",
        requirement_chapter="9",
        lead_auditor_id=isb,
        auditors="Isabel Schmidt",
        planned_start=date(2026, 3, 3),
        planned_end=date(2026, 3, 14),
        actual_start=date(2026, 3, 3),
        actual_end=date(2026, 3, 12),
        status="reported",
        summary="Access reviews are performed but not consistently evidenced; MFA roll-out incomplete for "
        "service accounts.",
        conclusion="Partially effective. Two nonconformities and one observation raised.",
    )
    a2 = Audit(
        code="AUD-2026-02",
        programme_id=programme.id,
        type="supplier",
        entity_id=atn.id,
        scope="Managed IT service provider security requirements (chapter 5)",
        requirement_chapter="5",
        lead_auditor_id=isb,
        auditors="Isabel Schmidt, Dutch external adviser",
        planned_start=date(2026, 9, 7),
        planned_end=date(2026, 9, 25),
        status="in_progress",
        summary="On-site review of the MSP's security controls against the intra-group service agreement.",
    )
    db.add_all([a1, a2])
    db.flush()

    req_id = db.scalar(select(Requirement.id).where(Requirement.number == "9.1"))
    findings = [
        AuditFinding(
            audit_id=a1.id,
            number="F1",
            type="minor_nonconformity",
            description="Quarterly access reviews for ATL are performed but not all reviews are evidenced "
            "with a signed-off record (IR 2024/2690 11.4).",
            requirement_id=req_id,
            entity_id=atl.id,
            status="open",
            due_date=date.today() + timedelta(days=21),
        ),
        AuditFinding(
            audit_id=a1.id,
            number="F2",
            type="major_nonconformity",
            description="Phishing-resistant MFA is not enforced for privileged service accounts, contrary "
            "to the approved 2026 roll-out plan (§ 30(2) Nr. 9 BSIG).",
            requirement_id=req_id,
            entity_id=ats.id,
            status="open",
            due_date=date.today() - timedelta(days=3),
        ),
        AuditFinding(
            audit_id=a1.id,
            number="F3",
            type="observation",
            description="The access review procedure does not yet reference the escalation path for "
            "reviewers who do not respond within the deadline.",
            entity_id=atl.id,
            status="open",
            due_date=date.today() + timedelta(days=45),
        ),
    ]
    db.add_all(findings)
    db.flush()

    db.add(
        EffectivenessReview(
            entity_id=atl.id,
            period="2026",
            status="draft",
            rows=[
                {
                    "chapter": 5,
                    "rating": "effective",
                    "rationale": "Supplier due diligence and contract clauses in place; MSP audited in AUD-2026-02.",
                },
                {
                    "chapter": 9,
                    "rating": "partially_effective",
                    "rationale": "Access reviews performed but evidencing and MFA coverage incomplete (see AUD-2026-01 findings).",
                },
                {"chapter": 14, "rating": "not_assessed", "rationale": ""},
            ],
            conclusion=None,
            created_by_id=isb,
        )
    )
    db.flush()


def seed(db: Session, demo: bool) -> None:
    from app.features.audits import hooks  # noqa: F401  (search sources)
    from app.models import SearchChunk
    from app.services.indexing import reindex_all

    if demo:
        seed_demo(db)
    db.commit()
    # on a fresh database the seed runner indexes everything afterwards; only refresh our types otherwise
    if db.scalar(select(func.count(SearchChunk.id))):
        reindex_all(db, types=["audit", "audit_finding", "effectiveness_review", "management_review"])
