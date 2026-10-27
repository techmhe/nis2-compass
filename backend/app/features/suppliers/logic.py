"""Supplier rules: tier suggestion, review cycles, clause catalogue (IR 2024/2690 Annex 5.1.4) and scoring."""

import calendar
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

ACCESS_TYPES = {
    "none": "No access",
    "it_remote": "IT remote access",
    "ot_remote": "OT remote maintenance",
    "cloud_data": "Cloud / data processing",
}
TIERS = {"critical": "Critical", "high": "High", "standard": "Standard"}
STATUSES = {"active": "Active", "onboarding": "Onboarding", "offboarded": "Offboarded"}
METHODS = {
    "questionnaire": "Questionnaire",
    "certificate_review": "Certificate review",
    "audit": "Audit",
    "on_site": "On-site visit",
}
RATINGS = {
    "acceptable": "Acceptable",
    "conditional": "Acceptable with conditions",
    "not_acceptable": "Not acceptable",
}
CLAUSE_STATUSES = {"agreed": "Agreed", "partial": "Partial", "missing": "Missing", "na": "Not applicable"}
CERT_TYPES = [
    "ISO/IEC 27001",
    "TISAX",
    "SOC 2 Type II",
    "IEC 62443",
    "BSI C5",
    "ISO 22301",
    "ISO/IEC 27017",
    "ISO/IEC 27018",
    "Other",
]
# review cycle in months per tier (research roadmap item 9)
REVIEW_MONTHS = {"critical": 12, "high": 24, "standard": 36}
CERT_WARN_DAYS = 60
DUE_SOON_DAYS = 60

# IR 2024/2690 Annex point 5.1.4 – contract content (text reproduced from the official Implementing Regulation)
CLAUSES: list[dict] = [
    {
        "clause": "a",
        "title": "Cybersecurity requirements",
        "text": "cybersecurity requirements for the suppliers or service providers, including requirements as regards "
        "the security in acquisition of ICT services or ICT products set out in point 6.1",
    },
    {
        "clause": "b",
        "title": "Awareness, skills, training and certifications",
        "text": "requirements regarding awareness, skills and training, and where appropriate certifications, required "
        "from the suppliers’ or service providers’ employees",
    },
    {
        "clause": "c",
        "title": "Background verification of staff",
        "text": "requirements regarding the verification of the background of the suppliers’ and service providers’ "
        "employees",
    },
    {
        "clause": "d",
        "title": "Incident notification",
        "text": "an obligation on suppliers and service providers to notify, without undue delay, the relevant entities "
        "of incidents that present a risk to the security of the network and information systems of those "
        "entities",
    },
    {
        "clause": "e",
        "title": "Right to audit",
        "text": "the right to audit or right to receive audit reports",
    },
    {
        "clause": "f",
        "title": "Vulnerability handling",
        "text": "an obligation on suppliers and service providers to handle vulnerabilities that present a risk to the "
        "security of the network and information systems of the relevant entities",
    },
    {
        "clause": "g",
        "title": "Subcontracting",
        "text": "requirements regarding subcontracting and, where the relevant entities allow subcontracting, "
        "cybersecurity requirements for subcontractors in accordance with the cybersecurity requirements "
        "referred to in point (a)",
    },
    {
        "clause": "h",
        "title": "Obligations at termination",
        "text": "obligations on the suppliers and service providers at the termination of the contract, such as "
        "retrieval and disposal of the information obtained by the suppliers and service providers in the "
        "exercise of their tasks",
    },
]
CLAUSE_CODES = [c["clause"] for c in CLAUSES]

ANSWER_VALUES = {"Yes": 1.0, "Partial": 0.5, "No": 0.0}
ANSWER_SYNONYMS = {
    "yes": "Yes",
    "y": "Yes",
    "ja": "Yes",
    "j": "Yes",
    "true": "Yes",
    "1": "Yes",
    "ok": "Yes",
    "partial": "Partial",
    "partially": "Partial",
    "partly": "Partial",
    "teilweise": "Partial",
    "p": "Partial",
    "no": "No",
    "n": "No",
    "nein": "No",
    "false": "No",
    "0": "No",
    "n/a": "N/A",
    "na": "N/A",
    "n.a.": "N/A",
    "not applicable": "N/A",
    "nicht zutreffend": "N/A",
    "-": "N/A",
}


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


