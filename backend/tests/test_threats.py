"""Threat information log (advisories, Cbb Art. 17) and vulnerability tracking (IR 2024/2690 6.10)."""

from datetime import date, timedelta

import pytest

PW = "Demo-Password-2026!"


def _entities(c) -> dict[str, int]:
    return {e["code"]: e["id"] for e in c.get("/api/entities").json()}


def _users(c) -> dict[str, int]:
    return {u["email"]: u["id"] for u in c.get("/api/users/directory").json()}


@pytest.fixture(scope="module")
def pgn_manager(login):
    """A user holding controls.manage scoped to ATN only (no other feature test defines this yet)."""
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.db import SessionLocal
    from app.models import Entity, Role, RoleAssignment, User

    db = SessionLocal()
    try:
        if not db.scalar(select(User).where(User.email == "atn.threats@demo.local")):
            u = User(
                email="atn.threats@demo.local",
                display_name="ATN Threats Manager",
                password_hash=hash_password(PW),
            )
            db.add(u)
            db.flush()
            role = db.scalar(select(Role).where(Role.key == "assessor"))  # includes controls.manage
            atn = db.scalar(select(Entity).where(Entity.code == "ATN"))
            db.add(RoleAssignment(user_id=u.id, role_id=role.id, entity_id=atn.id))
            db.commit()
    finally:
        db.close()
    return login("atn.threats@demo.local")


# --- CRUD and default due dates ---------------------------------------------------------------------------------


def test_advisory_crud_and_defaults(login):
    isb, viewer = login("isb@demo.local"), login("viewer@demo.local")
    received = date.today() - timedelta(days=2)
    body = {
        "title": "Test advisory: critical library CVE",
        "source": "BSI",
        "received_on": received.isoformat(),
        "severity": "critical",
        "summary": "Details",
        "entity_scope": "all",
    }
    assert viewer.post("/api/threats/advisories", json=body).status_code == 403
    r = isb.post("/api/threats/advisories", json=body)
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["code"].startswith("ADV-") and a["status"] == "new"
    assert a["assessment_due"] == (received + timedelta(days=1)).isoformat()  # critical -> 1 day

    # explicit override is respected
    r2 = isb.post(
        "/api/threats/advisories",
        json={**body, "severity": "low", "assessment_due": (received + timedelta(days=99)).isoformat()},
    )
    assert r2.json()["assessment_due"] == (received + timedelta(days=99)).isoformat()

    r3 = isb.post("/api/threats/advisories", json={**body, "severity": "medium"})
    assert r3.json()["assessment_due"] == (received + timedelta(days=10)).isoformat()

    got = viewer.get(f"/api/threats/advisories/{a['id']}")
    assert got.status_code == 200 and got.json()["can_edit"] is False

    upd = isb.put(f"/api/threats/advisories/{a['id']}", json={**body, "title": "Updated title"})
    assert upd.status_code == 200 and upd.json()["title"] == "Updated title"

    assert viewer.delete(f"/api/threats/advisories/{a['id']}").status_code == 403
    assert isb.delete(f"/api/threats/advisories/{a['id']}").status_code == 200
    assert isb.get(f"/api/threats/advisories/{a['id']}").status_code == 404


def test_vulnerability_crud_and_defaults(login):
    isb, viewer = login("isb@demo.local"), login("viewer@demo.local")
    ents = _entities(isb)
    discovered = date.today() - timedelta(days=1)
    body = {
        "title": "Test vuln: outdated TLS library",
        "entity_id": ents["ATL"],
        "severity": "high",
        "discovered_on": discovered.isoformat(),
        "status": "open",
    }
    assert viewer.post("/api/threats/vulnerabilities", json=body).status_code == 403
    r = isb.post("/api/threats/vulnerabilities", json=body)
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["code"].startswith("VUL-")
    assert v["remediation_due"] == (discovered + timedelta(days=30)).isoformat()  # high -> 30 days

    # accepting without an exception or justification is rejected
    bad = isb.put(f"/api/threats/vulnerabilities/{v['id']}", json={**body, "status": "accepted"})
    assert bad.status_code == 422

    ok = isb.put(
        f"/api/threats/vulnerabilities/{v['id']}",
        json={**body, "status": "accepted", "acceptance_justification": "Compensating control in place."},
    )
    assert ok.status_code == 200 and ok.json()["status"] == "accepted"

    # remediated_on auto-set on status -> remediated
    r2 = isb.post("/api/threats/vulnerabilities", json={**body, "title": "Another test vuln"})
    v2 = r2.json()
    upd = isb.put(
        f"/api/threats/vulnerabilities/{v2['id']}",
        json={**body, "title": "Another test vuln", "status": "remediated"},
    )
    assert upd.status_code == 200
    assert upd.json()["remediated_on"] == date.today().isoformat()

    assert isb.delete(f"/api/threats/vulnerabilities/{v['id']}").status_code == 200
    assert isb.delete(f"/api/threats/vulnerabilities/{v2['id']}").status_code == 200


