"""Reference data (questionnaire templates per tier) and demo suppliers. Idempotent."""

from datetime import date, timedelta

from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session

from app.features.suppliers.logic import add_months
from app.features.suppliers.models import (
    QuestionnaireTemplate,
    Supplier,
    SupplierAssessment,
    SupplierCertificate,
    SupplierClause,
    supplier_entities,
)
from app.features.suppliers.questionnaire import default_questions
from app.models import Entity, Stakeholder

TEMPLATE_TITLES = {
    "critical": "Supplier security questionnaire – critical suppliers",
    "high": "Supplier security questionnaire – high-tier suppliers",
    "standard": "Supplier security questionnaire – standard suppliers",
}


def seed_templates(db: Session) -> None:
    if db.scalar(select(func.count(QuestionnaireTemplate.id))):
        return
    for tier, title in TEMPLATE_TITLES.items():
        db.add(
            QuestionnaireTemplate(
                tier=tier,
                version=1,
                title=title,
                questions=default_questions(tier),
                change_note="Initial version based on IR 2024/2690 point 5.1 and ENISA "
                "supply chain good practices",
            )
        )
    db.flush()


def _d(days: int) -> date:
    return date.today() + timedelta(days=days)


# name, legal name, country, category, access, entities, services/products, owner, contacts, notes
DEMO = [
    (
        "NordIT Managed Services",
        "NordIT Managed Services B.V.",
        "NL",
        "Managed service provider",
        "it_remote",
        ["ATC", "ATN"],
        "Operation of the ATC server and virtualisation platform, backup, patching, service desk (24/7)",
        "Local IT / MSP",
        [
            {
                "name": "Service desk",
                "role": "24/7 incident line",
                "email": "servicedesk@nordit.example",
                "phone": "+31 20 555 0100",
            },
            {"name": "Sanne Bakker", "role": "Account manager", "email": "s.bakker@nordit.example"},
        ],
        "Holds domain admin rights for the ATC domain; privileged access via jump host.",
    ),
    (
        "ERPWorks Cloud",
        "ERPWorks Cloud GmbH",
        "DE",
        "Cloud ERP (SaaS)",
        "cloud_data",
        ["ATL", "ATS", "ATN", "ATC"],
        "ERP cloud tenant incl. finance, purchasing, sales and production planning modules",
        "Central IT",
        [
            {"name": "Customer success", "role": "Contract and escalation", "email": "cs@erpworks.example"},
            {"name": "Security team", "role": "Security incidents", "email": "security@erpworks.example"},
        ],
        None,
    ),
    (
        "Rhein Automation Service",
        "Rhein Automation Service GmbH",
        "DE",
        "OT maintenance",
        "ot_remote",
        ["ATL", "ATS"],
        "Maintenance and remote support of PLCs and SCADA on production lines 1 and 2",
        "OT",
        [
            {"name": "Hotline", "role": "Remote support", "phone": "+49 221 555 0200"},
            {"name": "Jonas Weber", "role": "Service manager", "email": "j.weber@rhein-automation.example"},
        ],
        "Remote maintenance via the vendor's VPN appliance in the OT DMZ.",
    ),
    (
        "Maas Industrial Controls",
        "Maas Industrial Controls B.V.",
        "NL",
        "OT maintenance",
        "ot_remote",
        ["ATN", "ATC"],
        "PLC programming and remote maintenance of packaging and production lines",
        "Local Contact",
        [
            {
                "name": "Pieter de Jong",
                "role": "Field service lead",
                "email": "p.dejong@maas-ic.example",
                "phone": "+31 10 555 0300",
            }
        ],
        None,
    ),
    (
        "Unitel Carrier Services",
        "Unitel Carrier Services AG",
        "DE",
        "Telecommunications",
        "none",
        ["ATL", "ATS", "ATN", "ATC"],
        "MPLS WAN between all sites, internet breakout, SIP trunks",
        "Central IT",
        [
            {
                "name": "Network operations centre",
                "role": "Fault reporting",
                "email": "noc@unitel.example",
                "phone": "+49 69 555 0400",
            }
        ],
        None,
    ),
    (
        "SafeVault Backup",
        "SafeVault Backup GmbH",
        "DE",
        "Backup as a service",
        "cloud_data",
        ["ATL", "ATS"],
        "Offsite immutable backup vault for HQ and ATS, restore support",
        "Central IT",
        [{"name": "Support", "role": "Restore requests", "email": "support@safevault.example"}],
        None,
    ),
    (
        "Microsoft 365",
        "Microsoft Ireland Operations Limited",
        "IE",
        "Cloud collaboration (SaaS)",
        "cloud_data",
        ["ATL", "ATS", "ATN", "ATC"],
        "Exchange Online, Teams, SharePoint Online, Entra ID",
        "Central IT",
        [{"name": "Microsoft support", "role": "Tenant support via admin portal"}],
        None,
    ),
    (
        "LogiShip Carrier Portal",
        "LogiShip Carrier Portal GmbH",
        "DE",
        "Logistics software (SaaS)",
        "cloud_data",
        ["ATL", "ATS"],
        "Shipping label and carrier booking portal, interface to ERP",
        "IT Procurement",
        [{"name": "Support", "role": "Helpdesk", "email": "help@logiship.example"}],
        None,
    ),
    (
        "SecureDesk Helpdesk Services",
        "SecureDesk Helpdesk Services GmbH",
        "DE",
        "IT service desk",
        "it_remote",
        ["ATL", "ATS"],
        "First-level IT service desk incl. password resets and client remote support",
        "Central IT",
        [{"name": "Team lead", "role": "Operations", "email": "ops@securedesk.example"}],
        None,
    ),
    (
        "PrintFleet Managed Print",
        "PrintFleet Managed Print B.V.",
        "NL",
        "Managed print",
        "it_remote",
        ["ATS", "ATN"],
        "Managed print service incl. label printers in shipping",
        "IT Procurement",
        [{"name": "Service", "role": "Printer service", "email": "service@printfleet.example"}],
        None,
    ),
    (
        "Facility Power Services",
        "Facility Power Services GmbH",
        "DE",
        "Facility maintenance",
        "none",
        ["ATL"],
        "Maintenance of UPS, emergency generator and server room cooling at HQ",
        "Central IT",
        [{"name": "Emergency line", "role": "24/7", "phone": "+49 40 555 0500"}],
        None,
    ),
    (
        "DataShred Secure Disposal",
        "DataShred Secure Disposal B.V.",
        "NL",
        "Media disposal",
        "none",
        ["ATN", "ATC"],
        "Certified destruction of hard disks and paper records",
        "Local Contact",
        [{"name": "Planning", "role": "Pick-up scheduling", "email": "planning@datashred.example"}],
        None,
    ),
    (
        "OldCAD Software",
        "OldCAD Software Ltd",
        "GB",
        "Engineering software",
        "none",
        ["ATL"],
        "Legacy CAD licences (replaced in 2025)",
        "IT Procurement",
        [],
        "Contract terminated 31 Dec 2025.",
    ),
]

