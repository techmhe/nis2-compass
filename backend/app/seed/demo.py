"""Demo data for testing environments: users per role, partially filled assessments, documents, work packages
and tasks. Never run this in production (the seeder refuses when NIS2_ENV=production)."""

import random
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.jurisdictions import get_jurisdiction
from app.core.security import hash_password
from app.models import (
    ActionItem,
    Answer,
    Assessment,
    Document,
    DocumentLink,
    DocumentVersion,
    Entity,
    Incident,
    Project,
    Requirement,
    Role,
    RoleAssignment,
    Stakeholder,
    Task,
    User,
    WorkPackage,
)
from app.services import storage
from app.services.entities import provision_entity
from app.services.extract import extract_text
from app.services.project_setup import create_default_project
from app.services.scoring import recalc

DEMO_PASSWORD = "Demo-Password-2026!"

USERS = [
    (
        "isb@demo.local",
        "Isabel Schmidt",
        "Information Security Officer",
        "security_officer",
        None,
        "Information Security Officer",
    ),
    ("pm@demo.local", "Paul Meyer", "Project Manager", "project_manager", None, None),
    ("assessor@demo.local", "Anna Berger", "External Assessor", "assessor", None, "German External Adviser"),
    ("it@demo.local", "Tom Keller", "IT Coordinator", "contributor", None, "IT Coordinator"),
    (
        "nl.contact@demo.local",
        "Daan de Vries",
        "Local Contact NL",
        "contributor",
        ["ATN", "ATC"],
        "Local Contact",
    ),
    ("viewer@demo.local", "Victoria Lang", "Management Board Assistant", "viewer", None, None),
    ("auditor@demo.local", "Otto Richter", "Internal Auditor", "auditor", None, None),
]

DEMO_ENTITIES: list[dict] = [
    {
        "code": "ATL",
        "name": "Atlas Fertigung GmbH",
        "country": "DE",
        "is_headquarters": True,
        "legal_form": "GmbH",
        "size_class": "large",
        "activity_sector": "manufacturing_machinery",
        "nis2_classification": "important",
    },
    {
        "code": "ATS",
        "name": "Atlas Service GmbH",
        "country": "DE",
        "is_headquarters": False,
        "legal_form": "GmbH",
        "size_class": "medium",
        "activity_sector": "manufacturing_electrical_equipment",
        "nis2_classification": "important",
    },
    {
        "code": "ATN",
        "name": "Atlas Nederland B.V.",
        "country": "NL",
        "is_headquarters": False,
        "legal_form": "B.V.",
        "size_class": "medium",
        "activity_sector": "manufacturing_machinery",
        "nis2_classification": "important",
    },
    {
        "code": "ATC",
        "name": "Atlas Chemie B.V.",
        "country": "NL",
        "is_headquarters": False,
        "legal_form": "B.V.",
        "size_class": "small",
        "activity_sector": "chemicals",
        "nis2_classification": "tbd",
    },
]

