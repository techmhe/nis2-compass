"""Audits & reviews module: audit programme/audits/findings, effectiveness reviews, management reviews."""

from datetime import date, timedelta


def _ents(client) -> dict[str, dict]:
    return {e["code"]: e for e in client.get("/api/entities").json()}


def _req_id(client, number: str) -> int:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Requirement

    with SessionLocal() as db:
        return db.scalar(select(Requirement.id).where(Requirement.number == number))


def _create_audit(client, entity_id, **overrides) -> dict:
    body = {
        "type": "internal",
        "entity_id": entity_id,
        "scope": "Test scope",
        "planned_start": "2026-05-01",
        "planned_end": "2026-05-15",
    }
    body.update(overrides)
    r = client.post("/api/audits/audits", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------- programme / audits CRUD


def test_programme_and_audit_crud(login):
    isb = login("isb@demo.local")
    ents = _ents(isb)
    year = 2031
    r = isb.post("/api/audits/programmes", json={"year": year, "title": "Test programme", "scope": "x"})
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    assert isb.post("/api/audits/programmes", json={"year": year, "title": "dup"}).status_code == 409

    a = _create_audit(isb, ents["ATL"]["id"], programme_id=pid, scope="Access control review")
    assert a["code"].startswith("AUD-2026-")
    aid = a["id"]
    r = isb.put(
        f"/api/audits/audits/{aid}",
        json={
            **a,
            "status": "in_progress",
            "planned_start": a["planned_start"],
            "planned_end": a["planned_end"],
        },
    )
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    # invalid dates
    bad = {**a, "planned_end": "2026-04-01"}
    assert isb.put(f"/api/audits/audits/{aid}", json=bad).status_code == 422

    # a second audit in the same year gets a sequential code
    a2 = _create_audit(isb, ents["ATL"]["id"], scope="Second audit")
    assert a2["code"] != a["code"]

    # the programme still has audit `a` linked to it
    assert isb.delete(f"/api/audits/programmes/{pid}").status_code == 400
    assert isb.delete(f"/api/audits/audits/{aid}").status_code == 200
    assert isb.delete(f"/api/audits/audits/{a2['id']}").status_code == 200
    assert isb.delete(f"/api/audits/programmes/{pid}").status_code == 200


def test_audit_group_wide_and_partial_update(login):
    isb = login("isb@demo.local")
    a = _create_audit(isb, None, scope="Group-wide governance audit", type="authority")
    assert a["entity"] is None and a["can_edit"] is True
    r = isb.patch(f"/api/audits/audits/{a['id']}", json={"summary": "Interim summary"})
    assert (
        r.status_code == 200 and r.json()["summary"] == "Interim summary" and r.json()["scope"] == a["scope"]
    )
    isb.delete(f"/api/audits/audits/{a['id']}")


# --------------------------------------------------------------------------- findings


def test_finding_lifecycle_and_action_item(login):
    isb = login("isb@demo.local")
    ents = _ents(isb)
    a = _create_audit(isb, ents["ATL"]["id"], scope="Finding lifecycle test")
    rid = _req_id(isb, "9.1")
    r = isb.post(
        f"/api/audits/audits/{a['id']}/findings",
        json={
            "type": "minor_nonconformity",
            "description": "Evidence missing",
            "requirement_id": rid,
            "due_date": (date.today() + timedelta(days=10)).isoformat(),
        },
    )
    assert r.status_code == 200, r.text
    f = r.json()
    assert f["number"] == "F1" and f["status"] == "open" and f["entity"]["code"] == "ATL"

    # a second finding without a requirement cannot spawn an action item without choosing one
    r2 = isb.post(
        f"/api/audits/audits/{a['id']}/findings", json={"type": "observation", "description": "No req"}
    )
    f2 = r2.json()
    assert f2["number"] == "F2"
    assert isb.post(f"/api/audits/findings/{f2['id']}/create-action-item", json={}).status_code == 422
    r = isb.post(f"/api/audits/findings/{f2['id']}/create-action-item", json={"requirement_id": rid})
    assert r.status_code == 200 and r.json()["action_item_id"] and r.json()["status"] == "action_planned"

    # closing requires a completed linked action or an explicit closure note
    assert isb.post(f"/api/audits/findings/{f2['id']}/close", json={}).status_code == 422
    r = isb.post(f"/api/audits/findings/{f2['id']}/close", json={"closure_note": "Verified fixed"})
    assert r.status_code == 200 and r.json()["status"] == "closed" and r.json()["closed_by"]

    # a finding without a linked action closes with a note too, and can be reopened
    r = isb.post(f"/api/audits/findings/{f['id']}/close", json={"closure_note": "No action needed"})
    assert r.status_code == 200
    r = isb.post(f"/api/audits/findings/{f['id']}/reopen", json={})
    assert r.status_code == 200 and r.json()["status"] == "open"

    # creating a second action item from the same finding is rejected
    assert isb.post(f"/api/audits/findings/{f2['id']}/create-action-item", json={}).status_code == 409
    isb.delete(f"/api/audits/audits/{a['id']}")


def test_finding_entity_scope_can_differ_from_audit(login):
    isb = login("isb@demo.local")
    ents = _ents(isb)
    a = _create_audit(isb, None, scope="Group audit with entity-specific findings")
    r = isb.post(
        f"/api/audits/audits/{a['id']}/findings",
        json={"type": "observation", "description": "ATN specific", "entity_id": ents["ATN"]["id"]},
    )
    assert r.status_code == 200 and r.json()["entity"]["code"] == "ATN"
    isb.delete(f"/api/audits/audits/{a['id']}")


# --------------------------------------------------------------------------- effectiveness review + approval


def test_effectiveness_review_requires_content_before_approval(login):
    isb = login("isb@demo.local")
    ents = _ents(isb)
    r = isb.post(
        "/api/audits/effectiveness-reviews",
        json={"entity_id": ents["ATS"]["id"], "period": "2031", "rows": []},
    )
    assert r.status_code == 200
    rid = r.json()["id"]
    admin = login("admin@example.local", "Admin-Password-2026!")
    body = {"target_type": "effectiveness_review", "target_id": rid, "approver_user_id": admin.me["id"]}
    assert isb.post("/api/approvals", json=body).status_code == 400  # no chapter row yet

    r = isb.put(
        f"/api/audits/effectiveness-reviews/{rid}",
        json={
            "rows": [{"chapter": 9, "rating": "partially_effective", "rationale": "MFA rollout incomplete"}]
        },
    )
    assert r.status_code == 200
    assert isb.post("/api/approvals", json=body).status_code == 400  # still no conclusion

    r = isb.put(
        f"/api/audits/effectiveness-reviews/{rid}", json={"conclusion": "Overall partially effective."}
    )
    assert r.status_code == 200 and r.json()["status"] == "draft"

    r = isb.post("/api/approvals", json=body)
    assert r.status_code == 200, r.text
    req_id = r.json()["id"]
    assert isb.get(f"/api/audits/effectiveness-reviews/{rid}").json()["status"] == "in_review"
    # a second approval request cannot be made while one is already pending
    assert isb.post("/api/approvals", json=body).status_code == 409

    r = admin.post(f"/api/approvals/{req_id}/decide", json={"decision": "approved"})
    assert r.status_code == 200, r.text
    detail = isb.get(f"/api/audits/effectiveness-reviews/{rid}").json()
    assert detail["status"] == "approved" and detail["approved_by"] and detail["can_edit"] is False
    assert isb.put(f"/api/audits/effectiveness-reviews/{rid}", json={"conclusion": "no"}).status_code == 400
    assert isb.delete(f"/api/audits/effectiveness-reviews/{rid}").status_code == 400


def test_collect_inputs_aggregate(login):
    isb = login("isb@demo.local")
    ents = _ents(isb)
    r = isb.post("/api/audits/effectiveness-reviews", json={"entity_id": ents["ATL"]["id"], "period": "2032"})
    rid = r.json()["id"]
    r = isb.get(f"/api/audits/effectiveness-reviews/{rid}/collect-inputs")
    assert r.status_code == 200
    body = r.json()
    for key in ("gap", "action_plan", "kpis_off_target", "incidents_last_12_months", "audit_findings_open"):
        assert key in body
    isb.delete(f"/api/audits/effectiveness-reviews/{rid}")


# --------------------------------------------------------------------------- management reviews


def test_management_review_decision_creates_task(login):
    isb = login("isb@demo.local")
    ents = _ents(isb)
    r = isb.get("/api/audits/management-reviews/input-checklist")
    assert r.status_code == 200 and len(r.json()) == 9 and r.json()[0]["key"] == "a"

    r = isb.post(
        "/api/audits/management-reviews",
        json={
            "date": date.today().isoformat(),
            "entity_id": ents["ATL"]["id"],
            "participants": "ISO, CEO",
            "inputs": [{"key": "e", "notes": "Two internal audits performed"}],
            "decisions": [{"text": "Roll out MFA for service accounts", "owner": "IT", "due": "2026-12-31"}],
        },
    )
    assert r.status_code == 200, r.text
    mid = r.json()["id"]
    assert r.json()["inputs"][0]["key"] == "e"

    r = isb.post(f"/api/audits/management-reviews/{mid}/decisions/0/create-task", json={})
    assert r.status_code == 200, r.text
    assert r.json()["decisions"][0]["task_id"]
    task_id = r.json()["decisions"][0]["task_id"]
    assert isb.get(f"/api/tasks/{task_id}").status_code == 200
    # a second task for the same decision is rejected
    assert (
        isb.post(f"/api/audits/management-reviews/{mid}/decisions/0/create-task", json={}).status_code == 409
    )
    assert (
        isb.post(f"/api/audits/management-reviews/{mid}/decisions/9/create-task", json={}).status_code == 404
    )
    isb.delete(f"/api/audits/management-reviews/{mid}")


def test_management_review_future_date_rejected(login):
    isb = login("isb@demo.local")
    future = (date.today() + timedelta(days=2)).isoformat()
    r = isb.post("/api/audits/management-reviews", json={"date": future, "entity_id": None})
    assert r.status_code == 422


# --------------------------------------------------------------------------- scoping and permissions


def test_entity_scoping(login):
    isb, nl = login("isb@demo.local"), login("nl.contact@demo.local")
    ents = _ents(isb)
    pg_audit = _create_audit(isb, ents["ATL"]["id"], scope="ATL scoping test")
    assert nl.get(f"/api/audits/audits/{pg_audit['id']}").status_code == 403
    assert all(
        a["entity"]["code"] in ("ATN", "ATC") for a in nl.get("/api/audits/audits").json() if a["entity"]
    )
    assert (
        nl.post(
            "/api/audits/audits",
            json={
                "type": "internal",
                "entity_id": ents["ATL"]["id"],
                "scope": "x",
                "planned_start": "2026-05-01",
                "planned_end": "2026-05-10",
            },
        ).status_code
        == 403
    )
    # nl.contact can manage its own entities' audits (contributor role: audits.read only, no audits.manage)
    assert (
        nl.post(
            "/api/audits/audits",
            json={
                "type": "internal",
                "entity_id": ents["ATN"]["id"],
                "scope": "x",
                "planned_start": "2026-05-01",
                "planned_end": "2026-05-10",
            },
        ).status_code
        == 403
    )
    isb.delete(f"/api/audits/audits/{pg_audit['id']}")

    r = isb.post("/api/audits/effectiveness-reviews", json={"entity_id": ents["ATL"]["id"], "period": "2033"})
    rid = r.json()["id"]
    assert nl.get(f"/api/audits/effectiveness-reviews/{rid}").status_code == 403
    isb.delete(f"/api/audits/effectiveness-reviews/{rid}")


def test_read_only_permissions(login):
    isb, viewer = login("isb@demo.local"), login("viewer@demo.local")
    ents = _ents(isb)
    assert viewer.get("/api/audits/audits").status_code == 200
    assert (
        viewer.post(
            "/api/audits/audits",
            json={
                "type": "internal",
                "entity_id": ents["ATL"]["id"],
                "scope": "x",
                "planned_start": "2026-05-01",
                "planned_end": "2026-05-10",
            },
        ).status_code
        == 403
    )
    assert viewer.post("/api/audits/programmes", json={"year": 2099, "title": "x"}).status_code == 403
    assert viewer.get("/api/audits/effectiveness-reviews").status_code == 200
    assert viewer.post("/api/audits/effectiveness-reviews", json={"period": "2034"}).status_code == 403
    assert (
        viewer.post("/api/audits/management-reviews", json={"date": date.today().isoformat()}).status_code
        == 403
    )


def test_demo_seed_present(login):
    isb = login("isb@demo.local")
    progs = isb.get("/api/audits/programmes").json()
    assert any(p["year"] == 2026 for p in progs)
    audits = isb.get("/api/audits/audits").json()
    assert sum(1 for a in audits if a["code"].startswith("AUD-2026-")) >= 2
    findings = isb.get("/api/audits/findings").json()
    assert sum(1 for f in findings if f["audit_code"] == "AUD-2026-01") >= 3
    reviews = isb.get("/api/audits/effectiveness-reviews").json()
    assert any(r["period"] == "2026" and r["status"] == "draft" for r in reviews)


def test_reminders_run(login):
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.features.audits.reminders import run_audit_reminders
    from app.models import Notification

    login("isb@demo.local")
    with SessionLocal() as db:
        n1 = run_audit_reminders(db)
        assert n1 >= 1  # demo data has an overdue finding
        from sqlalchemy import func

        before = db.scalar(select(func.count(Notification.id)))
        run_audit_reminders(db)  # deduplicated per day
        assert db.scalar(select(func.count(Notification.id))) == before
