"""Reference data (group risk method, threat catalogue) and demo risks with realistic manufacturing / OT scenarios."""

from datetime import date, timedelta
from types import SimpleNamespace

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.features.approvals.models import ApprovalRequest
from app.features.risks.models import Risk, RiskLink, RiskMethod, Threat
from app.features.risks.service import (
    DEFAULT_ACCEPTANCE,
    DEFAULT_IMPACT,
    DEFAULT_LIKELIHOOD,
    Method,
    acceptance_version,
    add_months,
)
from app.models import ActionItem, Answer, Assessment, AssessmentRound, Entity, Requirement, User, WorkPackage
from app.services.audit import audit

# BSI IT-Grundschutz Compendium, elementary threats G 0.1 – G 0.47 (titles only)
BSI_THREATS = [
    "Fire",
    "Unfavourable climatic conditions",
    "Water",
    "Pollution, dust, corrosion",
    "Natural disasters",
    "Catastrophes in the vicinity",
    "Major events in the vicinity",
    "Failure or disruption of the power supply",
    "Failure or disruption of communication networks",
    "Failure or disruption of supply networks",
    "Failure or disruption of service providers",
    "Electromagnetic interference",
    "Interception of compromising emissions",
    "Interception of information / espionage",
    "Eavesdropping",
    "Theft of devices, storage media and documents",
    "Loss of devices, storage media and documents",
    "Poor planning or lack of adaptation",
    "Disclosure of sensitive information",
    "Information or products from an unreliable source",
    "Manipulation of hardware or software",
    "Manipulation of information",
    "Unauthorised access to IT systems",
    "Destruction of devices or storage media",
    "Failure of devices or systems",
    "Malfunction of devices or systems",
    "Lack of resources",
    "Software vulnerabilities or errors",
    "Violation of laws or regulations",
    "Unauthorised use or administration of devices and systems",
    "Incorrect use or administration of devices and systems",
    "Misuse of authorisation",
    "Shortage of personnel",
    "Attack",
    "Coercion, blackmail or corruption",
    "Identity theft",
    "Repudiation of actions",
    "Misuse of personal information",
    "Malware",
    "Denial of service",
    "Sabotage",
    "Social engineering",
    "Attack with specially crafted messages",
    "Unauthorised entry to premises",
    "Data loss",
    "Loss of integrity of sensitive information",
    "Harmful side effects of IT-supported attacks",
]

# Industrial control systems: BSI "Top 10 threats and countermeasures" for ICS plus common OT scenarios
OT_THREATS = [
    ("OT-01", "Social engineering and phishing targeting production staff", "BSI ICS Top 10"),
    ("OT-02", "Infiltration of malware via removable media and external hardware", "BSI ICS Top 10"),
    ("OT-03", "Malware infection via internet and intranet", "BSI ICS Top 10"),
    ("OT-04", "Intrusion via remote maintenance access", "BSI ICS Top 10"),
    ("OT-05", "Human error and sabotage in the production environment", "BSI ICS Top 10"),
    ("OT-06", "Control components connected to the internet", "BSI ICS Top 10"),
    ("OT-07", "Technical malfunctions and force majeure", "BSI ICS Top 10"),
    ("OT-08", "Compromise of extranet and cloud components", "BSI ICS Top 10"),
    ("OT-09", "(D)DoS attacks on production networks", "BSI ICS Top 10"),
    ("OT-10", "Compromise of smartphones and tablets in the production environment", "BSI ICS Top 10"),
    ("OT-11", "Unsupported operating systems on HMI and engineering stations", "Group OT catalogue"),
    ("OT-12", "Manipulation of safety instrumented systems", "Group OT catalogue"),
    ("OT-13", "Missing segmentation between office IT and production networks", "Group OT catalogue"),
    ("OT-14", "Manipulated firmware or software updates from machine suppliers", "Group OT catalogue"),
]