DOCS = [
    (
        "Information Security Policy",
        "Policy",
        "Approved",
        None,
        ["policy", "isms", "governance"],
        """
# Information Security Policy (Group)

Version 2.1 – approved by the Management Board on 2026-03-12. Owner: Information Security Officer (ISO).

## 1 Purpose and scope
This policy sets out the group's approach to managing the security of network and information systems for all
legal entities (Atlas Fertigung GmbH, Atlas Service GmbH, Atlas Nederland B.V. and Atlas Chemie B.V.). It supports the business strategy
of reliable production and delivery to customers.

## 2 Objectives
- Availability of production-critical systems of at least 99.5 % per year.
- All significant incidents reported to the competent authority within the legal deadlines (24 h / 72 h / 1 month).
- 100 % of employees complete security awareness training every year.

## 3 Roles and responsibilities
The Management Board is accountable for approving risk-management measures and supervises their implementation
(§ 38 BSIG). The Information Security Officer reports directly to the Management Board at least quarterly.
Central IT at HQ operates identity, network, backup and endpoint protection for HQ, Atlas Service GmbH and
Atlas Nederland B.V.. Atlas Chemie B.V. is operated by a managed service provider (MSP).

## 4 Commitments
The group commits to continual improvement and to provide the staff, budget, processes and tools needed.
This policy is communicated to all employees and acknowledged via the intranet. It is reviewed at least annually
and after significant incidents or significant changes.

## 5 Topic-specific policies
Access Control Policy, Incident Response Procedure, Backup and Recovery Guideline, Supplier Security Guideline,
Cryptography Guideline (planned), Business Continuity Plan.

## 6 Documentation retention
Security-relevant records (incident records, risk assessments, audit reports) are retained for 6 years.
""",
    ),
    (
        "Access Control Policy",
        "Policy",
        "Approved",
        None,
        ["access control", "mfa", "identity"],
        """
# Access Control Policy

Approved 2026-04-02. Owner: IT Coordinator.

- Access rights follow the need-to-know and least-privilege principles.
- Multi-factor authentication (MFA) is mandatory for all remote access, all cloud services (Microsoft 365) and all
  privileged accounts. Exceptions require written approval by the ISO and are reviewed every 6 months.
- Passwords have a minimum length of 14 characters; no periodic rotation unless compromise is suspected.
- Privileged accounts are separate personal admin accounts; shared admin accounts are prohibited.
- Access rights are reviewed quarterly by the line managers; privileged rights monthly by Central IT.
- Leavers are disabled on the last working day through the HR joiner/mover/leaver process.
- Remote access for suppliers and maintenance providers (including OT) is granted time-limited via the
  jump host and is logged.
""",
    ),
    (
        "Incident Response Procedure",
        "Procedure",
        "In Review",
        None,
        ["incident", "reporting", "bsig", "csirt"],
        """
# Incident Response and Reporting Procedure

Draft 0.9 – in review. Owner: Information Security Officer.

## Detection and classification
Security events are raised via the service desk (+49 30 1234567, 24/7 hotline) or the SIEM. The on-call IT lead
classifies incidents as Low / Medium / High / Critical. An incident is "significant" if it caused or can cause
severe operational disruption or financial loss, or affects other persons with considerable damage.

## Reporting to authorities
Germany (Atlas Fertigung GmbH, Atlas Service GmbH): reports go to the BSI via the BSI reporting portal.
- Early warning within 24 hours of becoming aware of a significant incident.
- Incident notification within 72 hours with an initial assessment of severity, impact and indicators of compromise.
- Final report within one month; progress report if the incident is still ongoing.
Netherlands (Atlas Nederland B.V. and Atlas Chemie B.V.): reports go to the CSIRT designated under the Cyberbeveiligingswet
and the sector supervisor, within the same 24 h / 72 h / 1 month deadlines.
Authorised to submit notifications outside office hours: ISO and the deputy (IT Coordinator).

## Lessons learned
A post-incident review is held within 10 working days for every High or Critical incident.
""",
    ),
    (
        "Backup and Recovery Guideline",
        "Guideline",
        "Approved",
        None,
        ["backup", "recovery", "bcm"],
        """
# Backup and Recovery Guideline

- 3-2-1 principle: three copies, two media types, one copy offline/immutable.
- Daily incremental and weekly full backups of all servers; Microsoft 365 is backed up with a third-party service.
- Backups are encrypted (AES-256) and stored in a separate network segment.
- Restore tests are performed semi-annually for critical systems (ERP, file services, MES) and documented.
- Recovery time objective for ERP: 24 hours; recovery point objective: 24 hours.
""",
    ),
    (
        "Supplier Security Guideline",
        "Guideline",
        "Draft",
        None,
        ["supplier", "supply chain", "msp"],
        """
# Supplier Security Guideline (draft)

- Suppliers are classified by criticality (A = critical ICT/OT service provider, B = important, C = other).
- Class A suppliers must sign the information security annex (incident notification within 24 hours, right to
  audit, MFA for remote access, subcontractor approval).
- The MSP for Atlas Chemie B.V. is a class A supplier; its security is reviewed annually.
- A supplier register with security ratings is maintained by IT Procurement.
""",
    ),
    (
        "Business Continuity Plan HQ",
        "Concept",
        "Approved",
        "ATL",
        ["bcm", "continuity", "crisis"],
        """
# Business Continuity Plan – Atlas Fertigung GmbH

Crisis team: Managing Director (lead), ISO, IT Coordinator, Head of Production, Communications.
Alerting via the emergency call tree; crisis room in building B.
Critical processes: order processing (ERP), production control (MES/OT), shipping.
Emergency operation: manual order acceptance for up to 3 days; production continues in island mode.
The plan is tested annually with a tabletop exercise (last exercise: 2026-05-20, ransomware scenario).
""",
    ),
    (
        "Beleid informatiebeveiliging NL",
        "Policy",
        "Draft",
        "ATN",
        ["policy", "cbw", "nl"],
        """
# Informatiebeveiligingsbeleid – Atlas Nederland B.V. (concept)

Dit beleid vertaalt het groepsbeleid naar de Nederlandse context (Cyberbeveiligingswet, Cyberbeveiligingsbesluit).
De bestuurders volgen uiterlijk 15 augustus 2028 een erkende cybersecuritytraining.
Incidenten worden gemeld via het meldpunt van het aangewezen CSIRT binnen 24 uur (vroegtijdige waarschuwing).
""",
    ),
]

