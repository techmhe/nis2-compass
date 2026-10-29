"""Governance seed: legal-basis tags, entity profiles, training rules and standard obligations (always);
fictional management-body members, trainings, decisions and registrations (demo only). Idempotent."""

from datetime import date, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.jurisdictions import sector_label
from app.features.governance.logic import rebuild_legal, sync_training_obligation
from app.features.governance.models import (
    BoardDecision,
    BoardMember,
    EntityProfile,
    Obligation,
    Registration,
    RegistrationChange,
    TrainingRecord,
    TrainingRule,
)
from app.models import Entity, Requirement, SearchChunk, Stakeholder

# kind, title, DE reference, NL reference, recurrence, days from today, countries
STANDARD_OBLIGATIONS = [
    (
        "policy_review",
        "Annual review of the information security policy by management",
        "IR 2024/2690 Annex 1.1.2 (benchmark); § 38(1) BSIG",
        "Cbb Art. 6; IR 2024/2690 Annex 1.1.2",
        "annual",
        60,
        ("DE", "NL"),
    ),
    (
        "measures_approval",
        "Management body approves the cybersecurity risk-management measures",
        None,
        "Cbw Art. 24(1)",
        "annual",
        45,
        ("NL",),
    ),
    (
        "oversight_review",
        "Management oversight review of the NIS-2 status report",
        "§ 38(1) BSIG",
        "Cbw Art. 24(1)",
        "quarterly",
        20,
        ("DE", "NL"),
    ),
    (
        "registration_review",
        "Review the registration data held by the authority",
        "§ 33 BSIG",
        "Cbw Art. 44; Cbb Art. 27",
        "annual",
        90,
        ("DE", "NL"),
    ),
    (
        "risk_review",
        "Annual review of the risk assessment and risk treatment plan",
        "§ 30(2) Nr. 1 BSIG; IR 2024/2690 Annex 2.1.4 (benchmark)",
        "Cbb Art. 7",
        "annual",
        120,
        ("DE", "NL"),
    ),
    (
        "bcm_test",
        "Test business continuity and crisis plans, including a backup restore test",
        "§ 30(2) Nr. 3 BSIG",
        "Cbb Art. 9",
        "annual",
        150,
        ("DE", "NL"),
    ),
    (
        "supplier_review",
        "Review the security of direct suppliers and service providers",
        "§ 30(2) Nr. 4 BSIG",
        "Cbb Art. 10",
        "annual",
        180,
        ("DE", "NL"),
    ),
    (
        "access_review",
        "Periodic review of identities, authentication means and access rights",
        "§ 30(2) Nr. 9 BSIG",
        "Cbb Art. 15(3)",
        "semiannual",
        30,
        ("DE", "NL"),
    ),
    (
        "effectiveness_review",
        "Written evaluation of the effectiveness of the risk-management measures",
        "§ 30(2) Nr. 6 BSIG",
        "Cbb Art. 18",
        "annual",
        200,
        ("DE", "NL"),
    ),
]

TRAINING_RULES = [
    {
        "jurisdiction": "DE",
        "label": "Company rule: management training within 6 months of appointment, then every 24 months",
        "is_statutory": False,
        "legal_ref": "§ 38(3) BSIG",
        "initial_months": 6,
        "count_from": date(2025, 12, 6),
        "cadence_months": 24,
        "requires_certificate": False,
        "note": "§ 38(3) BSIG requires regular training but sets no interval (BSI Handreichung). The 24-month cadence "
        "and the 6-month onboarding period are an internal company rule; counting starts no earlier than the "
        "entry into force of the NIS2UmsuCG (6 Dec 2025).",
    },
    {
        "jurisdiction": "NL",
        "label": "Training certificate within 2 years of appointment or of the Cbw entering into force",
        "is_statutory": True,
        "legal_ref": "Cbw Art. 24(3); Cbb Art. 22",
        "initial_months": 24,
        "count_from": date(2026, 8, 15),
        "cadence_months": None,
        "requires_certificate": True,
        "note": "Every board member needs a certificate stating name, dates, topics and provider, in Dutch or English "
        "(Cbb Art. 22). For members in office when the Cbw entered into force (15 Aug 2026) the deadline is "
        "15 Aug 2028.",
    },
]


def _entity_type(e: Entity) -> str | None:
    cls = {"important": "Important entity", "essential": "Essential entity"}.get(e.nis2_classification or "")
    if not cls and not e.activity_sector:
        return None
    return " – ".join(
        x for x in (cls or "Classification to be determined", sector_label(e.activity_sector)) if x
    )