def _seed_reference(db: Session) -> None:
    if not db.scalar(select(func.count(RiskMethod.id)).where(RiskMethod.entity_id.is_(None))):
        db.add(
            RiskMethod(
                entity_id=None,
                name="Group risk method",
                likelihood_scale=DEFAULT_LIKELIHOOD,
                impact_scale=DEFAULT_IMPACT,
                threshold_medium=5,
                threshold_high=10,
                threshold_very_high=16,
                appetite_level="medium",
                acceptance_criteria=DEFAULT_ACCEPTANCE,
                review_cycle_months=12,
            )
        )
    if not db.scalar(select(func.count(Threat.id))):
        n = 0
        for i, title in enumerate(BSI_THREATS, start=1):
            n += 1
            db.add(
                Threat(
                    code=f"G 0.{i}",
                    title=title,
                    category="Elementary threat",
                    source="BSI IT-Grundschutz",
                    sort_order=n,
                )
            )
        for code, title, source in OT_THREATS:
            n += 1
            db.add(
                Threat(
                    code=code, title=title, category="Industrial control systems", source=source, sort_order=n
                )
            )
    db.flush()


def _answer(db: Session, entity: Entity, *words: str) -> Answer | None:
    """A No / Partial answer of the entity in the current round whose requirement matches one of the words."""
    for w in words:
        a = db.scalars(
            select(Answer)
            .join(Assessment, Assessment.id == Answer.assessment_id)
            .join(AssessmentRound, AssessmentRound.id == Assessment.round_id)
            .join(Requirement, Requirement.id == Answer.requirement_id)
            .where(
                AssessmentRound.is_current.is_(True),
                Assessment.entity_id == entity.id,
                Answer.implemented.in_(["No", "Partial"]),
                Requirement.section.ilike(f"%{w}%"),
            )
            .order_by(Requirement.id)
        ).first()
        if a:
            return a
    return None


def _action_item(db: Session, a: Answer) -> ActionItem | None:
    """The action plan item for the gap of this answer (same entity and requirement)."""
    return db.scalars(
        select(ActionItem).where(
            ActionItem.entity_id == a.assessment.entity_id, ActionItem.requirement_id == a.requirement_id
        )
    ).first()


def _work_package(db: Session, *words: str) -> WorkPackage | None:
    for w in words:
        wp = db.scalars(
            select(WorkPackage).where(WorkPackage.title.ilike(f"%{w}%")).order_by(WorkPackage.code)
        ).first()
        if wp:
            return wp
    return None


