"""Demo data for the threats module (advisories and vulnerabilities). Idempotent: does nothing when advisories
already exist. Only demo data is seeded here; the module has no group-level reference catalogue of its own."""

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import app.features.threats.hooks  # noqa: F401  (search sources for indexing)
from app.db import utcnow
from app.features.inventory.models import Asset
from app.features.threats.api import default_assessment_due, default_remediation_due
from app.features.threats.models import Advisory, Vulnerability
from app.models import Entity, User
from app.services.indexing import index_object


def _seed_kpis(db: Session) -> None:
    """Catalogue entries for the two computed KPIs of this module (added to the shared KPI catalogue,
    independent of demo seeding, mirroring how the controls module seeds its own KPI catalogue)."""
    from app.features.controls.kpi import ensure_instances
    from app.features.controls.models import MetricDefinition
    from app.features.threats.kpi import CRIT_REMEDIATION_KEY, OPEN_HIGH_CRIT_KEY

    defs = [
        (
            "VULN-OPEN-CH",
            "Open critical/high vulnerabilities",
            "count",
            "lower",
            "Critical or high vulnerabilities still open at period end.",
            "IR 6.10; Cbb Art. 17",
            0,
            "monthly",
            OPEN_HIGH_CRIT_KEY,
        ),
        (
            "VULN-MTTR-CRIT",
            "Critical vulnerability remediation time",
            "days",
            "lower",
            "Median days from discovery to remediation for critical vulnerabilities remediated in the period.",
            "IR 6.10",
            7,
            "monthly",
            CRIT_REMEDIATION_KEY,
        ),
    ]
    changed = False
    for code, name, unit, direction, desc, legal, target, freq, comp in defs:
        if db.scalar(select(MetricDefinition.id).where(MetricDefinition.code == code)):
            continue
        d = MetricDefinition(
            code=code,
            name=name,
            unit=unit,
            direction=direction,
            description=desc,
            legal_refs=legal,
            default_target=target,
            frequency=freq,
            computation=comp,
            active=True,
            sort_order=900,
        )
        db.add(d)
        db.flush()
        ensure_instances(db, d)
        changed = True
    if changed:
        db.commit()


def seed(db: Session, demo: bool) -> None:
    _seed_kpis(db)
    if not demo or db.scalar(select(func.count(Advisory.id))):
        return
    today = utcnow().date()
    ents = {e.code: e.id for e in db.scalars(select(Entity))}
    users = {u.email: u.id for u in db.scalars(select(User))}
    assets = {a.name: a for a in db.scalars(select(Asset).order_by(Asset.id))}
    isb, it, nl = users.get("isb@demo.local"), users.get("it@demo.local"), users.get("nl.contact@demo.local")
    fw = next((a for n, a in assets.items() if "Firewall" in n), None)
    plc = next((a for n, a in assets.items() if "PLC" in n), None)

    # --- advisories -----------------------------------------------------------------------------------------
    adv1 = Advisory(
        code="ADV-0001",
        title="Critical remote code execution in perimeter firewall OS",
        source="BSI",
        reference="BSI CSW-2026-0142",
        received_on=today - timedelta(days=10),
        severity="critical",
        summary="Unauthenticated RCE in the management interface of the firewall OS; vendor advisory recommends "
        "immediate patching or disabling remote management.",
        entity_scope="all",
        created_by_id=it,
        relevant="yes",
        measures_need_adjustment="yes",
        rationale="Firewall cluster HQ runs the affected version. Patched out of band; remote management "
        "restricted to the jump host as a compensating measure in the meantime.",
        assessed_by_id=isb,
        assessed_on=today - timedelta(days=9),
        status="assessed",
        assessment_due=default_assessment_due(today - timedelta(days=10), "critical"),
    )
    db.add(adv1)
    db.flush()
    if fw:
        adv1.assets = [fw]

    adv2 = Advisory(
        code="ADV-0002",
        title="High-severity vulnerability in warehouse management SaaS platform",
        source="NCSC-NL",
        reference="NCSC-2026-0311",
        received_on=today - timedelta(days=3),
        severity="high",
        summary="Supplier disclosed a privilege-escalation vulnerability affecting multi-tenant warehouse "
        "management accounts; patch rollout in progress on the vendor side.",
        entity_scope="list",
        entity_ids=[ents[c] for c in ("ATN", "ATC") if c in ents],
        created_by_id=nl,
        assessed_by_id=nl,
        status="in_assessment",
        assessment_due=default_assessment_due(today - timedelta(days=3), "high"),
    )
    db.add(adv2)
    db.flush()

    adv3 = Advisory(
        code="ADV-0003",
        title="Medium-severity denial-of-service issue in a network switch model",
        source="vendor_psirt",
        reference="VendorPSIRT-2026-0087",
        received_on=today - timedelta(days=1),
        severity="medium",
        summary="Crafted packets can cause an affected switch model to reload; no known exploitation, firmware "
        "update expected next month.",
        entity_scope="all",
        created_by_id=it,
        status="new",
        assessment_due=default_assessment_due(today - timedelta(days=1), "medium"),
    )
    db.add(adv3)
    db.flush()

    # --- vulnerabilities --------------------------------------------------------------------------------------
    v1 = Vulnerability(
        code="VUL-0001",
        title="Firewall cluster HQ: unpatched RCE (advisory ADV-0001)",
        cve_ids=["CVE-2026-31337"],
        advisory_id=adv1.id,
        entity_id=ents.get("ATL"),
        severity="critical",
        cvss=9.8,
        discovered_on=today - timedelta(days=10),
        remediation_due=default_remediation_due(today - timedelta(days=10), "critical"),
        owner_user_id=it,
        status="remediated",
        remediated_on=today - timedelta(days=8),
        notes="Vendor patch installed out of band; verified with a follow-up scan.",
    )
    db.add(v1)
    db.flush()
    if fw:
        v1.assets = [fw]
    adv1.vulnerability_ids = [v1.id]

    v2 = Vulnerability(
        code="VUL-0002",
        title="PLC line 1: outdated firmware without a certified security patch",
        cve_ids=["CVE-2025-44210"],
        entity_id=ents.get("ATL"),
        severity="high",
        cvss=7.5,
        discovered_on=today - timedelta(days=55),
        remediation_due=default_remediation_due(today - timedelta(days=55), "high"),
        owner_user_id=it,
        status="open",
        notes="Vendor has not released a certified firmware update for this controller generation.",
    )
    db.add(v2)
    db.flush()
    if plc:
        v2.assets = [plc]

    v3 = Vulnerability(
        code="VUL-0003",
        title="Warehouse management SaaS: privilege-escalation exposure (advisory ADV-0002)",
        cve_ids=["CVE-2026-19044"],
        advisory_id=adv2.id,
        entity_id=ents.get("ATN"),
        severity="medium",
        cvss=5.4,
        discovered_on=today - timedelta(days=3),
        remediation_due=default_remediation_due(today - timedelta(days=3), "medium"),
        owner_user_id=nl,
        status="accepted",
        acceptance_justification="Vendor confirmed the exploit requires an existing privileged tenant account; "
        "our accounts follow least-privilege. Accepted until the vendor patch ships.",
    )
    db.add(v3)
    db.flush()
    adv2.vulnerability_ids = [v3.id]

    db.commit()
    for a in (adv1, adv2, adv3):
        index_object(db, "advisory", a.id, commit=False)
    for v in (v1, v2, v3):
        index_object(db, "vulnerability", v.id, commit=False)
    db.commit()