def ensure_entity_reference(db: Session, entity: Entity) -> None:
    """The entity's governance reference data: profile and standard obligations, created once together.
    Idempotent, never commits.
    The profile rationale stays empty: it is the reviewer's written conclusion, not a default."""
    if db.scalar(select(EntityProfile.id).where(EntityProfile.entity_id == entity.id)):
        return  # provisioned before; obligations the user deleted must not come back on every start
    db.add(
        EntityProfile(
            entity_id=entity.id, nis2_entity_type=_entity_type(entity), ir_2024_2690_applicable=False
        )
    )
    if entity.is_active and entity.country in ("DE", "NL"):
        isb = db.scalar(select(Stakeholder.id).where(Stakeholder.name == "Information Security Officer"))
        board = db.scalar(select(Stakeholder.id).where(Stakeholder.name == "Management Board"))
        today = date.today()
        for kind, title, ref_de, ref_nl, rec, days, countries in STANDARD_OBLIGATIONS:
            if entity.country not in countries:
                continue
            owner = board if kind in ("measures_approval", "oversight_review", "policy_review") else isb
            db.add(
                Obligation(
                    entity_id=entity.id,
                    kind=kind,
                    title=title,
                    legal_ref=ref_de if entity.country == "DE" else ref_nl,
                    due_date=today + timedelta(days=days),
                    recurrence=rec,
                    owner_stakeholder_id=owner,
                    source="seed",
                )
            )
    db.flush()


def seed_reference(db: Session) -> None:
    if db.scalar(select(func.count(Requirement.id))):
        rebuild_legal(db)  # refreshes the automatic rows so changed rules reach existing installs
    if not db.scalar(select(func.count(TrainingRule.id))):
        for r in TRAINING_RULES:
            db.add(TrainingRule(**r))
    for e in db.scalars(select(Entity).order_by(Entity.sort_order, Entity.id)):
        ensure_entity_reference(db, e)
    db.flush()


# --------------------------------------------------------------------------- demo

MEMBERS = {
    "ATL": [
        ("Dr. Katrin Vogel", "Managing director (CEO)", date(2019, 4, 1)),
        ("Martin Albrecht", "Managing director (CFO)", date(2021, 1, 1)),
    ],
    "ATS": [
        ("Stefan Brandt", "Managing director", date(2020, 7, 1)),
        ("Julia Hoffmann", "Managing director (technical)", date(2026, 3, 1)),
    ],
    "ATN": [
        ("Pieter van Dijk", "Algemeen directeur", date(2018, 9, 1)),
        ("Sanne Bakker", "Financieel directeur", date(2022, 2, 1)),
    ],
    "ATC": [
        ("Ruben Jansen", "Algemeen directeur", date(2017, 5, 15)),
        ("Eva Mulder", "Commercieel directeur", date(2026, 9, 1)),
    ],
}

DE_TOPICS = [
    "Legal duties under §§ 30, 32, 38 BSIG",
    "Risk management and all-hazards approach",
    "Incident reporting (24 h / 72 h / 1 month)",
    "Liability of the management body",
]
NL_TOPICS = [
    "Cyberbeveiligingswet duties and board accountability",
    "Risk management (Cbb Art. 7)",
    "Incident reporting to the NCSC",
    "Supply-chain security",
]