# (entity, title, scenario, threat, category, owner email, inherent L/I, controls, residual L/I, treatments,
#  justification, acceptance category, status, answer keywords, measure keywords)
DEMO = [
    (
        "ATL",
        "Ransomware encrypts ERP and production planning systems",
        "A phishing mail or an exposed service gives an attacker a foothold in the office network. The attacker "
        "escalates privileges, disables backups and encrypts ERP, MES and file servers. Production planning and "
        "shipping stop for several days.",
        "G 0.39",
        "Cyber attack",
        "isb@demo.local",
        (4, 5),
        "EDR on all clients and servers; weekly offline backup of ERP; MFA for VPN access.",
        (3, 4),
        ["reduce"],
        "Immutable backups, tiered administration and a tested restore plan reduce the impact.",
        None,
        "in_treatment",
        ["backup", "malware"],
        ["MFA"],
    ),
    (
        "ATL",
        "Compromise of remote maintenance access by machine suppliers",
        "Machine suppliers connect to press lines and robot cells through their own remote maintenance routers. A "
        "compromised supplier account gives direct access to PLCs without monitoring on our side.",
        "OT-04",
        "Supplier and third party",
        "it@demo.local",
        (4, 4),
        "Supplier routers are switched on by the shift lead on request; supplier contracts contain a confidentiality "
        "clause.",
        (3, 4),
        ["reduce"],
        "Central remote access gateway with MFA, session recording and approval per session.",
        None,
        "in_treatment",
        ["remote", "supplier"],
        ["remote"],
    ),
    (
        "ATL",
        "Fire in the central server room",
        "A fire in the server room at headquarters destroys the virtualisation cluster and the core network. "
        "Without a second site, recovery depends on hardware delivery times.",
        "G 0.1",
        "Physical and environmental",
        "isb@demo.local",
        (2, 5),
        "Fire detection with alarm to the fire brigade; gas extinguishing system; backups stored in another building.",
        (1, 5),
        ["reduce", "transfer"],
        "Second server room planned for 2027; property and business interruption "
        "insurance covers hardware and loss of profit.",
        None,
        "assessed",
        ["physical", "environment"],
        [],
    ),
    (
        "ATS",
        "Phishing leads to theft of engineering drawings",
        "Engineers receive targeted phishing mails that look like customer RFQs. Stolen credentials give access to "
        "the PLM system with drawings of customer-specific equipment.",
        "G 0.42",
        "Cyber attack",
        "isb@demo.local",
        (4, 3),
        "Mail filter with sandboxing; annual awareness e-learning.",
        (3, 3),
        ["reduce"],
        "MFA for PLM and phishing simulations for engineering.",
        None,
        "in_treatment",
        ["awareness", "training"],
        ["MFA"],
    ),
    (
        "ATS",
        "Unsupported Windows 7 HMI stations in the paint shop",
        "Four HMI stations of the paint shop run Windows 7 and cannot be patched. The line supplier only supports an "
        "upgrade together with a retrofit of the line, planned for 2027.",
        "OT-11",
        "Technical failure",
        "it@demo.local",
        (3, 4),
        "Stations are isolated in their own VLAN without internet access; USB ports are blocked; application "
        "whitelisting is active.",
        (3, 3),
        ["reduce", "accept"],
        "Compensating controls are in place. The residual risk is accepted until the line retrofit in 2027.",
        "Temporary until planned treatment is completed",
        "assessed",
        ["vulnerab", "patch"],
        [],
    ),
    (
        "ATN",
        "Flat network between office IT and production",
        "Office clients and production controllers share one network. Malware from an office client can spread to "
        "PLCs and SCADA servers and stop production.",
        "OT-13",
        "Cyber attack",
        "nl.contact@demo.local",
        (4, 5),
        "Firewall to the internet; antivirus on office clients.",
        (4, 4),
        ["reduce"],
        "Segmentation project with a production DMZ following IEC 62443 zones and conduits.",
        None,
        "in_treatment",
        ["network", "segment"],
        [],
    ),
    (
        "ATN",
        "Single administrator for the SCADA system",
        "Only one employee knows the configuration of the SCADA system. Absence or departure of this person delays "
        "recovery after a failure by several days.",
        "G 0.33",
        "Organisational and legal",
        "nl.contact@demo.local",
        (3, 4),
        "Configuration backups exist; the supplier offers support on call within 48 hours.",
        (3, 4),
        ["accept"],
        "A second administrator cannot be hired before the 2027 budget. Documentation of the "
        "configuration is being written.",
        "Treatment cost disproportionate to the risk",
        "assessed",
        ["human resources", "personnel"],
        [],
    ),
    (
        "ATC",
        "Outage of the external cloud ERP provider",
        "Order intake, warehouse management and dangerous-goods documents depend on a cloud ERP. An outage at the "
        "provider stops deliveries to customers.",
        "G 0.11",
        "Supplier and third party",
        "nl.contact@demo.local",
        (3, 4),
        "SLA with 99.5 % availability; manual emergency forms for dangerous-goods papers.",
        (2, 4),
        ["transfer"],
        "Contractual penalties with the provider.",
        None,
        "assessed",
        ["supplier", "supply"],
        ["supplier"],
    ),
    (
        "ATC",
        "Manipulation of tank level monitoring in the chemicals warehouse",
        "An attacker with access to the warehouse network manipulates tank level sensors or the alarm thresholds of "
        "the safety system. Overfilling could cause a spill.",
        "OT-12",
        "Cyber attack",
        "nl.contact@demo.local",
        (2, 5),
        "Independent mechanical overfill protection; safety system on a separate network.",
        (1, 5),
        ["reduce"],
        "Annual check of the safety system configuration and change control on alarm thresholds.",
        None,
        "assessed",
        ["change management", "configuration"],
        [],
    ),
    (
        None,
        "Compromise of the group Active Directory",
        "An attacker obtains domain administrator rights through credential theft on a workstation. With control of "
        "the group AD, all entities are affected at once.",
        "G 0.23",
        "Cyber attack",
        "isb@demo.local",
        (3, 5),
        "Separate admin accounts; password policy; logging of privileged logons.",
        (2, 5),
        ["reduce"],
        "Tiered administration model, LAPS and privileged access workstations.",
        None,
        "in_treatment",
        [],
        ["privileged"],
    ),
    (
        None,
        "Manipulated update of the MES software",
        "The supplier of the manufacturing execution system is compromised and delivers a manipulated update, which "
        "is installed in all plants.",
        "OT-14",
        "Supplier and third party",
        "isb@demo.local",
        (2, 4),
        "Updates are tested on a staging system for two weeks before roll-out; supplier is ISO 27001 certified.",
        (2, 3),
        ["reduce", "accept"],
        "Staging and the supplier certification bring the risk within appetite.",
        "Within risk appetite",
        "accepted",
        [],
        ["supplier"],
    ),
    (
        "ATL",
        "DDoS attack on the customer order portal",
        "A DDoS attack makes the customer order portal unavailable. Orders can still be placed by mail and phone.",
        "G 0.40",
        "Cyber attack",
        "it@demo.local",
        (3, 3),
        "DDoS protection by the hosting provider.",
        (2, 2),
        ["reduce", "transfer"],
        "Protection service contracted; cyber insurance covers loss of revenue.",
        None,
        "closed",
        [],
        [],
    ),
    (
        "ATN",
        "Flooding of the production site",
        "Heavy rainfall floods the ground floor of the plant, where the server room and the main distribution board "
        "are located.",
        "G 0.3",
        "Physical and environmental",
        "nl.contact@demo.local",
        (2, 4),
        "Water sensors in the server room; flood insurance.",
        (2, 3),
        ["reduce", "transfer"],
        "Relocation of the server room to the first floor is planned.",
        None,
        "assessed",
        [],
        [],
    ),
]