WPS = [
    (
        "Group incident reporting procedure and authority channels (DE/NL)",
        "Incident Handling and Reporting",
        "High",
        ["14.1", "14.2", "14.3", "14.4"],
        None,
    ),
    (
        "Roll out MFA for remaining remote and privileged access",
        "Access Control",
        "High",
        ["11.7.1", "11.7.2"],
        None,
    ),
    (
        "Supplier security annex and supplier register",
        "Supplier and MSP Governance",
        "Medium",
        ["5.1.1", "5.1.2"],
        None,
    ),
    ("Registration of NL entities under the Cbw", "Governance", "High", ["15.1"], "ATN"),
]


def seed_demo_entities(db: Session) -> dict[str, Entity]:
    """Create the invented Atlas group through the same provisioning path as the setup; idempotent by code.
    Needs the base seed's open assessment round, so every entity gets its assessment."""
    ents: dict[str, Entity] = {}
    for i, spec in enumerate(DEMO_ENTITIES):
        ent = db.scalar(select(Entity).where(Entity.code == spec["code"]))
        if not ent:
            jur = get_jurisdiction(spec["country"])
            ent = Entity(
                finding_prefix=spec["code"],
                sort_order=i,
                competent_authority=jur.competent_authority if jur else None,
                csirt=jur.csirt if jur else None,
                **spec,
            )
            db.add(ent)
            provision_entity(db, ent)
        ents[ent.code] = ent
    atl, ats = ents.get("ATL"), ents.get("ATS")
    if atl and not atl.registration_status:
        atl.registration_status = "confirmed"
        atl.registration_date = date(2026, 2, 27)
    if ats and not ats.registration_status:
        ats.registration_status = "submitted"
    db.flush()
    return ents