def seed_demo(db: Session) -> None:
    ents = {e.code: e for e in db.scalars(select(Entity))}
    if not all(c in ents for c in MEMBERS):
        return
    if not db.scalar(select(func.count(BoardMember.id))):
        members: dict[str, BoardMember] = {}
        for code, rows in MEMBERS.items():
            for name, fn, appointed in rows:
                m = BoardMember(
                    entity_id=ents[code].id,
                    name=name,
                    function=fn,
                    appointed_at=appointed,
                    email=name.lower().replace("dr. ", "").replace(" ", ".") + "@example.com",
                )
                db.add(m)
                members[name] = m
        db.flush()

        def tr(member: str, **kw) -> None:
            m = members[member]
            db.add(
                TrainingRecord(
                    person_name=m.name,
                    person_role=m.function,
                    board_member_ids=[m.id],
                    entity_ids=[m.entity_id],
                    **kw,
                )
            )

        tr(
            "Dr. Katrin Vogel",
            title="NIS-2 for managing directors",
            provider="CyberAcademy Rhein-Main GmbH",
            delivery="external",
            training_date=date(2025, 11, 12),
            start_time=time(9, 0),
            end_time=time(13, 0),
            duration_minutes=240,
            topics=DE_TOPICS,
            legal_refs=["§ 38(3) BSIG"],
        )
        tr(
            "Martin Albrecht",
            title="Information security awareness for executives",
            provider="Internal (ISO)",
            delivery="internal",
            training_date=date(2024, 6, 20),
            start_time=time(14, 0),
            end_time=time(16, 0),
            duration_minutes=120,
            topics=["Phishing and CEO fraud", "Role of management in the ISMS"],
            legal_refs=["§ 38(3) BSIG"],
        )
        tr(
            "Julia Hoffmann",
            title="NIS-2 for managing directors",
            provider="CyberAcademy Rhein-Main GmbH",
            delivery="external",
            training_date=date(2026, 5, 14),
            start_time=time(9, 0),
            end_time=time(13, 0),
            duration_minutes=240,
            topics=DE_TOPICS,
            legal_refs=["§ 38(3) BSIG"],
        )
        tr(
            "Pieter van Dijk",
            title="Cyberweerbaarheid voor bestuurders",
            provider="Digitale Academie Utrecht B.V.",
            delivery="external",
            training_date=date(2026, 6, 10),
            start_time=time(9, 30),
            end_time=time(16, 30),
            duration_minutes=420,
            topics=NL_TOPICS,
            legal_refs=["Cbw Art. 24(2)", "Cbb Art. 22"],
            has_certificate=True,
            cert_holder_name="Pieter van Dijk",
            cert_issued_on=date(2026, 6, 10),
            cert_dates="10 June 2026",
            cert_topics="; ".join(NL_TOPICS),
            cert_provider="Digitale Academie Utrecht B.V.",
            cert_language="NL",
        )
        tr(
            "Ruben Jansen",
            title="Security awareness session (group)",
            provider="Internal (ISO)",
            delivery="internal",
            training_date=date(2026, 2, 3),
            start_time=time(10, 0),
            end_time=time(11, 30),
            duration_minutes=90,
            topics=["Phishing", "Password hygiene"],
            legal_refs=[],
            notes="No certificate issued; does not satisfy Cbw Art. 24(3).",
        )
        db.flush()
        trainings = list(db.scalars(select(TrainingRecord)))
        for m in members.values():
            sync_training_obligation(db, m, trainings)

    if not db.scalar(select(func.count(BoardDecision.id))):
        decisions = [
            (
                "BD-001",
                "ATL",
                date(2026, 1, 20),
                "approve_policy",
                "Information security policy v2.0 approved",
                "The management approved the group information security policy v2.0 and its annual review cycle.",
                "Dr. Katrin Vogel, Martin Albrecht, Isabel Schmidt (ISO)",
            ),
            (
                "BD-002",
                "ATL",
                date(2026, 7, 15),
                "oversight_review",
                "Quarterly NIS-2 status report Q2 2026 noted",
                "Status of the GAP assessment and the implementation project taken note of; the management asked for "
                "a plan to close binding gaps in chapters 14–16 by the end of the year.",
                "Dr. Katrin Vogel, Martin Albrecht, Isabel Schmidt (ISO)",
            ),
            (
                "BD-003",
                "ATS",
                date(2026, 5, 5),
                "budget",
                "Budget for EDR roll-out and MFA approved",
                "EUR 85,000 approved for EDR licences and phishing-resistant MFA in 2026/27.",
                "Stefan Brandt, Julia Hoffmann",
            ),
            (
                "BD-004",
                "ATC",
                date(2026, 8, 28),
                "accept_risk",
                "Residual risk of the legacy SCADA workstation accepted until Q1 2027",
                "Accepted until the replacement in Q1 2027 with compensating measures: network segregation and "
                "monthly log review.",
                "Ruben Jansen, Daan de Vries",
            ),
        ]
        for code, ent, on, typ, subj, desc, parts in decisions:
            db.add(
                BoardDecision(
                    code=code,
                    entity_id=ents[ent].id,
                    decided_on=on,
                    decision_type=typ,
                    subject=subj,
                    description=desc,
                    participants=parts,
                    linked=[],
                )
            )

    if not db.scalar(select(func.count(Registration.id))):
        from app.core.jurisdictions import JURISDICTIONS
        from app.features.governance.api_registry import sync_entity

        atl, ats = ents["ATL"], ents["ATS"]
        r1 = Registration(
            entity_id=atl.id,
            jurisdiction="DE",
            portal=JURISDICTIONS["DE"].portal,
            status="confirmed",
            registration_number="BSI-NIS2-2026-018342",
            submitted_at=date(2026, 2, 20),
            registered_at=atl.registration_date or date(2026, 2, 27),
            legal_name=atl.name,
            legal_form="GmbH",
            register_number="HRB 40117, Amtsgericht Musterstadt",
            address="Industriestraße 12\n34567 Musterstadt",
            entity_type=_entity_type(atl),
            contact_point="IT service desk (24/7)",
            contact_point_phone="+49 30 5550 1100",
            contact_point_email="soc@hq.example",
            contact_person="Isabel Schmidt",
            contact_person_email="isb@demo.local",
            contact_person_phone="+49 30 5550 1120",
            public_ip_ranges=["198.51.100.0/24", "203.0.113.64/27"],
            domain_names=["hq.example", "shop.hq.example"],
            sectors=[sector_label(atl.activity_sector) or "Manufacturing"],
            member_states=["DE", "NL"],
            authorities=["BSI"],
            scope_rationale="More than 250 employees; NACE C28 manufacturing of machinery (Annex 2, sector 5). "
            "Important entity under § 28(2) BSIG.",
            reviewed_at=date(2026, 2, 18),
        )
        r2 = Registration(
            entity_id=ats.id,
            jurisdiction="DE",
            portal=JURISDICTIONS["DE"].portal,
            status="submitted",
            submitted_at=date(2026, 3, 4),
            legal_name=ats.name,
            legal_form="GmbH",
            register_number="HRB 52890, Amtsgericht Musterstadt",
            address="Werkstraße 3\n34567 Musterstadt",
            entity_type=_entity_type(ats),
            contact_point="IT service desk (24/7)",
            contact_point_phone="+49 30 5550 1100",
            contact_point_email="soc@hq.example",
            contact_person="Tom Keller",
            contact_person_email="it@demo.local",
            contact_person_phone="+49 30 5550 2210",
            public_ip_ranges=["192.0.2.0/26"],
            domain_names=["subsidiary-de.example"],
            sectors=[sector_label(ats.activity_sector) or "Manufacturing"],
            member_states=["DE"],
            authorities=["BSI"],
            scope_rationale="50–249 employees and turnover above EUR 10 m; NACE C27 manufacturing of electrical "
            "equipment (Annex 2, sector 5). Important entity.",
            reviewed_at=date(2026, 3, 2),
        )
        db.add_all([r1, r2])
        db.flush()
        sync_entity(db, r1)
        sync_entity(db, r2)
        known = date.today() - timedelta(days=7)
        db.add(
            RegistrationChange(
                registration_id=r1.id,
                entity_id=atl.id,
                field="contact_point_phone",
                field_label="24/7 contact point phone",
                old_value="+49 30 5550 1000",
                new_value="+49 30 5550 1100",
                known_at=known,
                due_at=known + timedelta(days=14),
                note="New service-desk number after the telephony migration.",
            )
        )

    # a few obligation states so the calendar shows overdue and completed items
    if not db.scalar(select(func.count(Obligation.id)).where(Obligation.source == "demo")):
        today = date.today()
        for o in db.scalars(select(Obligation).where(Obligation.source == "seed")):
            code = o.entity.code if o.entity else None
            if code == "ATC" and o.kind == "measures_approval":
                o.due_date = today - timedelta(days=10)
            if code == "ATN" and o.kind == "access_review":
                o.due_date = today - timedelta(days=5)
            if code == "ATL" and o.kind == "policy_review":
                o.due_date = date(2027, 1, 20)
                db.add(
                    Obligation(
                        entity_id=o.entity_id,
                        kind=o.kind,
                        title=o.title,
                        legal_ref=o.legal_ref,
                        due_date=date(2026, 1, 31),
                        recurrence="annual",
                        status="done",
                        completed_at=date(2026, 1, 20),
                        completion_note="Decision BD-001",
                        owner_stakeholder_id=o.owner_stakeholder_id,
                        source="demo",
                    )
                )
    db.flush()


def seed(db: Session, demo: bool) -> None:
    from app.features.governance import hooks  # noqa: F401  (search sources)
    from app.services.indexing import reindex_all

    seed_reference(db)
    if demo:
        seed_demo(db)
    db.commit()
    # on a fresh database the seed runner indexes everything afterwards; only refresh our types otherwise
    if db.scalar(select(func.count(SearchChunk.id))):
        reindex_all(db, types=["board_decision", "obligation"])