# clause statuses a..h per supplier name
CLAUSES = {
    "NordIT Managed Services": "apmaaapp",
    "ERPWorks Cloud": "aaaaaaaa",
    "Rhein Automation Service": "ppmmpmmp",
    "Maas Industrial Controls": "pmmpmmmm",
    "Unitel Carrier Services": "aapaanpa",
    "SafeVault Backup": "aaaaapaa",
    "Microsoft 365": "aaaaaaaa",
    "LogiShip Carrier Portal": "apmamppa",
    "SecureDesk Helpdesk Services": "aaaapaaa",
    "PrintFleet Managed Print": "ammpmmmp",
    "Facility Power Services": "annannnp",
    "DataShred Secure Disposal": "aapnannn",
}
_ST = {"a": "agreed", "p": "partial", "m": "missing", "n": "na"}

CERTS = {
    "NordIT Managed Services": [
        ("ISO/IEC 27001", "Managed IT services, data centre operations Amsterdam", 240)
    ],
    "ERPWorks Cloud": [
        ("ISO/IEC 27001", "Development and operation of the ERPWorks cloud platform", 420),
        ("BSI C5", "C5 Type 2 attestation, ERPWorks cloud", 150),
        ("SOC 2 Type II", "Security and availability", 95),
    ],
    "Rhein Automation Service": [("IEC 62443", "IEC 62443-2-4 service provider capability", 30)],
    "SafeVault Backup": [("ISO/IEC 27001", "Backup and archiving services", -20)],
    "Microsoft 365": [
        ("ISO/IEC 27001", "Microsoft 365 services", 300),
        ("ISO/IEC 27018", "Microsoft 365", 300),
    ],
    "SecureDesk Helpdesk Services": [("ISO/IEC 27001", "Service desk operations", 510)],
    "Unitel Carrier Services": [("ISO/IEC 27001", "Network operations centre and MPLS services", 45)],
    "LogiShip Carrier Portal": [("TISAX", "AL2, information with high protection need", 200)],
}

