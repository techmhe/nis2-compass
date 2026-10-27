"""Inventory must neither link nor show suppliers the caller cannot see (supplier visibility is per entity)."""

import json

import pytest

PW = "Demo-Password-2026!"


def _entities(client) -> dict[str, int]:
    return {e["code"]: e["id"] for e in client.get("/api/entities").json()}


@pytest.fixture(scope="module")
def atn_manager(login):
    """Assessor (incl. assets.manage, suppliers.read) for ATN only."""
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.db import SessionLocal
    from app.models import Entity, Role, RoleAssignment, User

    db = SessionLocal()
    try:
        if not db.scalar(select(User).where(User.email == "atn.manager@demo.local")):
            u = User(
                email="atn.manager@demo.local", display_name="ATN Manager", password_hash=hash_password(PW)
            )
            db.add(u)
            db.flush()
            role = db.scalar(select(Role).where(Role.key == "assessor"))
            atn = db.scalar(select(Entity).where(Entity.code == "ATN"))
            db.add(RoleAssignment(user_id=u.id, role_id=role.id, entity_id=atn.id))
            db.commit()
    finally:
        db.close()
    return login("atn.manager@demo.local")


@pytest.fixture(scope="module")
def world(login, atn_manager):
    """An ATL-only supplier linked (by the group ISB) to an ATN service and asset, a group supplier, a BIA."""
    isb = login("isb@demo.local")
    ents = _entities(isb)
    secret = isb.post(
        "/api/suppliers", json={"name": "Hidden Vendor Ltd", "entity_ids": [ents["ATL"]]}
    ).json()
    shared = isb.post("/api/suppliers", json={"name": "Shared Group Vendor", "entity_ids": []}).json()
    svc = isb.post(
        "/api/inventory/services",
        json={"name": "Scope test service", "entity_id": ents["ATN"], "criticality": 3},
    ).json()
    ast = isb.post(
        "/api/inventory/assets",
        json={
            "name": "Scope test asset",
            "entity_id": ents["ATN"],
            "asset_type": "IT",
            "supplier_id": secret["id"],
        },
    ).json()
    r = isb.put(
        f"/api/inventory/services/{svc['id']}/dependencies",
        json={"asset_ids": [ast["id"]], "supplier_ids": [secret["id"], shared["id"]]},
    )
    assert r.status_code == 200, r.text
    bia = isb.post("/api/inventory/bias", json={"entity_id": ents["ATN"], "period": "scope-test"}).json()
    return {"ents": ents, "secret": secret, "shared": shared, "svc": svc, "ast": ast, "bia": bia}


def test_cannot_link_invisible_supplier(world, atn_manager):
    ents, secret = world["ents"], world["secret"]
    fresh = atn_manager.post(
        "/api/inventory/services", json={"name": "Unlinked service", "entity_id": ents["ATN"]}
    ).json()
    missing = atn_manager.put(
        f"/api/inventory/services/{fresh['id']}/dependencies",
        json={"asset_ids": [], "supplier_ids": [987654]},
    )
    r = atn_manager.put(
        f"/api/inventory/services/{fresh['id']}/dependencies",
        json={"asset_ids": [], "supplier_ids": [secret["id"]]},
    )
    assert r.status_code == 400 and r.json() == missing.json() == {"detail": "unknown supplier"}
    body = {"name": "Probe", "entity_id": ents["ATN"], "asset_type": "IT", "supplier_id": secret["id"]}
    r = atn_manager.post("/api/inventory/assets", json=body)
    assert r.status_code == 400 and r.json() == {"detail": "unknown supplier"}
    a = world["ast"]
    r = atn_manager.put(
        f"/api/inventory/assets/{a['id']}", json={**body, "name": a["name"], "supplier_id": None}
    )
    assert r.status_code == 200
    r = atn_manager.put(f"/api/inventory/assets/{a['id']}", json=body)
    assert r.status_code == 400
    # a visible supplier can be linked
    r = atn_manager.put(
        f"/api/inventory/assets/{a['id']}",
        json={**body, "name": a["name"], "supplier_id": world["shared"]["id"]},
    )
    assert r.status_code == 200 and r.json()["supplier"]["name"] == "Shared Group Vendor"