# --- assessment flow -----------------------------------------------------------------------------------------


def test_assessment_flow_requires_rationale(login):
    isb = login("isb@demo.local")
    r = isb.post(
        "/api/threats/advisories",
        json={
            "title": "Test advisory: assessment flow",
            "source": "other",
            "received_on": date.today().isoformat(),
            "severity": "medium",
            "entity_scope": "all",
        },
    )
    a = r.json()

    # cannot mark assessed without recording relevance
    assert (
        isb.post(f"/api/threats/advisories/{a['id']}/assess", json={"status": "assessed"}).status_code == 422
    )

    r2 = isb.post(f"/api/threats/advisories/{a['id']}/assess", json={"status": "assessed", "relevant": "yes"})
    assert r2.status_code == 200 and r2.json()["status"] == "assessed"
    assert r2.json()["assessed_by_id"] is not None and r2.json()["assessed_on"] == date.today().isoformat()

    # closing needs a rationale and a decision on measures
    assert (
        isb.post(
            f"/api/threats/advisories/{a['id']}/assess", json={"status": "closed", "relevant": "yes"}
        ).status_code
        == 422
    )
    assert (
        isb.post(
            f"/api/threats/advisories/{a['id']}/assess",
            json={"status": "closed", "relevant": "yes", "measures_need_adjustment": "no"},
        ).status_code
        == 422
    )

    r3 = isb.post(
        f"/api/threats/advisories/{a['id']}/assess",
        json={
            "status": "closed",
            "relevant": "yes",
            "measures_need_adjustment": "no",
            "rationale": "No adjustment needed, existing controls are sufficient.",
        },
    )
    assert r3.status_code == 200 and r3.json()["status"] == "closed"

    isb.delete(f"/api/threats/advisories/{a['id']}")


def test_create_vulnerability_and_task_from_advisory(login):
    isb = login("isb@demo.local")
    ents = _entities(isb)
    r = isb.post(
        "/api/threats/advisories",
        json={
            "title": "Test advisory: derive vuln and task",
            "source": "supplier",
            "received_on": date.today().isoformat(),
            "severity": "high",
            "entity_scope": "list",
            "entity_ids": [ents["ATL"]],
        },
    )
    a = r.json()

    rv = isb.post(f"/api/threats/advisories/{a['id']}/vulnerability", json={"entity_id": ents["ATL"]})
    assert rv.status_code == 200, rv.text
    v = rv.json()
    assert v["advisory_id"] == a["id"] and v["severity"] == "high"
    assert isb.get(f"/api/threats/advisories/{a['id']}").json()["vulnerability_ids"] == [v["id"]]

    rt = isb.post(f"/api/threats/advisories/{a['id']}/task", json={})
    assert rt.status_code == 200, rt.text
    assert isb.get(f"/api/threats/advisories/{a['id']}").json()["task_ids"] == [rt.json()["id"]]

    rt2 = isb.post(f"/api/threats/vulnerabilities/{v['id']}/task", json={})
    assert rt2.status_code == 200
    assert isb.get(f"/api/threats/vulnerabilities/{v['id']}").json()["task_ids"] == [rt2.json()["id"]]

    isb.delete(f"/api/threats/vulnerabilities/{v['id']}")
    isb.delete(f"/api/threats/advisories/{a['id']}")


# --- entity scoping --------------------------------------------------------------------------------------------


