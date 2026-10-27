"""The risk export must not leak linked action items, work packages or risks of entities the caller cannot read."""

import io

import openpyxl
import pytest

PW = "Demo-Password-2026!"


@pytest.fixture(scope="module")
def atn_auditor(login):
    """Auditor (READ_ALL + reports.export) for ATN only."""
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.db import SessionLocal
    from app.models import Entity, Role, RoleAssignment, User

    db = SessionLocal()
    try:
        if not db.scalar(select(User).where(User.email == "atn.auditor@demo.local")):
            u = User(
                email="atn.auditor@demo.local", display_name="ATN Auditor", password_hash=hash_password(PW)
            )
            db.add(u)
            db.flush()
            role = db.scalar(select(Role).where(Role.key == "auditor"))
            atn = db.scalar(select(Entity).where(Entity.code == "ATN"))
            db.add(RoleAssignment(user_id=u.id, role_id=role.id, entity_id=atn.id))
            db.commit()
    finally:
        db.close()
    return login("atn.auditor@demo.local")


@pytest.fixture(scope="module")
def global_reader_atn_exporter(login):
    """risks.read group-wide (viewer) but reports.export for ATN only: the export must follow the narrower one."""
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.db import SessionLocal
    from app.models import Entity, Role, RoleAssignment, User

    db = SessionLocal()
    try:
        if not db.scalar(select(User).where(User.email == "atn.exporter@demo.local")):
            u = User(
                email="atn.exporter@demo.local", display_name="ATN Exporter", password_hash=hash_password(PW)
            )
            db.add(u)
            db.flush()
            exporter = Role(
                key="export_only_test", name="Export only", permissions=["reports.export"], is_system=False
            )
            db.add(exporter)
            db.flush()
            viewer = db.scalar(select(Role).where(Role.key == "viewer"))
            atn = db.scalar(select(Entity).where(Entity.code == "ATN"))
            db.add(RoleAssignment(user_id=u.id, role_id=viewer.id, entity_id=None))
            db.add(RoleAssignment(user_id=u.id, role_id=exporter.id, entity_id=atn.id))
            db.commit()
    finally:
        db.close()
    return login("atn.exporter@demo.local")


@pytest.fixture(scope="module")
def world(login, atn_auditor):
    isb = login("isb@demo.local")
    ents = {e["code"]: e["id"] for e in isb.get("/api/entities").json()}
    ai = next(
        o
        for o in isb.get("/api/risks/link-options", params={"target_type": "action_item"}).json()
        if o["entity_code"] == "ATL"
    )
    wp = isb.post("/api/work-packages", json={"title": "ATL secret package", "entity_id": ents["ATL"]}).json()
    group = isb.post("/api/risks", json={"title": "Group export scope risk"}).json()["risk"]
    atl = isb.post("/api/risks", json={"title": "ATL export scope risk", "entity_id": ents["ATL"]}).json()[
        "risk"
    ]
    for rid in (group["id"], atl["id"]):
        for t, i in (("action_item", ai["id"]), ("work_package", wp["id"])):
            r = isb.post(
                f"/api/risks/{rid}/links", json={"link_type": "treatment", "target_type": t, "target_id": i}
            )
            assert r.status_code == 200, r.text
    return {"ai": ai, "wp": wp, "group": group, "atl": atl}


def _cells(client) -> tuple[set, set]:
    r = client.get("/api/risks/export")
    assert r.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    register = {c.value for c in wb["Risk register"]["A"]}
    plan = {c.value for ws_row in wb["Treatment plan"].iter_rows() for c in ws_row if c.value}
    return register, plan


def test_scoped_auditor_export_hides_foreign_links_and_risks(world, atn_auditor):
    register, plan = _cells(atn_auditor)
    assert world["group"]["code"] in register  # group-level risks stay visible
    assert world["atl"]["code"] not in register
    assert world["ai"]["label"].split()[0] not in plan
    assert world["wp"]["code"] not in plan
    assert "ATL secret package" not in plan
    assert world["group"]["code"] in plan  # the risk row stays, without the foreign measure


def test_group_isb_export_still_lists_links(world, login):
    register, plan = _cells(login("isb@demo.local"))
    assert world["atl"]["code"] in register
    assert world["wp"]["code"] in plan and "Action plan item" in plan


def test_export_scope_follows_reports_export_not_risks_read(world, global_reader_atn_exporter, login):
    risks = global_reader_atn_exporter.get("/api/risks").json()
    listed = {r["code"] for r in (risks["items"] if isinstance(risks, dict) else risks)}
    assert world["atl"]["code"] in listed  # risks.read is group-wide, so the list shows ATL ...
    register, _ = _cells(global_reader_atn_exporter)
    assert world["atl"]["code"] not in register  # ... but the export is limited to the ATN export scope
    assert world["group"]["code"] in register
