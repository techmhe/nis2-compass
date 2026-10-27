"""Search index sources and comment / document-link targets for the inventory module."""

from app.api.util import register_target
from app.features.inventory.logic import (
    ASSET_TYPES,
    CIA_LEVELS,
    CRITICALITY,
    EXERCISE_TYPES,
    LIFECYCLE,
    PLAN_TYPES,
    RESULTS,
)
from app.features.inventory.models import Asset, Bia, ContinuityPlan, Exercise, Service
from app.services.indexing import _j, register_source


def _same_scope(obj, linked: list) -> list:
    """Linked objects whose names may appear in obj's search text: group-level ones and those of obj's entity.
    The chunk is visible to everybody who can read obj, so other entities' names must stay out of it."""
    return [x for x in linked if x.entity_id is None or x.entity_id == obj.entity_id]


def _service(db, s: Service) -> list[dict]:
    assets = _same_scope(s, s.assets)
    return [
        {
            "title": f"{s.code} {s.name}",
            "content": _j(
                f"{'Process' if s.kind == 'process' else 'Service'} {s.code} {s.name}",
                s.description,
                f"Criticality: {CRITICALITY.get(s.criticality)}; NIS2 relevant: {'yes' if s.nis2_relevant else 'no'}",
                f"RTO {s.rto_hours} h, RPO {s.rpo_hours} h" if s.rto_hours or s.rpo_hours else None,
                "Supporting assets: " + ", ".join(f"{a.code} {a.name}" for a in assets) if assets else None,
                ("Tags: " + ", ".join(s.tags)) if s.tags else None,
                s.notes,
            ),
            "entity_id": s.entity_id,
            "url": f"/inventory/services?service={s.id}",
            "meta": {"status": s.status},
        }
    ]


def _asset(db, a: Asset) -> list[dict]:
    cia = "/".join(CIA_LEVELS.get(v, "–") for v in (a.confidentiality, a.integrity, a.availability))
    return [
        {
            "title": f"{a.code} {a.name}",
            "content": _j(
                f"Asset {a.code} {a.name} ({ASSET_TYPES.get(a.asset_type, a.asset_type)}, "
                f"{LIFECYCLE.get(a.lifecycle, a.lifecycle)})",
                a.description,
                f"Site: {a.site}" if a.site else None,
                f"Location: {a.location}" if a.location else None,
                f"Classification C/I/A: {cia}",
                f"OT zone: {a.ot_zone}" if a.ot_zone else None,
                f"OT conduit: {a.ot_conduit}" if a.ot_conduit else None,
                f"Vendor / product: {a.vendor_product}" if a.vendor_product else None,
                f"External ID: {a.external_id}" if a.external_id else None,
                ("Tags: " + ", ".join(a.tags)) if a.tags else None,
                a.notes,
            ),
            "entity_id": a.entity_id,
            "url": f"/inventory/assets?asset={a.id}",
            "meta": {"lifecycle": a.lifecycle},
        }
    ]


def _plan(db, p: ContinuityPlan) -> list[dict]:
    services = _same_scope(p, p.services)
    return [
        {
            "title": f"{p.code} {p.title}",
            "content": _j(
                f"{PLAN_TYPES.get(p.plan_type, p.plan_type)} {p.code} {p.title}",
                p.description,
                f"Status: {p.status}; last tested {p.last_tested or 'never'}; next test due {p.next_test_due or '-'}",
                "Scope: " + ", ".join(s.name for s in services) if services else None,
            ),
            "entity_id": p.entity_id,
            "url": f"/inventory/plans?plan={p.id}",
            "meta": {"status": p.status},
        }
    ]


def _exercise(db, e: Exercise) -> list[dict]:
    services = _same_scope(e, e.services)
    return [
        {
            "title": f"{e.code} {e.title}",
            "content": _j(
                f"{EXERCISE_TYPES.get(e.exercise_type, e.exercise_type)} {e.code} on {e.exercise_date}: "
                f"{RESULTS.get(e.result, 'planned')}",
                e.title,
                e.objectives,
                e.participants,
                f"Deviations: {e.deviations}" if e.deviations else None,
                f"Lessons learned: {e.lessons_learned}" if e.lessons_learned else None,
                "Scope: " + ", ".join(s.name for s in services) if services else None,
            ),
            "entity_id": e.entity_id,
            "url": f"/inventory/plans?exercise={e.id}",
            "meta": {"result": e.result},
        }
    ]


register_source("service", Service, "assets.read", "Service", _service)
register_source("asset", Asset, "assets.read", "Asset", _asset)
register_source("continuity_plan", ContinuityPlan, "assets.read", "Continuity plan", _plan)
register_source("exercise", Exercise, "assets.read", "Continuity exercise", _exercise)

register_target("service", Service, "assets.read", "assets.manage")
register_target("asset", Asset, "assets.read", "assets.manage")
register_target("bia", Bia, "assets.read", "assets.manage")
register_target("continuity_plan", ContinuityPlan, "assets.read", "assets.manage")
register_target("exercise", Exercise, "assets.read", "assets.manage")


def _integrations():
    from app.api.documents import register_link_label
    from app.features.inventory.reminders import run_reminders
    from app.services.notify import register_reminder_job

    register_reminder_job(run_reminders)
    register_link_label("service", lambda o: (f"Service {o.name}", f"/inventory/services?service={o.id}"))
    register_link_label("asset", lambda o: (f"Asset {o.name}", f"/inventory/assets?asset={o.id}"))
    register_link_label(
        "continuity_plan",
        lambda o: (
            f"Plan {getattr(o, 'title', None) or getattr(o, 'name', '')}",
            f"/inventory/plans?plan={o.id}",
        ),
    )
    register_link_label(
        "exercise",
        lambda o: (f"Exercise {getattr(o, 'title', None) or o.id}", f"/inventory/plans?exercise={o.id}"),
    )
    register_link_label("bia", lambda o: (f"BIA {o.title or o.id}", f"/inventory/bia/{o.id}"))


_integrations()
