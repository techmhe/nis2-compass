"""Inventory rules: picklists, BIA derivations (MTPD / RTO / RPO), restore-test coverage and consistency flags."""

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

ASSET_TYPES = {
    "IT": "IT system",
    "OT": "OT system",
    "cloud": "Cloud service",
    "data": "Data / information",
    "facility": "Facility",
    "network": "Network",
}
LIFECYCLE = {
    "planned": "Planned",
    "in_operation": "In operation",
    "end_of_life": "End of life",
    "retired": "Retired",
}
SERVICE_STATUS = {"active": "Active", "planned": "Planned", "retired": "Retired"}
SERVICE_KINDS = {"service": "Service", "process": "Process"}
CRITICALITY = {1: "Low", 2: "Medium", 3: "High", 4: "Critical"}
CIA_LEVELS = {1: "Low", 2: "Medium", 3: "High", 4: "Very high"}
PLAN_TYPES = {
    "BCP": "Business continuity plan",
    "DRP": "Disaster recovery plan",
    "crisis": "Crisis management plan",
    "incident_response": "Incident response plan",
}
PLAN_STATUS = {"draft": "Draft", "approved": "Approved", "retired": "Retired"}
EXERCISE_TYPES = {
    "tabletop": "Tabletop exercise",
    "restore_test": "Backup restore test",
    "failover": "Failover test",
    "crisis_drill": "Crisis drill",
}
RESULTS = {"passed": "Passed", "partially": "Partially passed", "failed": "Failed"}
BIA_STATUS = {"draft": "Draft", "approved": "Approved"}

DIMENSIONS = {
    "operational": "Operational",
    "financial": "Financial",
    "legal": "Legal / regulatory",
    "safety": "Health and safety",
    "reputation": "Reputation",
}
WINDOWS: list[tuple[str, str, float]] = [
    ("4h", "4 hours", 4),
    ("24h", "24 hours", 24),
    ("72h", "72 hours", 72),
    ("1w", "1 week", 168),
]
IMPACT_LEVELS = {0: "None", 1: "Minor", 2: "Moderate", 3: "Serious", 4: "Critical"}
# the disruption becomes intolerable once any dimension reaches this level
MTPD_THRESHOLD = 3
TEST_VALID_MONTHS = 12
RESTORE_TYPES = ("restore_test", "failover")
SUCCESS = ("passed", "partially")


def clean_impacts(raw: dict | None) -> dict:
    out: dict[str, dict[str, int]] = {}
    for dim in DIMENSIONS:
        vals = (raw or {}).get(dim) or {}
        row = {}
        for key, _label, _h in WINDOWS:
            v = vals.get(key)
            if v is None or v == "":
                continue
            try:
                iv = int(v)
            except (TypeError, ValueError):
                continue
            row[key] = max(0, min(4, iv))
        out[dim] = row
    return out


def derive(impacts: dict | None) -> dict:
    """Derived values of a BIA item: MTPD = first time window in which any dimension reaches 'serious';
    suggested RTO = half the MTPD; suggested RPO = the suggested RTO capped at 24 h; suggested service
    criticality from the highest impact within 24 hours."""
    imp = clean_impacts(impacts)
    mtpd = None
    per_window = []
    for key, label, hours in WINDOWS:
        top = max((imp[d].get(key, 0) for d in DIMENSIONS), default=0)
        per_window.append({"window": key, "label": label, "hours": hours, "max": top})
        if mtpd is None and top >= MTPD_THRESHOLD:
            mtpd = hours
    rto = mtpd / 2 if mtpd else None
    rpo = min(rto, 24.0) if rto else None
    early = max((imp[d].get(k, 0) for d in DIMENSIONS for k in ("4h", "24h")), default=0)
    overall = max((w["max"] for w in per_window), default=0)
    crit = 4 if early >= 4 else 3 if early >= 3 else 2 if overall >= 3 else 1
    return {
        "mtpd_hours": mtpd,
        "rto_hours": rto,
        "rpo_hours": rpo,
        "criticality": crit,
        "windows": per_window,
    }