# supplier -> (days ago, method, score, rating, summary, findings, months to next review)
ASSESSMENTS = {
    "NordIT Managed Services": [
        (
            -350,
            "questionnaire",
            72.0,
            "conditional",
            "Annual questionnaire for critical suppliers. Privileged access and backup scope "
            "need improvement.",
            [
                ("Privileged accounts of MSP staff are shared between technicians", "high"),
                ("Backup restore tests are not documented for ATC systems", "medium"),
            ],
            12,
        )
    ],
    "ERPWorks Cloud": [
        (
            -210,
            "certificate_review",
            88.0,
            "acceptable",
            "Review of ISO 27001 certificate, C5 attestation and SOC 2 report; no qualified opinions.",
            [],
            24,
        )
    ],
    "Rhein Automation Service": [
        (
            -770,
            "on_site",
            65.0,
            "conditional",
            "On-site visit at the service centre; remote maintenance process reviewed.",
            [
                ("Remote sessions are not recorded", "medium"),
                ("Technician accounts are not personalised on the vendor VPN appliance", "high"),
            ],
            12,
        )
    ],
    "SafeVault Backup": [
        (
            -500,
            "audit",
            81.0,
            "acceptable",
            "Remote audit of the backup service; immutability and encryption verified.",
            [("Restore SLA for full-site restore not defined", "low")],
            24,
        )
    ],
    "Microsoft 365": [
        (
            -250,
            "certificate_review",
            90.0,
            "acceptable",
            "Review of certificates and the service trust portal reports.",
            [],
            24,
        )
    ],
    "SecureDesk Helpdesk Services": [
        (
            -400,
            "questionnaire",
            84.0,
            "acceptable",
            "Questionnaire for high-tier suppliers.",
            [("Background checks only for new employees since 2024", "low")],
            24,
        )
    ],
    "Facility Power Services": [
        (-900, "questionnaire", 70.0, "conditional", "Standard questionnaire.", [], 36)
    ],
}