def test_entity_scoping(login, pgn_manager):
    isb, nl = login("isb@demo.local"), login("nl.contact@demo.local")
    ents = _entities(isb)

    # a ATN-scoped manager can create for ATN but not for ATL
    body = {
        "title": "Test advisory: ATN scoped",
        "source": "other",
        "received_on": date.today().isoformat(),
        "severity": "low",
        "entity_scope": "list",
        "entity_ids": [ents["ATN"]],
    }
    r = pgn_manager.post("/api/threats/advisories", json=body)
    assert r.status_code == 200, r.text
    a = r.json()
    assert (
        pgn_manager.post("/api/threats/advisories", json={**body, "entity_ids": [ents["ATL"]]}).status_code
        == 403
    )
    assert (
        pgn_manager.post("/api/threats/advisories", json={**body, "entity_scope": "all"}).status_code == 403
    )

    # nl.contact (read-only controls.read for ATN/ATC) can read it but not edit it
    assert nl.get(f"/api/threats/advisories/{a['id']}").status_code == 200
    assert nl.get(f"/api/threats/advisories/{a['id']}").json()["can_edit"] is False
    assert nl.put(f"/api/threats/advisories/{a['id']}", json=body).status_code == 403
    # read access does not allow creating follow-up tasks (they change the advisory)
    assert nl.post(f"/api/threats/advisories/{a['id']}/task", json={}).status_code == 403

    # a ATL-only vulnerability is not visible to nl.contact
    vbody = {
        "title": "Test vuln: ATL only",
        "entity_id": ents["ATL"],
        "severity": "low",
        "discovered_on": date.today().isoformat(),
    }
    v = isb.post("/api/threats/vulnerabilities", json=vbody).json()
    assert nl.get(f"/api/threats/vulnerabilities/{v['id']}").status_code == 403
    ids = [x["id"] for x in nl.get("/api/threats/vulnerabilities").json()["items"]]
    assert v["id"] not in ids

    isb.delete(f"/api/threats/vulnerabilities/{v['id']}")
    pgn_manager.delete(f"/api/threats/advisories/{a['id']}")


# --- reminders and checks -------------------------------------------------------------------------------------


def test_reminders(login):
    from app.db import SessionLocal
    from app.features.threats.hooks import run_threats_reminders

    isb = login("isb@demo.local")
    ents = _entities(isb)
    users = _users(isb)
    a = isb.post(
        "/api/threats/advisories",
        json={
            "title": "Test advisory: reminder",
            "source": "other",
            "received_on": (date.today() - timedelta(days=5)).isoformat(),
            "severity": "high",
            "entity_scope": "all",
            "assessment_due": date.today().isoformat(),
        },
    ).json()
    v = isb.post(
        "/api/threats/vulnerabilities",
        json={
            "title": "Test vuln: reminder",
            "entity_id": ents["ATL"],
            "severity": "high",
            "discovered_on": (date.today() - timedelta(days=29)).isoformat(),
            "owner_user_id": users["it@demo.local"],
            "status": "open",
        },
    ).json()
    db = SessionLocal()
    try:
        n = run_threats_reminders(db)
        db.commit()
        assert n >= 1
    finally:
        db.close()
    isb.delete(f"/api/threats/vulnerabilities/{v['id']}")
    isb.delete(f"/api/threats/advisories/{a['id']}")


def test_check_rules(login):
    isb = login("isb@demo.local")
    ents = _entities(isb)
    a = isb.post(
        "/api/threats/advisories",
        json={
            "title": "Test advisory: overdue check",
            "source": "other",
            "received_on": (date.today() - timedelta(days=30)).isoformat(),
            "severity": "low",
            "entity_scope": "all",
            "assessment_due": (date.today() - timedelta(days=1)).isoformat(),
        },
    ).json()
    v = isb.post(
        "/api/threats/vulnerabilities",
        json={
            "title": "Test vuln: overdue check",
            "entity_id": ents["ATL"],
            "severity": "medium",
            "discovered_on": (date.today() - timedelta(days=120)).isoformat(),
            "status": "open",
        },
    ).json()

    results = isb.get("/api/checks").json()["rules"]
    t1 = next(r for r in results if r["code"] == "T1")
    t2 = next(r for r in results if r["code"] == "T2")
    assert t1["count"] >= 1 and any(a["code"] in it["label"] for it in t1["items"])
    assert t2["count"] >= 1 and any(v["code"] in it["label"] for it in t2["items"])

    isb.delete(f"/api/threats/vulnerabilities/{v['id']}")
    isb.delete(f"/api/threats/advisories/{a['id']}")


def test_computed_kpis_registered(login):
    isb = login("isb@demo.local")
    defs = isb.get("/api/controls/kpis/definitions").json()
    codes = {d["code"] for d in defs["items"]}
    assert {"VULN-OPEN-CH", "VULN-MTTR-CRIT"} <= codes
