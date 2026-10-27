"""Search index source and comment / document-link target for suppliers."""

from app.api.util import register_target
from app.features.suppliers.logic import ACCESS_TYPES, STATUSES
from app.features.suppliers.models import Supplier
from app.services.indexing import _j, register_source


def _build_supplier(db, s: Supplier) -> list[dict]:
    contacts = "; ".join(
        f"{c.get('name') or ''} {c.get('role') or ''} {c.get('email') or ''}".strip()
        for c in (s.contacts or [])
    )
    certs = "; ".join(f"{c.cert_type} (valid until {c.valid_until or 'unknown'})" for c in s.certificates)
    ids = s.entity_ids
    chunk = {
        "title": f"{s.code} {s.name}",
        "content": _j(
            f"Supplier {s.code} {s.name}" + (f" ({s.legal_name})" if s.legal_name else ""),
            f"Country: {s.country}" if s.country else None,
            f"Category: {s.category}" if s.category else None,
            f"Access: {ACCESS_TYPES.get(s.access_type, s.access_type)}; Status: "
            f"{STATUSES.get(s.status, s.status)}; Tier: {s.tier or 'derived'}",
            f"Services and products: {s.services_products}" if s.services_products else None,
            s.description,
            f"Contacts: {contacts}" if contacts else None,
            f"Certificates: {certs}" if certs else None,
            s.notes,
        ),
        "url": f"/suppliers/{s.id}",
        "meta": {"status": s.status, "entity_ids": ids},
    }
    # search filters chunks by entity scope and de-duplicates per object: a supplier used by several entities gets
    # one identical chunk per using entity, a group supplier (no using entity) one group-level chunk
    return [{**chunk, "entity_id": e} for e in ids] if ids else [{**chunk, "entity_id": None}]


register_source("supplier", Supplier, "suppliers.read", "Supplier", _build_supplier)
register_target("supplier", Supplier, "suppliers.read", "suppliers.manage")


def _integrations():
    from app.api.documents import register_link_label
    from app.features.suppliers.reminders import run_reminders
    from app.services.notify import register_reminder_job

    register_reminder_job(run_reminders)
    register_link_label("supplier", lambda o: (f"Supplier {o.name}", f"/suppliers/{o.id}"))


_integrations()


def _my_supplier_reviews(db, pr, stakeholder_ids):
    """Supplier assessments due within 30 days, for users who may manage suppliers group-wide."""
    from datetime import date, timedelta

    from sqlalchemy import func, select

    from app.features.suppliers.models import Supplier, SupplierAssessment

    if "suppliers.manage" not in pr.global_perms:
        return []
    latest = (
        select(SupplierAssessment.supplier_id, func.max(SupplierAssessment.next_due).label("due"))
        .group_by(SupplierAssessment.supplier_id)
        .subquery()
    )
    horizon = date.today() + timedelta(days=30)
    rows = db.execute(
        select(Supplier, latest.c.due)
        .join(latest, latest.c.supplier_id == Supplier.id)
        .where(latest.c.due <= horizon)
    ).all()
    return [
        {
            "kind": "supplier_review",
            "kind_label": "Supplier reviews",
            "id": s.id,
            "code": None,
            "title": f"Review supplier {s.name}",
            "entity_code": None,
            "due": due,
            "href": f"/suppliers/{s.id}",
            "status": getattr(s, "tier", None),
        }
        for s, due in rows
        if getattr(s, "status", "active") != "offboarded"
    ]


def _register_mywork():
    from app.services.mywork import register_provider

    register_provider("suppliers", _my_supplier_reviews)


_register_mywork()