def test_unchanged_hidden_link_survives_edit(login, atn_manager, world):
    isb = login("isb@demo.local")
    a = isb.post(
        "/api/inventory/assets",
        json={
            "name": "Hidden-linked asset",
            "entity_id": world["ents"]["ATN"],
            "asset_type": "IT",
            "supplier_id": world["secret"]["id"],
        },
    ).json()
    body = {
        "name": "Hidden-linked asset renamed",
        "entity_id": world["ents"]["ATN"],
        "asset_type": "IT",
        "supplier_id": world["secret"]["id"],
    }
    assert atn_manager.put(f"/api/inventory/assets/{a['id']}", json=body).status_code == 200


def _no_name(payload) -> None:
    assert "Hidden Vendor" not in json.dumps(payload)


def test_hidden_supplier_masked_in_service_asset_tree_and_bia(login, atn_manager, world):
    isb = login("isb@demo.local")
    secret_id, shared_id = world["secret"]["id"], world["shared"]["id"]
    # restore the asset link that the previous test changed
    a = world["ast"]
    isb.put(
        f"/api/inventory/assets/{a['id']}",
        json={
            "name": a["name"],
            "entity_id": world["ents"]["ATN"],
            "asset_type": "IT",
            "supplier_id": secret_id,
        },
    )

    detail = atn_manager.get(f"/api/inventory/services/{world['svc']['id']}").json()
    _no_name(detail)
    sups = {s["id"]: s for s in detail["suppliers"]}
    assert sups[secret_id] == {"id": secret_id, "hidden": True}
    assert sups[shared_id]["name"] == "Shared Group Vendor"

    asset = atn_manager.get(f"/api/inventory/assets/{a['id']}").json()
    _no_name(asset)
    assert asset["supplier"] == {"id": secret_id, "hidden": True}
    _no_name(atn_manager.get("/api/inventory/assets").json())

    tree = atn_manager.get("/api/inventory/dependencies").json()
    _no_name(tree)
    node = next(s for s in tree["services"] if s["id"] == world["svc"]["id"])
    assert {"id": secret_id, "hidden": True} in node["suppliers"]

    bia = atn_manager.get(f"/api/inventory/bias/{world['bia']['id']}").json()
    _no_name(bia)
    item = next(i for i in bia["items"] if i["service_id"] == world["svc"]["id"])
    assert {"id": secret_id, "hidden": True} in item["dependent_suppliers"]
    _no_name(atn_manager.get("/api/inventory/bias").json())

    # the group-wide ISB still sees everything
    full = isb.get(f"/api/inventory/services/{world['svc']['id']}").json()
    assert any(s.get("name") == "Hidden Vendor Ltd" for s in full["suppliers"])


def test_import_does_not_match_invisible_supplier(atn_manager, world):
    csv_text = (
        "Asset name;Company;Supplier\nImport probe;ATN;Hidden Vendor Ltd\nImport ok;ATN;Shared Group Vendor\n"
    )

    def run(dry):
        prev = atn_manager.post(
            "/api/inventory/import/preview", files={"file": ("a.csv", csv_text.encode(), "text/csv")}
        ).json()
        form = {"kind": "assets", "mapping": json.dumps(prev["suggested"]["assets"]), "dry_run": dry}
        return atn_manager.post(
            "/api/inventory/import", data=form, files={"file": ("a.csv", csv_text.encode(), "text/csv")}
        )

    r = run("true")
    assert r.status_code == 200, r.text
    out = json.dumps(r.json())
    assert "Supplier 'Hidden Vendor Ltd' not found in the supplier register" in out
    assert "Supplier 'Shared Group Vendor' not found" not in out
    assert run("false").status_code == 200
    probe = next(a for a in atn_manager.get("/api/inventory/assets").json() if a["name"] == "Import probe")
    assert probe["supplier"] is None


def test_export_omits_invisible_supplier(login, atn_manager, world):
    import io

    import openpyxl

    isb = login("isb@demo.local")
    a = world["ast"]
    isb.put(
        f"/api/inventory/assets/{a['id']}",
        json={
            "name": a["name"],
            "entity_id": world["ents"]["ATN"],
            "asset_type": "IT",
            "supplier_id": world["secret"]["id"],
        },
    )

    def cells(client):
        r = client.get("/api/inventory/export.xlsx")
        assert r.status_code == 200, r.text
        wb = openpyxl.load_workbook(io.BytesIO(r.content))
        return [str(c.value) for ws in wb for row in ws.iter_rows() for c in row if c.value is not None]

    mine = cells(atn_manager)
    assert not any("Hidden Vendor" in v or world["secret"]["code"] in v for v in mine)
    assert any("Shared Group Vendor" in v for v in mine)
    assert any("Hidden Vendor" in v for v in cells(isb))