def item_values(item) -> dict:
    """Effective values of a BIA item (manual entries win over derivations) plus warnings."""
    d = derive(item.impacts)
    mtpd = item.mtpd_hours if item.mtpd_hours is not None else d["mtpd_hours"]
    rto = item.rto_hours if item.rto_hours is not None else (mtpd / 2 if mtpd else None)
    rpo = item.rpo_hours if item.rpo_hours is not None else (min(rto, 24.0) if rto else None)
    warnings = []
    if mtpd is not None and rto is not None and rto > mtpd:
        warnings.append("RTO is longer than the maximum tolerable period of disruption")
    if rto is not None and rpo is not None and rpo > rto * 4 and rpo > 24:
        warnings.append("RPO is much longer than the RTO; check the backup frequency")
    if not item.impacts or not any((item.impacts or {}).get(dm) for dm in DIMENSIONS):
        warnings.append("No impacts assessed yet")
    return {"derived": d, "mtpd_hours": mtpd, "rto_hours": rto, "rpo_hours": rpo, "warnings": warnings}


def add_months(d: date, months: int) -> date:
    from app.features.suppliers.logic import add_months as _am

    return _am(d, months)


def restore_coverage(db: Session, services: list, today: date | None = None, visible=None) -> list[dict]:
    """RTO / RPO targets versus the last successful restore or failover test per service.
    `visible(entity_id)` limits the exercises taken into account to those the caller may read."""
    from app.features.inventory.models import Exercise, exercise_assets, exercise_services, service_assets

    today = today or date.today()
    ids = [s.id for s in services]
    if not ids:
        return []
    ex = {
        e.id: e
        for e in db.scalars(
            select(Exercise).where(Exercise.exercise_type.in_(RESTORE_TYPES), Exercise.result.is_not(None))
        )
        if visible is None or visible(e.entity_id)
    }
    by_service: dict[int, set[int]] = {}
    for eid, sid in db.execute(select(exercise_services.c.exercise_id, exercise_services.c.service_id)):
        if eid in ex:
            by_service.setdefault(sid, set()).add(eid)
    asset_services: dict[int, set[int]] = {}
    for sid, aid in db.execute(select(service_assets.c.service_id, service_assets.c.asset_id)):
        asset_services.setdefault(aid, set()).add(sid)
    for eid, aid in db.execute(select(exercise_assets.c.exercise_id, exercise_assets.c.asset_id)):
        if eid in ex:
            for sid in asset_services.get(aid, ()):
                by_service.setdefault(sid, set()).add(eid)
    out = []
    for s in services:
        tests = sorted(
            (ex[i] for i in by_service.get(s.id, ())), key=lambda e: (e.exercise_date, e.id), reverse=True
        )
        last = tests[0] if tests else None
        ok = next((t for t in tests if t.result in SUCCESS), None)
        if not tests:
            state = "no_test"
        elif last.result == "failed":
            state = "failed"
        elif ok and ok.exercise_date < today - timedelta(days=365):
            state = "stale"
        elif ok and (
            (
                s.rto_hours is not None
                and ok.achieved_rto_hours is not None
                and ok.achieved_rto_hours > s.rto_hours
            )
            or (
                s.rpo_hours is not None
                and ok.achieved_rpo_hours is not None
                and ok.achieved_rpo_hours > s.rpo_hours
            )
        ):
            state = "exceeds"
        elif s.rto_hours is None:
            state = "no_target"
        else:
            state = "ok"

        def brief(e):
            return (
                {
                    "id": e.id,
                    "code": e.code,
                    "title": e.title,
                    "date": e.exercise_date,
                    "result": e.result,
                    "type": e.exercise_type,
                    "achieved_rto_hours": e.achieved_rto_hours,
                    "achieved_rpo_hours": e.achieved_rpo_hours,
                }
                if e
                else None
            )

        out.append(
            {
                "service_id": s.id,
                "code": s.code,
                "name": s.name,
                "entity_id": s.entity_id,
                "criticality": s.criticality,
                "rto_hours": s.rto_hours,
                "rpo_hours": s.rpo_hours,
                "last_success": brief(ok),
                "last_test": brief(last),
                "state": state,
            }
        )
    return out