def _seed_demo(db: Session) -> None:
    if db.scalar(select(func.count(Risk.id))):
        return
    ents = {e.code: e for e in db.scalars(select(Entity))}
    users = {u.email: u for u in db.scalars(select(User))}
    threats = {t.code: t for t in db.scalars(select(Threat))}
    if not users.get("isb@demo.local") or not ents:
        return
    # acceptances: requested by the assessor, decided by the ISO (risk and governance management rights, so she may
    # also decide above-appetite acceptances on behalf of the management body)
    isb, requester = users["isb@demo.local"], users.get("assessor@demo.local")
    # stricter method for the chemicals distributor
    if "ATC" in ents and not db.scalar(select(RiskMethod.id).where(RiskMethod.entity_id == ents["ATC"].id)):
        db.add(
            RiskMethod(
                entity_id=ents["ATC"].id,
                name="Risk method ATC (chemicals)",
                likelihood_scale=DEFAULT_LIKELIHOOD,
                impact_scale=DEFAULT_IMPACT,
                threshold_medium=4,
                threshold_high=8,
                threshold_very_high=15,
                appetite_level="low",
                acceptance_criteria=DEFAULT_ACCEPTANCE + " For ATC, only low residual risks may be "
                "accepted without a decision of the management board (Cbw Art. 24).",
                review_cycle_months=12,
            )
        )
        db.flush()
    methods = {m.entity_id: m for m in db.scalars(select(RiskMethod))}
    actor = SimpleNamespace(user=isb)  # audit events of the demo data are attributed to the ISO
    today = date.today()
    for n, (
        ecode,
        title,
        scenario,
        tcode,
        cat,
        owner,
        inh,
        controls,
        res,
        treat,
        just,
        acc_cat,
        status,
        akw,
        mkw,
    ) in enumerate(DEMO, start=1):
        ent = ents.get(ecode) if ecode else None
        if ecode and ent is None:
            continue
        m_row = methods.get(ent.id if ent else None) or methods.get(None)
        m = Method.of(m_row) if m_row else Method()
        owner_u = users.get(owner) or isb
        created = today - timedelta(days=150 - n * 9)
        r = Risk(
            code=f"RSK-{n:03d}",
            entity_id=ent.id if ent else None,
            title=title,
            scenario=scenario,
            threat_id=threats[tcode].id if tcode in threats else None,
            category=cat,
            owner_user_id=owner_u.id,
            inherent_likelihood=inh[0],
            inherent_impact=inh[1],
            existing_controls=controls,
            residual_likelihood=res[0],
            residual_impact=res[1],
            treatments=treat,
            treatment_justification=just,
            acceptance_category=acc_cat,
            status=status,
            last_reviewed_at=created,
            next_review_date=add_months(created, 12),
            created_by_id=isb.id,
        )
        if n == 13:  # demo: overdue review
            r.last_reviewed_at = today - timedelta(days=400)
            r.next_review_date = today - timedelta(days=35)
        if status == "closed":
            r.closed_at = utcnow()
        db.add(r)
        db.flush()
        audit(db, actor, "create", "risk", r.id, f"{r.code} {r.title}", entity_id=r.entity_id)
        if ent is not None and akw and (a := _answer(db, ent, *akw)):
            db.add(
                RiskLink(
                    risk_id=r.id, link_type="gap", target_type="answer", target_id=a.id, created_by_id=isb.id
                )
            )
            if "reduce" in treat and (it := _action_item(db, a)):
                db.add(
                    RiskLink(
                        risk_id=r.id,
                        link_type="treatment",
                        target_type="action_item",
                        target_id=it.id,
                        created_by_id=isb.id,
                    )
                )
        if mkw and (wp := _work_package(db, *mkw)) is not None:
            db.add(
                RiskLink(
                    risk_id=r.id,
                    link_type="treatment",
                    target_type="work_package",
                    target_id=wp.id,
                    created_by_id=isb.id,
                )
            )
        key, vlabel = acceptance_version(r, m)
        lvl = m.level(*res)
        meta = {
            "residual_level": lvl,
            "residual_score": res[0] * res[1],
            "appetite_level": m.appetite_level,
            "above_appetite": m.above_appetite(lvl),
            "requires_management_body": m.above_appetite(lvl),
            "transfer_only": treat == ["transfer"],
            "acceptance_category": acc_cat,
        }
        if status == "accepted" and requester:
            decided = utcnow() - timedelta(days=40)
            r.accepted_at, r.accepted_by = decided, isb.display_name
            db.add(
                ApprovalRequest(
                    target_type="risk_acceptance",
                    target_id=r.id,
                    target_version=key,
                    target_version_label=vlabel,
                    target_label=f"{r.code} {r.title}",
                    target_url=f"/risks/{r.id}",
                    entity_id=r.entity_id,
                    requested_by_id=requester.id,
                    approver_user_id=isb.id,
                    due_date=(decided + timedelta(days=14)).date(),
                    status="approved",
                    request_note="Residual risk within appetite after staging.",
                    decision_note="Accepted. Review together with the next supplier audit.",
                    decided_at=decided,
                    meta=meta,
                )
            )
        elif acc_cat and requester:  # pending acceptance requests
            db.add(
                ApprovalRequest(
                    target_type="risk_acceptance",
                    target_id=r.id,
                    target_version=key,
                    target_version_label=vlabel,
                    target_label=f"{r.code} {r.title}",
                    target_url=f"/risks/{r.id}",
                    entity_id=r.entity_id,
                    requested_by_id=requester.id,
                    approver_user_id=isb.id,
                    due_date=today + timedelta(days=10 if n % 2 else -3),
                    status="pending",
                    request_note=just,
                    meta=meta,
                )
            )
    db.flush()


def seed(db: Session, demo: bool) -> None:
    _seed_reference(db)
    if demo:
        _seed_demo(db)
    db.commit()
    if demo:
        from app.features.risks import hooks  # noqa: F401  (registers the search source)
        from app.services.indexing import index_object

        for rid in db.scalars(select(Risk.id)):
            index_object(db, "risk", rid, commit=False)
        db.commit()