def suggest_tier(access_type: str, max_criticality: int | None) -> tuple[str, str]:
    """Derived tier from the access type and the highest criticality (1–4) of dependent services."""
    crit = max_criticality or 0
    access = ACCESS_TYPES.get(access_type, access_type)
    if access_type != "none" and crit >= 4:
        return "critical", f"{access} and supports a critical service (criticality 4)"
    if access_type == "ot_remote" and crit >= 3:
        return "critical", f"{access} to OT supporting a high-criticality service"
    if access_type != "none":
        return "high", f"{access}" + (
            f"; highest dependent service criticality {crit}" if crit else "; no dependent services recorded"
        )
    if crit >= 3:
        return "high", f"No system access, but supports a service of criticality {crit}"
    return "standard", "No system access" + (
        f"; highest dependent service criticality {crit}" if crit else "; no dependent services recorded"
    )


def normalise_answer(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    if s in ("Yes", "Partial", "No", "N/A"):
        return s
    return ANSWER_SYNONYMS.get(s.lower(), "?")


def score_answers(questions: list[dict], answers: dict[str, str]) -> float | None:
    """Weighted score 0–100 over answered questions (N/A and unanswered are excluded)."""
    total = got = 0.0
    for q in questions:
        a = answers.get(q["id"])
        if a in ANSWER_VALUES:
            w = float(q.get("weight") or 1)
            total += w
            got += w * ANSWER_VALUES[a]
    return round(100 * got / total, 1) if total else None


def rating_for(score: float | None) -> str | None:
    if score is None:
        return None
    return "acceptable" if score >= 80 else "conditional" if score >= 60 else "not_acceptable"


def dependency_map(db: Session) -> tuple[dict[int, list[dict]], dict[int, list[dict]]]:
    """supplier_id -> dependent services [{id, code, name, entity_id, criticality, via}] and assets."""
    from app.features.inventory.models import Asset, Service, service_assets, service_suppliers

    services = {s.id: s for s in db.scalars(select(Service))}
    svc_out: dict[int, dict[int, dict]] = {}
    ast_out: dict[int, list[dict]] = {}

    def add(sup_id: int, s: Service, via: str) -> None:
        d = svc_out.setdefault(sup_id, {})
        if s.id not in d:
            d[s.id] = {
                "id": s.id,
                "code": s.code,
                "name": s.name,
                "entity_id": s.entity_id,
                "criticality": s.criticality,
                "status": s.status,
                "via": via,
            }

    for sid, sup_id in db.execute(select(service_suppliers.c.service_id, service_suppliers.c.supplier_id)):
        if sid in services:
            add(sup_id, services[sid], "direct")
    assets = {a.id: a for a in db.scalars(select(Asset).where(Asset.supplier_id.is_not(None)))}
    for a in assets.values():
        ast_out.setdefault(a.supplier_id, []).append(
            {
                "id": a.id,
                "code": a.code,
                "name": a.name,
                "entity_id": a.entity_id,
                "asset_type": a.asset_type,
                "criticality": a.criticality,
                "lifecycle": a.lifecycle,
            }
        )
    if assets:
        for sid, aid in db.execute(
            select(service_assets.c.service_id, service_assets.c.asset_id).where(
                service_assets.c.asset_id.in_(list(assets))
            )
        ):
            if sid in services:
                a = assets[aid]
                add(a.supplier_id, services[sid], f"asset {a.code}")
    return {k: list(v.values()) for k, v in svc_out.items()}, ast_out


def effective_tier(sup, dep_services: list[dict]) -> tuple[str, str, str]:
    """(effective tier, suggested tier, reason)."""
    active = [s["criticality"] for s in dep_services if s.get("status") != "retired"]
    suggested, reason = suggest_tier(sup.access_type, max(active) if active else None)
    tier = sup.tier if sup.tier_overridden and sup.tier else suggested
    return tier, suggested, reason


def due_state(next_due: date | None, has_assessment: bool, status: str, today: date | None = None) -> str:
    if status == "offboarded":
        return "n/a"
    if not has_assessment:
        return "never"
    if not next_due:
        return "ok"
    today = today or date.today()
    if next_due < today:
        return "overdue"
    if (next_due - today).days <= DUE_SOON_DAYS:
        return "due_soon"
    return "ok"


def cert_state(valid_until: date | None, today: date | None = None) -> str:
    if not valid_until:
        return "unknown"
    today = today or date.today()
    if valid_until < today:
        return "expired"
    if (valid_until - today).days <= CERT_WARN_DAYS:
        return "expiring"
    return "valid"