def consistency_flags(db: Session, services: list, assets: list, today: date | None = None) -> list[dict]:
    """Data quality and coverage flags for the (already permission-filtered) services and assets."""
    from app.features.inventory.models import Bia, BiaItem, ContinuityPlan, plan_services, service_assets

    today = today or date.today()
    flags: list[dict] = []

    def flag(code, severity, obj_type, obj, message):
        flags.append(
            {
                "code": code,
                "severity": severity,
                "object_type": obj_type,
                "object_id": obj.id,
                "object_code": obj.code,
                "label": obj.name,
                "entity_id": obj.entity_id,
                "message": message,
            }
        )

    svc_assets: dict[int, set[int]] = {}
    for sid, aid in db.execute(select(service_assets.c.service_id, service_assets.c.asset_id)):
        svc_assets.setdefault(sid, set()).add(aid)
    used_assets = {a for v in svc_assets.values() for a in v}
    asset_by_id = {a.id: a for a in assets}

    for a in assets:
        if a.lifecycle == "retired":
            continue
        if not a.owner_id:
            flag("asset_no_owner", "medium", "asset", a, "Asset has no owner")
        missing = [
            n
            for n, v in (
                ("confidentiality", a.confidentiality),
                ("integrity", a.integrity),
                ("availability", a.availability),
            )
            if v is None
        ]
        if missing:
            flag(
                "asset_no_classification",
                "medium",
                "asset",
                a,
                "Classification incomplete: " + ", ".join(missing) + " not set",
            )
        if a.asset_type == "OT" and not a.ot_zone:
            flag("ot_no_zone", "low", "asset", a, "OT asset is not assigned to a zone")
        if a.lifecycle == "end_of_life" and a.id in used_assets:
            flag("eol_in_use", "medium", "asset", a, "End-of-life asset still supports a service")
        if a.id not in used_assets and a.asset_type != "data":
            flag("asset_orphan", "low", "asset", a, "Asset is not linked to any service")

    approved_items = {
        r
        for r in db.scalars(
            select(BiaItem.service_id)
            .join(Bia)
            .where(Bia.status == "approved", BiaItem.service_id.is_not(None))
        )
    }
    any_items = {r for r in db.scalars(select(BiaItem.service_id).where(BiaItem.service_id.is_not(None)))}
    plans = {p.id: p for p in db.scalars(select(ContinuityPlan).where(ContinuityPlan.status != "retired"))}
    svc_plans: dict[int, list] = {}
    for pid, sid in db.execute(select(plan_services.c.plan_id, plan_services.c.service_id)):
        if pid in plans:
            svc_plans.setdefault(sid, []).append(plans[pid])
    cutoff = add_months(today, -TEST_VALID_MONTHS)

    for s in services:
        if s.status == "retired":
            continue
        if not s.owner_id:
            flag("service_no_owner", "medium", "service", s, "Service has no owner")
        if not svc_assets.get(s.id):
            flag("service_no_assets", "low", "service", s, "No supporting assets recorded")
        eol = [
            asset_by_id[a]
            for a in svc_assets.get(s.id, ())
            if a in asset_by_id and asset_by_id[a].lifecycle == "end_of_life"
        ]
        if eol and s.criticality >= 3:
            flag(
                "critical_on_eol",
                "high",
                "service",
                s,
                "Critical service depends on end-of-life asset " + ", ".join(a.code for a in eol),
            )
        if s.criticality >= 3:
            if s.id not in approved_items:
                flag(
                    "critical_no_bia",
                    "high",
                    "service",
                    s,
                    "Critical service without an approved BIA"
                    + (" (draft only)" if s.id in any_items else ""),
                )
            if s.rto_hours is None:
                flag("critical_no_rto", "medium", "service", s, "Critical service has no RTO target")
            ps = svc_plans.get(s.id, [])
            if not ps:
                flag(
                    "critical_no_plan",
                    "high",
                    "service",
                    s,
                    "Critical service is not covered by a continuity plan",
                )
            elif not any(p.last_tested and p.last_tested >= cutoff for p in ps):
                flag(
                    "critical_plan_untested",
                    "high",
                    "service",
                    s,
                    "No continuity plan covering this service was tested successfully in the last 12 months",
                )
    order = {"high": 0, "medium": 1, "low": 2}
    flags.sort(key=lambda f: (order[f["severity"]], f["object_type"], f["object_code"]))
    return flags