def seed_demo_suppliers(db: Session) -> None:
    if db.scalar(select(func.count(Supplier.id))):
        return
    ents = {e.code: e.id for e in db.scalars(select(Entity))}
    sts = {s.name: s.id for s in db.scalars(select(Stakeholder))}
    for n, (name, legal, country, cat, access, ent_codes, products, owner, contacts, notes) in enumerate(
        DEMO, 1
    ):
        s = Supplier(
            code=f"SUP-{n:03d}",
            name=name,
            legal_name=legal,
            country=country,
            category=cat,
            access_type=access,
            services_products=products,
            relationship_owner_id=sts.get(owner),
            contacts=contacts,
            notes=notes,
            status="active",
            contract_reference=f"C-{2020 + n % 6}-{100 + n}",
        )
        if name == "PrintFleet Managed Print":
            s.status = "onboarding"
            s.tier, s.tier_overridden = "standard", True
            s.tier_rationale = (
                "Printers sit in an isolated print VLAN; the provider has no access to production "
                "or business data."
            )
        if name == "OldCAD Software":
            s.status = "offboarded"
            s.contract_end = date(2025, 12, 31)
        db.add(s)
        db.flush()
        ids = [ents[c] for c in ent_codes if c in ents]
        if ids:
            db.execute(insert(supplier_entities), [{"supplier_id": s.id, "entity_id": e} for e in ids])
        for i, st in enumerate(CLAUSES.get(name, "")):
            db.add(
                SupplierClause(
                    supplier_id=s.id,
                    clause="abcdefgh"[i],
                    status=_ST[st],
                    reference=f"MSA § {10 + i}" if st in "ap" else None,
                )
            )
        for cert_type, scope, days in CERTS.get(name, []):
            db.add(
                SupplierCertificate(
                    supplier_id=s.id,
                    cert_type=cert_type,
                    scope=scope,
                    valid_until=_d(days),
                    issuer="Accredited certification body",
                )
            )
        for days, method, score, rating, summary, findings, months in ASSESSMENTS.get(name, []):
            on = _d(days)
            db.add(
                SupplierAssessment(
                    supplier_id=s.id,
                    assessed_on=on,
                    method=method,
                    score=score,
                    rating=rating,
                    summary=summary,
                    answers=[],
                    next_due=add_months(on, months),
                    findings=[{"text": t, "severity": sev, "action_item_id": None} for t, sev in findings],
                )
            )
    db.flush()


INTRAGROUP_CATEGORY = "Intra-group IT service"


def seed_intragroup_demo(db: Session) -> None:
    """HQ Central IT as internal provider for the subsidiaries without an own IT department (demo)."""
    if db.scalar(select(func.count(Supplier.id)).where(Supplier.category == INTRAGROUP_CATEGORY)):
        return
    hq = db.scalar(select(Entity).where(Entity.is_headquarters.is_(True)))
    if not hq:
        return
    codes = [c for c in db.scalars(select(Supplier.code)) if c.startswith("SUP-") and c[4:].isdigit()]
    n = max([int(c[4:]) for c in codes] or [0]) + 1
    s = Supplier(
        code=f"SUP-{n:03d}",
        name=f"{hq.name} – Central IT",
        legal_name=hq.name,
        country=hq.country,
        category=INTRAGROUP_CATEGORY,
        access_type="it_remote",
        status="active",
        services_products="Operation of identity, network, endpoint protection, backup and service desk for "
        "the subsidiaries (intra-group IT service agreement)",
        contract_reference="Intra-group IT service agreement 2026",
        notes="The subsidiaries have no IT department of their own; the controls scoped 'Central at HQ' are "
        "operated under this agreement.",
    )
    db.add(s)
    db.flush()
    subs = [
        e.id
        for e in db.scalars(select(Entity).where(Entity.is_headquarters.is_(False), Entity.code != "ATC"))
    ]
    if subs:
        db.execute(insert(supplier_entities), [{"supplier_id": s.id, "entity_id": e} for e in subs])
    for i, st in enumerate("aaapappa"):
        db.add(
            SupplierClause(
                supplier_id=s.id,
                clause="abcdefgh"[i],
                status=_ST[st],
                reference=f"Service agreement § {i + 3}" if st in "ap" else None,
            )
        )


def seed(db: Session, demo: bool) -> None:
    import app.features.suppliers.hooks  # noqa: F401
    from app.services.indexing import index_object

    seed_templates(db)
    if demo:
        had = db.scalar(select(func.count(Supplier.id)))
        seed_demo_suppliers(db)
        seed_intragroup_demo(db)
        if not had:
            for sid in db.scalars(select(Supplier.id)):
                index_object(db, "supplier", sid, commit=False)
    db.commit()