def seed_demo(db: Session) -> None:
    if get_settings().is_production:
        raise RuntimeError("Refusing to load demo data in production")
    ents = seed_demo_entities(db)
    if not db.scalar(select(func.count(Project.id))):
        create_default_project(db, list(ents.values()))
    if db.scalar(select(func.count(User.id)).where(User.email.like("%@demo.local"))):
        db.commit()
        return
    rnd = random.Random(42)
    roles = {r.key: r for r in db.scalars(select(Role))}
    users = {}
    for email, name, title, role, scope, st_name in USERS:
        u = User(email=email, display_name=name, job_title=title, password_hash=hash_password(DEMO_PASSWORD))
        db.add(u)
        db.flush()
        for ecode in scope or [None]:
            db.add(
                RoleAssignment(
                    user_id=u.id, role_id=roles[role].id, entity_id=ents[ecode].id if ecode else None
                )
            )
        if st_name:
            st = db.scalar(select(Stakeholder).where(Stakeholder.name == st_name))
            if st and not st.user_id:
                st.user_id = u.id
        users[email] = u
    db.flush()

    stakeholders = list(db.scalars(select(Stakeholder)))
    fill = {"ATL": 1.0, "ATS": 0.55, "ATN": 0.25, "ATC": 0.0}
    impl_w = ["Yes"] * 5 + ["Partial"] * 4 + ["No"] * 2 + ["N/A"]
    eff_w = ["Effective"] * 3 + ["Partial"] * 3 + ["Not Tested"] * 4 + ["Ineffective"]
    today = date.today()
    for asm in db.scalars(select(Assessment)):
        share = fill.get(asm.entity.code, 0)
        if share == 0:
            continue
        asm.status = "completed" if share >= 1 else "in_progress"
        asm.assessment_date = today - timedelta(days=rnd.randint(3, 20))
        asm.respondents = "IT Coordinator; Central IT; Local Contact"
        asm.assessors = "Isabel Schmidt (ISO); Anna Berger (external)"
        asm.lead_user_id = users["isb@demo.local"].id
        answers = list(db.scalars(select(Answer).where(Answer.assessment_id == asm.id)))
        answers.sort(key=lambda a: a.requirement.sort_order)
        n = int(len(answers) * share)
        for a in answers[:n]:
            if asm.entity.code != "ATL" and rnd.random() < 0.18 and a.requirement.chapter.number <= 13:
                a.scope = "Central at HQ"
                a.evidence = "Control operated centrally by HQ Central IT."
            else:
                a.implemented = rnd.choice(impl_w)
                a.documented = rnd.choice(impl_w)
                a.effectiveness = rnd.choice(eff_w)
                a.evidence = rnd.choice(
                    [
                        "Interview IT Coordinator",
                        "Policy document reviewed",
                        "Screenshot of configuration",
                        "Ticket sample reviewed",
                        "Observed practice",
                        "SIEM report Q2",
                    ]
                )
                a.responsible_id = rnd.choice(stakeholders).id
                recalc(a, asm.entity.finding_prefix)
                if a.wp_required:
                    a.gap_description = rnd.choice(
                        [
                            "Practice exists but is not documented in a procedure.",
                            "Only partially implemented for HQ systems; subsidiaries not covered.",
                            "No evidence of effectiveness testing available.",
                            "Process depends on a single person; no deputy defined.",
                        ]
                    )
                    a.recommended_action = rnd.choice(
                        [
                            "Document the procedure and have it approved by the ISO.",
                            "Extend the control to all entities via Central IT.",
                            "Plan and perform an effectiveness test; record results.",
                            "Define a deputy and train them.",
                        ]
                    )
                    a.target_date = today + timedelta(days=rnd.randint(20, 240))
                    a.effort = rnd.choice(["Low", "Medium", "High"])
            recalc(a, asm.entity.finding_prefix)
    db.flush()

    # action plan items from some ATL findings
    next_no = (db.scalar(select(func.count(ActionItem.id))) or 0) + 1
    pg_findings = db.scalars(
        select(Answer)
        .join(Assessment)
        .where(Assessment.entity_id == ents["ATL"].id, Answer.wp_required.is_(True))
    ).all()
    new_items = []
    for a in pg_findings[:14]:
        item = ActionItem(
            code=f"AP-{next_no:03d}",
            round_id=a.assessment.round_id,
            entity_id=ents["ATL"].id,
            requirement_id=a.requirement_id,
            title=a.recommended_action or "Close gap",
            priority=rnd.choice(["High", "Medium", "Low"]),
            responsible_id=a.responsible_id,
            target_date=today + timedelta(days=rnd.randint(-20, 150)),
            status=rnd.choice(["Not Started", "In Progress", "In Progress", "Completed"]),
            acceptance_criterion="Measure implemented and evidence reviewed by ISO",
            expected_evidence="Approved document / configuration export",
        )
        db.add(item)
        new_items.append(item)
        next_no += 1
    db.flush()

    # documents
    admin_user = users["isb@demo.local"]
    docs = {}
    for title, dtype, status, ecode, tags, body in DOCS:
        data = body.strip().encode()
        key, sha = storage.store(data)
        fname = title.lower().replace(" ", "-") + ".md"
        text, pages, st = extract_text(fname, data)
        d = Document(
            title=title,
            doc_type=dtype,
            status=status,
            classification="Internal",
            entity_id=ents[ecode].id if ecode else None,
            owner_id=admin_user.id,
            tags=tags,
            version_label="1.0",
            created_by_id=admin_user.id,
            next_review_date=today + timedelta(days=rnd.randint(-10, 300)),
            approved_at=today - timedelta(days=100) if status == "Approved" else None,
            approved_by="Management Board" if status == "Approved" else None,
        )
        db.add(d)
        db.flush()
        v = DocumentVersion(
            document_id=d.id,
            version_no=1,
            filename=fname,
            storage_key=key,
            mime_type="text/markdown",
            size=len(data),
            sha256=sha,
            extracted_text=text,
            extraction_status=st,
            uploaded_by_id=admin_user.id,
        )
        db.add(v)
        db.flush()
        d.current_version_id = v.id
        docs[title] = d
    reqs = {r.number: r for r in db.scalars(select(Requirement))}
    for title, numbers in [
        ("Information Security Policy", ["1.1.1", "1.1.2", "1.2.1"]),
        ("Access Control Policy", ["11.1.1", "11.7.1"]),
        ("Incident Response Procedure", ["3.1.1", "14.1", "14.2", "14.3", "14.4"]),
        ("Backup and Recovery Guideline", ["4.2.1"]),
        ("Supplier Security Guideline", ["5.1.1"]),
        ("Business Continuity Plan HQ", ["4.1.1"]),
    ]:
        for num in numbers:
            if num in reqs:
                db.add(
                    DocumentLink(
                        document_id=docs[title].id, target_type="requirement", target_id=reqs[num].id
                    )
                )

    # work packages + tasks
    project = db.scalar(select(Project))
    wp_count = db.scalar(select(func.count(WorkPackage.id))) or 0
    task_no = 1
    assignees = [
        users[e] for e in ("isb@demo.local", "it@demo.local", "nl.contact@demo.local", "pm@demo.local")
    ]
    for i, (title, area, prio, numbers, ecode) in enumerate(WPS, wp_count + 1):
        wp = WorkPackage(
            project_id=project.id,
            code=f"WP-{i:03d}",
            title=title,
            measure_area=area,
            priority=prio,
            entity_id=ents[ecode].id if ecode else None,
            central_or_local="Local" if ecode else "Central",
            owner_id=assignees[i % len(assignees)].id,
            planned_start=today - timedelta(days=10),
            planned_finish=today + timedelta(days=60 + 20 * i),
            status="In Progress",
            acceptance_criterion="All linked findings closed with reviewed evidence",
            expected_evidence="Approved documents, configuration exports, test records",
        )
        wp.findings = [it for it in db.scalars(select(ActionItem)) if it.requirement.number in numbers]
        db.add(wp)
        db.flush()
        for j, (ttitle, status) in enumerate(
            [
                ("Draft deliverable", "done"),
                ("Review with stakeholders", "in_progress"),
                ("Management approval", "todo"),
                ("Roll-out and evidence", "todo"),
            ]
        ):
            db.add(
                Task(
                    key=f"T-{task_no}",
                    title=f"{ttitle}: {title[:60]}",
                    status=status,
                    priority=prio,
                    assignee_id=assignees[(i + j) % len(assignees)].id,
                    reporter_id=users["pm@demo.local"].id,
                    project_id=project.id,
                    work_package_id=wp.id,
                    entity_id=wp.entity_id,
                    due_date=today + timedelta(days=rnd.randint(-5, 45)),
                    checklist=[
                        {"text": "Collect input", "done": True},
                        {"text": "Update document", "done": False},
                    ],
                    sort_order=j,
                )
            )
            task_no += 1
    # evidence request tasks
    for a in pg_findings[:3]:
        db.add(
            Task(
                key=f"T-{task_no}",
                title=f"Provide evidence for {a.requirement.number}",
                description=f"Please upload evidence for requirement {a.requirement.number}: {a.requirement.section}",
                status="todo",
                priority="Medium",
                assignee_id=users["it@demo.local"].id,
                reporter_id=admin_user.id,
                answer_id=a.id,
                entity_id=ents["ATL"].id,
                due_date=today + timedelta(days=7),
            )
        )
        task_no += 1

    db.add(
        Incident(
            code="INC-001",
            entity_id=ents["ATL"].id,
            title="Phishing campaign with credential theft",
            description="Several employees entered credentials on a fake Microsoft 365 login page.",
            category="Phishing",
            severity="Medium",
            status="Resolved",
            is_significant=False,
            significance_rationale="No service disruption, accounts reset within 2 hours.",
            detected_at=None,
            aware_at=None,
            measures="Passwords reset, MFA enforced, awareness mail.",
        )
    )
    db.commit()
    print(f"demo data loaded; demo users use password: {DEMO_PASSWORD}")
