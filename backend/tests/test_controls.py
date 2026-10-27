"""Recurring controls, evidence freshness, exceptions and KPIs (features/controls)."""

from datetime import date, timedelta

import pytest

from app.features.controls.evidence import classify
from app.features.controls.kpi import period_bounds, period_of, recent_periods, status_of, valid_period
from app.features.controls.models import ControlActivity
from app.features.controls.schedule import RRuleError, parse_rrule, periods


def _ents(c) -> dict[str, int]:
    return {e["code"]: e["id"] for e in c.get("/api/entities").json()}


def _users(c) -> dict[str, int]:
    return {u["email"]: u["id"] for u in c.get("/api/users/directory").json()}


def _req_id(c, number: str) -> int:
    return next(r["id"] for r in c.get("/api/requirements").json() if r["number"] == number)


# --- pure functions ------------------------------------------------------------------------------------------


def test_standard_periods():
    a = ControlActivity(recurrence="quarterly", anchor_month=2)
    ps = periods(a, date(2026, 1, 1), date(2026, 12, 31))
    assert [p.key for p in ps] == ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]
    assert [p.due for p in ps] == [
        date(2026, 2, 28),
        date(2026, 5, 31),
        date(2026, 8, 31),
        date(2026, 11, 30),
    ]
    a = ControlActivity(recurrence="annual", anchor_month=3)
    assert [(p.key, p.due) for p in periods(a, date(2026, 1, 1), date(2027, 12, 31))] == [
        ("2026", date(2026, 3, 31)),
        ("2027", date(2027, 3, 31)),
    ]
    a = ControlActivity(recurrence="semi_annual", anchor_month=6)
    assert [p.key for p in periods(a, date(2026, 7, 1), date(2027, 7, 1))] == ["2026-H2", "2027-H1"]
    a = ControlActivity(recurrence="monthly", anchor_month=1)
    assert len(periods(a, date(2026, 1, 1), date(2026, 12, 31))) == 12


def test_custom_rrule():
    a = ControlActivity(recurrence="custom", rrule="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;DTSTART=20260105")
    ps = periods(a, date(2026, 1, 1), date(2026, 2, 28))
    assert [p.due for p in ps] == [date(2026, 1, 5), date(2026, 1, 19), date(2026, 2, 2), date(2026, 2, 16)]
    assert all(p.due.weekday() == 0 for p in ps)
    a = ControlActivity(recurrence="custom", rrule="FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15;DTSTART=20260201")
    assert [p.due for p in periods(a, date(2026, 1, 1), date(2026, 12, 31))] == [
        date(2026, 2, 15),
        date(2026, 5, 15),
        date(2026, 8, 15),
        date(2026, 11, 15),
    ]
    a = ControlActivity(recurrence="custom", rrule="FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1")
    assert [p.due for p in periods(a, date(2027, 1, 1), date(2028, 12, 31))] == [
        date(2027, 2, 28),
        date(2028, 2, 29),
    ]
    for bad in (
        "FREQ=DAILY",
        "FREQ=WEEKLY;BYDAY=XX",
        "FREQ=MONTHLY;BYMONTHDAY=40",
        "FREQ=YEARLY;COUNT=3",
        "nonsense",
    ):
        with pytest.raises(RRuleError):
            parse_rrule(bad)


def test_freshness_and_kpi_helpers():
    ref = date(2026, 9, 29)
    assert classify(None, 365, ref) == ("none", None)
    assert classify(ref - timedelta(days=10), 100, ref) == ("fresh", 10)
    assert classify(ref - timedelta(days=90), 100, ref)[0] == "ageing"
    assert classify(ref - timedelta(days=101), 100, ref)[0] == "stale"
    assert period_of("quarterly", ref) == "2026-Q3" and period_of("monthly", ref) == "2026-09"
    assert period_bounds("2026-Q3") == (date(2026, 7, 1), date(2026, 9, 30))
    assert recent_periods("quarterly", ref, 3) == ["2026-Q1", "2026-Q2", "2026-Q3"]
    assert recent_periods("monthly", date(2026, 1, 15), 2) == ["2025-12", "2026-01"]
    assert valid_period("monthly", "2026-09") and not valid_period("monthly", "2026-Q3")
    assert not valid_period("quarterly", "2026-Q5")
    assert status_of("higher", 96, 95) == "met" and status_of("lower", 6, 5) == "missed"
    assert status_of("lower", None, 5) == "no_data" and status_of("higher", 1, None) == "no_target"


# --- activities, generator and occurrences -------------------------------------------------------------------


def test_activity_rbac_and_generator(login):
    isb, pm, viewer, nl = (
        login(e) for e in ("isb@demo.local", "pm@demo.local", "viewer@demo.local", "nl.contact@demo.local")
    )
    ents = _ents(isb)
    body = {
        "title": "Test: quarterly badge review",
        "requirement_ids": [_req_id(isb, "13.3.1")],
        "recurrence": "quarterly",
        "anchor_month": 3,
        "entity_scope": "list",
        "entity_ids": [ents["ATL"], ents["ATN"]],
        "evidence_validity_days": 100,
    }
    assert viewer.post("/api/controls/activities", json=body).status_code == 403
    assert nl.post("/api/controls/activities", json=body).status_code == 403
    r = pm.post("/api/controls/activities", json=body)
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["code"].startswith("CA-") and [e["code"] for e in a["entities"]] == ["ATL", "ATN"]
    occ = isb.get(f"/api/controls/occurrences?activity_id={a['id']}").json()
    # 12-month horizon: 4 or 5 quarters x 2 entities, all planned and in the future
    assert len(occ) in (8, 10) and {o["entity"]["code"] for o in occ} == {"ATL", "ATN"}
    assert all(o["status"] == "planned" for o in occ)
    assert isb.post(f"/api/controls/activities/{a['id']}/generate").json() == {"created": 0, "removed": 0}
    # nl.contact only sees the ATN occurrences
    nl_occ = nl.get(f"/api/controls/occurrences?activity_id={a['id']}").json()
    assert nl_occ and {o["entity"]["code"] for o in nl_occ} == {"ATN"}
    pg_occ = next(o for o in occ if o["entity"]["code"] == "ATL")
    assert nl.get(f"/api/controls/occurrences/{pg_occ['id']}").status_code == 403
    # switching to annual replaces the untouched future occurrences
    r = isb.put(
        f"/api/controls/activities/{a['id']}", json={**body, "recurrence": "annual", "anchor_month": 12}
    )
    assert r.status_code == 200
    occ2 = isb.get(f"/api/controls/occurrences?activity_id={a['id']}").json()
    assert {o["period_key"][:4] for o in occ2} <= {str(date.today().year), str(date.today().year + 1)}
    assert all("Q" not in o["period_key"] for o in occ2) and len(occ2) in (2, 4)
    # invalid custom rule
    bad = isb.post("/api/controls/activities", json={**body, "recurrence": "custom", "rrule": "FREQ=HOURLY"})
    assert bad.status_code == 422
    # calendar for the viewer (read-only)
    cal = viewer.get("/api/controls/calendar?months=12").json()
    assert len(cal["months"]) == 12 and any(r["activity"]["id"] == a["id"] for r in cal["rows"])
    # delete works while nothing was recorded
    assert viewer.delete(f"/api/controls/activities/{a['id']}").status_code == 403
    assert isb.delete(f"/api/controls/activities/{a['id']}").status_code == 200


def test_record_occurrence_finding_and_owner(login):
    isb, viewer, nl = login("isb@demo.local"), login("viewer@demo.local"), login("nl.contact@demo.local")
    ents, users = _ents(isb), _users(isb)
    req = _req_id(isb, "12.2.3")
    a = isb.post(
        "/api/controls/activities",
        json={
            "title": "Test: media handling check",
            "requirement_ids": [req],
            "recurrence": "monthly",
            "entity_scope": "list",
            "entity_ids": [ents["ATL"], ents["ATN"]],
            "owner_user_id": users["nl.contact@demo.local"],
            "evidence_validity_days": 60,
        },
    ).json()
    occ = isb.get(f"/api/controls/occurrences?activity_id={a['id']}").json()
    atl = next(o for o in occ if o["entity"]["code"] == "ATL")
    atn = next(o for o in occ if o["entity"]["code"] == "ATN")
    assert (
        viewer.put(
            f"/api/controls/occurrences/{atl['id']}", json={"status": "done", "result": "effective"}
        ).status_code
        == 403
    )
    # the owner (contributor scoped to ATN) may record ATN but not ATL
    assert (
        nl.put(
            f"/api/controls/occurrences/{atl['id']}", json={"status": "done", "result": "effective"}
        ).status_code
        == 403
    )
    r = nl.put(
        f"/api/controls/occurrences/{atn['id']}",
        json={"status": "done", "result": "effective", "notes": "ok"},
    )
    assert r.status_code == 200, r.text
    assert (
        r.json()["occurrence"]["status"] == "done"
        and r.json()["occurrence"]["performed_by_name"] == "Daan de Vries"
    )
    # done needs a result, skipped needs a reason, not effective needs a finding
    assert isb.put(f"/api/controls/occurrences/{atl['id']}", json={"status": "done"}).status_code == 422
    assert isb.put(f"/api/controls/occurrences/{atl['id']}", json={"status": "skipped"}).status_code == 422
    assert (
        isb.put(
            f"/api/controls/occurrences/{atl['id']}", json={"status": "done", "result": "not_effective"}
        ).status_code
        == 422
    )
    future = (date.today() + timedelta(days=3)).isoformat()
    assert (
        isb.put(
            f"/api/controls/occurrences/{atl['id']}",
            json={"status": "done", "result": "effective", "performed_at": future},
        ).status_code
        == 422
    )
    r = isb.put(
        f"/api/controls/occurrences/{atl['id']}",
        json={
            "status": "done",
            "result": "not_effective",
            "create_finding": True,
            "notes": "Unlabelled media found",
        },
    )
    assert r.status_code == 200, r.text
    ap = r.json()["action_item"]
    assert ap and ap["code"].startswith("AP-")
    items = isb.get("/api/action-items").json()
    assert next(i for i in items if i["id"] == ap["id"])["entity"]["code"] == "ATL"
    # evidence freshness: ATN answer for the linked requirement now has fresh control evidence
    asms = isb.get("/api/assessments").json()
    rid = max(x["round_id"] for x in asms)
    asm = next(x for x in asms if x["entity"]["code"] == "ATN" and x["round_id"] == rid)
    fr = isb.get(f"/api/controls/freshness?assessment_id={asm['id']}").json()
    row = next(i for i in fr["items"] if i["requirement_id"] == req)
    assert row["status"] == "fresh" and row["source"] == "control" and row["validity_days"] == 60
    # the ATL answer only has a not effective occurrence -> no control evidence
    asm_pg = next(x for x in asms if x["entity"]["code"] == "ATL" and x["round_id"] == rid)
    row = next(
        i
        for i in isb.get(f"/api/controls/freshness?assessment_id={asm_pg['id']}").json()["items"]
        if i["requirement_id"] == req
    )
    assert row["status"] in ("none", "stale", "ageing", "fresh") and row["source"] != "control"
    # nl.contact cannot read the ATL assessment's freshness
    assert nl.get(f"/api/controls/freshness?assessment_id={asm_pg['id']}").status_code == 403
    # recorded occurrences block deletion of the activity
    assert isb.delete(f"/api/controls/activities/{a['id']}").status_code == 400
    ev = nl.get("/api/controls/evidence").json()
    assert {s["entity"]["code"] for s in ev["summary"]} <= {"ATN", "ATC"}


def test_exceptions_four_eyes(login):
    isb, pm, viewer, nl = (
        login(e) for e in ("isb@demo.local", "pm@demo.local", "viewer@demo.local", "nl.contact@demo.local")
    )
    ents, users = _ents(isb), _users(isb)
    body = {
        "title": "Test exception",
        "scope_type": "requirement",
        "entity_id": ents["ATS"],
        "requirement_id": _req_id(isb, "11.7.1"),
        "reason": "Legacy system",
        "compensating_measures": "Isolation",
        "approver_id": users["isb@demo.local"],
        "expires_at": (date.today() + timedelta(days=90)).isoformat(),
    }
    assert isb.post("/api/controls/exceptions", json=body).status_code == 422  # own approver
    assert (
        viewer.post(
            "/api/controls/exceptions", json={**body, "approver_id": users["pm@demo.local"]}
        ).status_code
        == 403
    )
    past = {
        **body,
        "approver_id": users["pm@demo.local"],
        "expires_at": (date.today() - timedelta(days=1)).isoformat(),
    }
    assert isb.post("/api/controls/exceptions", json=past).status_code == 422
    r = isb.post("/api/controls/exceptions", json={**body, "approver_id": users["pm@demo.local"]})
    assert r.status_code == 200, r.text
    x = r.json()
    assert x["status"] == "requested" and x["code"].startswith("EX-")
    assert (
        isb.post(f"/api/controls/exceptions/{x['id']}/decision", json={"decision": "approve"}).status_code
        == 403
    )
    assert (
        pm.post(f"/api/controls/exceptions/{x['id']}/decision", json={"decision": "reject"}).status_code
        == 422
    )
    r = pm.post(f"/api/controls/exceptions/{x['id']}/decision", json={"decision": "approve", "note": "Fine"})
    assert r.status_code == 200 and r.json()["status"] == "approved"
    # a material change sends it back for approval
    r = isb.put(
        f"/api/controls/exceptions/{x['id']}",
        json={**body, "approver_id": users["pm@demo.local"], "reason": "Legacy system, extended"},
    )
    assert r.json()["status"] == "requested"
    # nl.contact sees no ATS exceptions
    assert all(
        e["entity"] is None or e["entity"]["code"] in ("ATN", "ATC")
        for e in nl.get("/api/controls/exceptions").json()["items"]
    )
    assert isb.delete(f"/api/controls/exceptions/{x['id']}").status_code == 200


def test_kpis(login):
    isb, viewer, nl = login("isb@demo.local"), login("viewer@demo.local"), login("nl.contact@demo.local")
    ents = _ents(isb)
    defs = isb.get("/api/controls/kpis/definitions").json()
    assert {"COV", "CTL-ONTIME", "MTTEW", "MFA"} <= {d["code"] for d in defs["items"]}
    ov = viewer.get("/api/controls/kpis/overview").json()
    mfa = next(d for d in ov["items"] if d["code"] == "MFA")
    pg_inst = next(i for i in mfa["instance_rows"] if i["entity"] and i["entity"]["code"] == "ATL")
    pgn_inst = next(i for i in mfa["instance_rows"] if i["entity"] and i["entity"]["code"] == "ATN")
    assert not pg_inst["can_enter"]
    period = recent_periods("quarterly", date.today(), 1)[0]
    assert (
        viewer.put(
            f"/api/controls/kpis/instances/{pg_inst['id']}/values/{period}", json={"value": 90}
        ).status_code
        == 403
    )
    assert (
        isb.put(
            f"/api/controls/kpis/instances/{pg_inst['id']}/values/{period}", json={"value": 120}
        ).status_code
        == 422
    )
    assert (
        isb.put(
            f"/api/controls/kpis/instances/{pg_inst['id']}/values/2030-Q1", json={"value": 90}
        ).status_code
        == 422
    )
    assert (
        isb.put(
            f"/api/controls/kpis/instances/{pg_inst['id']}/values/2026-09", json={"value": 90}
        ).status_code
        == 422
    )
    r = isb.put(
        f"/api/controls/kpis/instances/{pg_inst['id']}/values/{period}",
        json={"value": 98.5, "note": "Entra report"},
    )
    assert r.status_code == 200 and r.json()["source"] == "manual"
    detail = isb.get(f"/api/controls/kpis/instances/{pg_inst['id']}").json()
    assert detail["instance"]["latest"]["value"] == 98.5 and detail["instance"]["status"] == "missed"
    # nl.contact is the demo owner of the ATN instance, but has no rights for ATL
    assert (
        nl.put(f"/api/controls/kpis/instances/{pg_inst['id']}/values/{period}", json={"value": 1}).status_code
        == 403
    )
    r = nl.put(f"/api/controls/kpis/instances/{pgn_inst['id']}/values/{period}", json={"value": 85})
    assert r.status_code == 200, r.text
    grid = isb.get(f"/api/controls/kpis/grid?entity={ents['ATN']}&periods=4").json()
    assert grid["rows"] and all(len(r["periods"]) == 4 for r in grid["rows"])
    assert nl.get(f"/api/controls/kpis/grid?entity={ents['ATL']}").status_code == 403
    tiles = viewer.get("/api/controls/kpis/tiles").json()
    assert tiles and all(t["url"].startswith("/controls/kpis") for t in tiles)
    assert viewer.post("/api/controls/kpis/recompute").status_code == 403
    assert isb.post("/api/controls/kpis/recompute?backfill=2").json()["values"] > 0
    # definitions are group-level: only group-wide managers can create them
    body = {
        "code": "TEST-KPI",
        "name": "Test KPI",
        "unit": "count",
        "direction": "lower",
        "frequency": "monthly",
    }
    assert nl.post("/api/controls/kpis/definitions", json=body).status_code == 403
    r = isb.post("/api/controls/kpis/definitions", json=body)
    assert r.status_code == 200 and r.json()["code"] == "TEST-KPI"
    assert isb.post("/api/controls/kpis/definitions", json=body).status_code == 409
    assert isb.delete(f"/api/controls/kpis/definitions/{r.json()['id']}").status_code == 200


def test_daily_job_idempotent(login):
    from app.db import SessionLocal
    from app.features.controls.jobs import run_daily

    login("isb@demo.local")  # ensures the app (and database) fixtures ran
    db = SessionLocal()
    try:
        run_daily(db)
        second = run_daily(db)
        assert second["occurrences_created"] == 0 and second["occurrences_removed"] == 0
    finally:
        db.close()


def test_summary(login):
    s = login("viewer@demo.local").get("/api/controls/summary").json()
    assert {"overdue", "due_next_30_days", "exceptions_pending"} <= set(s)


# --- security regressions ------------------------------------------------------------------------------------


def test_kpi_non_finite_numbers(login):
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.features.controls.models import MetricInstance, MetricValue

    isb = login("isb@demo.local")
    ents = _ents(isb)
    defs = {d["code"]: d for d in isb.get("/api/controls/kpis/definitions").json()["items"]}
    body = {
        "code": "NAN-TEST",
        "name": "NaN test",
        "unit": "count",
        "frequency": "monthly",
        "create_instances": False,
    }
    raw = '{"code": "NAN-1", "name": "x", "default_target": NaN}'
    r = isb.post("/api/controls/kpis/definitions", content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    d = isb.post("/api/controls/kpis/definitions", json=body).json()
    for bad in ("NaN", "Infinity"):
        payload = f'{{"definition_id": {d["id"]}, "entity_id": {ents["ATL"]}, "target": {bad}}}'
        r = isb.post(
            "/api/controls/kpis/instances", content=payload, headers={"Content-Type": "application/json"}
        )
        assert r.status_code == 422
    assert (
        isb.post(
            "/api/controls/kpis/definitions", json={**body, "code": "BIG-SORT", "sort_order": 10**12}
        ).status_code
        == 422
    )
    mfa = next(i for i in isb.get("/api/controls/kpis/overview").json()["items"] if i["code"] == "MFA")[
        "instance_rows"
    ][0]
    period = recent_periods("quarterly", date.today(), 1)[0]
    r = isb.put(
        f"/api/controls/kpis/instances/{mfa['id']}/values/{period}",
        content='{"value": NaN}',
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 422
    # legacy non-finite data already stored must not break the pages
    db = SessionLocal()
    try:
        inst = db.get(MetricInstance, mfa["id"])
        inst.target = float("nan")
        db.add(
            MetricValue(
                instance_id=inst.id,
                period="2020-Q1",
                period_end=date(2020, 3, 31),
                value=float("inf"),
                source="manual",
            )
        )
        db.commit()
    finally:
        db.close()
    assert isb.get("/api/controls/kpis/overview").status_code == 200
    assert isb.get("/api/controls/kpis/tiles").status_code == 200
    assert isb.get("/api/controls/kpis/grid?entity=group").status_code == 200
    assert isb.get(f"/api/controls/kpis/instances/{mfa['id']}").status_code == 200
    db = SessionLocal()
    try:
        inst = db.get(MetricInstance, mfa["id"])
        inst.target = defs["MFA"]["default_target"]
        for v in db.scalars(select(MetricValue).where(MetricValue.period == "2020-Q1")):
            db.delete(v)
        db.commit()
    finally:
        db.close()


def test_exception_approver_must_manage(login):
    from app.db import SessionLocal
    from app.features.controls.models import ControlException

    isb, viewer, nl = login("isb@demo.local"), login("viewer@demo.local"), login("nl.contact@demo.local")
    ents, users = _ents(isb), _users(isb)
    body = {
        "title": "Approver test",
        "scope_type": "entity",
        "entity_id": ents["ATN"],
        "reason": "Test",
        "approver_id": users["viewer@demo.local"],
        "expires_at": (date.today() + timedelta(days=30)).isoformat(),
    }
    assert isb.post("/api/controls/exceptions", json=body).status_code == 422
    assert (
        isb.post(
            "/api/controls/exceptions", json={**body, "approver_id": users["nl.contact@demo.local"]}
        ).status_code
        == 422
    )
    x = isb.post("/api/controls/exceptions", json={**body, "approver_id": users["pm@demo.local"]}).json()
    # an approver who lost (or never had) manage rights cannot decide
    db = SessionLocal()
    try:
        db.get(ControlException, x["id"]).approver_id = users["viewer@demo.local"]
        db.commit()
    finally:
        db.close()
    assert (
        viewer.post(f"/api/controls/exceptions/{x['id']}/decision", json={"decision": "approve"}).status_code
        == 403
    )
    assert nl.post(
        f"/api/controls/exceptions/{x['id']}/decision", json={"decision": "approve"}
    ).status_code in (403, 404)
    assert isb.delete(f"/api/controls/exceptions/{x['id']}").status_code == 200


def test_owner_rights_performer_and_evidence(login):
    from app.core.deps import build_principal
    from app.db import SessionLocal
    from app.features.controls.hooks import _my_control_occurrences
    from app.models import User

    isb, viewer, nl = login("isb@demo.local"), login("viewer@demo.local"), login("nl.contact@demo.local")
    ents, users = _ents(isb), _users(isb)
    body = {
        "title": "Owner rights test",
        "recurrence": "monthly",
        "entity_scope": "list",
        "entity_ids": [ents["ATL"], ents["ATN"]],
        "owner_user_id": 999999,
    }
    assert isb.post("/api/controls/activities", json=body).status_code == 422
    assert (
        isb.post(
            "/api/controls/activities",
            json={**body, "recurrence": "custom", "rrule": "FREQ=YEARLY;DTSTART=99991231"},
        ).status_code
        == 422
    )
    a = isb.post(
        "/api/controls/activities", json={**body, "owner_user_id": users["nl.contact@demo.local"]}
    ).json()
    occ = isb.get(f"/api/controls/occurrences?activity_id={a['id']}").json()
    atn = next(o for o in occ if o["entity"]["code"] == "ATN")
    # My work of the owner only lists the entity the owner can see
    db = SessionLocal()
    try:
        pr = build_principal(db.get(User, users["nl.contact@demo.local"]))
        items = [i for i in _my_control_occurrences(db, pr, set()) if i["title"] == "Owner rights test"]
        assert items and {i["entity_code"] for i in items} == {"ATN"}
    finally:
        db.close()
    # the performer cannot be forged by a non-manager
    r = nl.put(
        f"/api/controls/occurrences/{atn['id']}",
        json={"status": "done", "result": "effective", "performed_by_id": users["isb@demo.local"]},
    )
    assert r.status_code == 200 and r.json()["occurrence"]["performed_by_name"] == "Daan de Vries"
    assert (
        nl.put(
            f"/api/controls/occurrences/{atn['id']}",
            json={"status": "done", "result": "effective", "performed_at": "1900-01-01"},
        ).status_code
        == 422
    )
    assert isb.get("/api/controls/calendar?start=9999-12").status_code == 422
    # the owner links evidence through the dedicated endpoint; the generic endpoint stays closed
    doc = next(d for d in nl.get("/api/documents").json() if d["title"] == "Information Security Policy")
    assert (
        nl.post(
            f"/api/documents/{doc['id']}/links",
            json={"target_type": "control_occurrence", "target_id": atn["id"]},
        ).status_code
        == 403
    )
    assert (
        viewer.post(
            f"/api/controls/occurrences/{atn['id']}/evidence", json={"document_id": doc["id"]}
        ).status_code
        == 403
    )
    r = nl.post(f"/api/controls/occurrences/{atn['id']}/evidence", json={"document_id": doc["id"]})
    assert r.status_code == 200 and r.json()[0]["document_id"] == doc["id"]
    link_id = r.json()[0]["link_id"]
    assert (
        nl.post(f"/api/controls/occurrences/{atn['id']}/evidence", json={"document_id": 999999}).status_code
        == 404
    )
    assert nl.delete(f"/api/controls/occurrences/{atn['id']}/evidence/{link_id}").json() == []


def test_freshness_hides_restricted_titles(login):
    isb, nl = login("isb@demo.local"), login("nl.contact@demo.local")
    ents = _ents(isb)
    meta = {
        "title": "Secret restore report",
        "doc_type": "Evidence",
        "classification": "Restricted",
        "entity_id": ents["ATN"],
        "external_url": "https://example.invalid/report",
    }
    import json as _json

    r = isb.c.post("/api/documents", data={"metadata": _json.dumps(meta)}, headers={"X-CSRF-Token": isb.csrf})
    assert r.status_code == 200, r.text
    doc = r.json()
    asms = isb.get("/api/assessments").json()
    rid = max(x["round_id"] for x in asms)
    asm = next(x for x in asms if x["entity"]["code"] == "ATN" and x["round_id"] == rid)
    req = _req_id(isb, "9.1")
    answers = isb.get(f"/api/assessments/{asm['id']}/answers")
    answer_id = (
        next(a["id"] for a in answers.json() if a["requirement_id"] == req)
        if answers.status_code == 200
        else None
    )
    if answer_id is None:
        fr = isb.get(f"/api/controls/freshness?assessment_id={asm['id']}").json()
        answer_id = next(i["answer_id"] for i in fr["items"] if i["requirement_id"] == req)
    assert (
        isb.post(
            f"/api/documents/{doc['id']}/links", json={"target_type": "answer", "target_id": answer_id}
        ).status_code
        == 200
    )
    mine = next(
        i
        for i in isb.get(f"/api/controls/freshness?assessment_id={asm['id']}").json()["items"]
        if i["answer_id"] == answer_id
    )
    theirs = next(
        i
        for i in nl.get(f"/api/controls/freshness?assessment_id={asm['id']}").json()["items"]
        if i["answer_id"] == answer_id
    )
    assert mine["source_label"] == "Secret restore report"
    assert theirs["source"] == "document" and theirs["source_label"] == "Linked document"


def test_kpi_csv_import(login):
    from datetime import date

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.features.controls.kpi import period_of, recent_periods
    from app.features.controls.models import MetricDefinition, MetricInstance, MetricValue

    isb, viewer = login("isb@demo.local"), login("viewer@demo.local")
    db = SessionLocal()
    try:
        inst = db.scalar(
            select(MetricInstance)
            .join(MetricDefinition)
            .where(
                MetricDefinition.computation.is_(None),
                MetricDefinition.unit == "%",
                MetricInstance.entity_id.is_not(None),
            )
        )
        d, ent = inst.definition, inst.entity
        period = recent_periods(d.frequency, date.today(), 2)[0]
        future = period_of(d.frequency, date(date.today().year + 2, 1, 1))
    finally:
        db.close()
    csv_text = (
        "kpi_code;entity_code;period;value;note\n"
        f"{d.code};{ent.code};{period};87,5;from Entra ID\n"
        f"{d.code};{ent.code};{future};50;\n"
        f"{d.code};{ent.code};{period};150;\n"
        f"NOPE;{ent.code};{period};1;\n"
    )
    files = {"file": ("kpis.csv", csv_text.encode(), "text/csv")}
    r = isb.post("/api/controls/kpis/import", files=files)
    assert r.status_code == 200, r.text
    assert r.json()["valid"] == 1 and r.json()["invalid"] == 3
    r = isb.post("/api/controls/kpis/import", params={"dry_run": "false"}, files=files)
    assert r.json()["valid"] == 1
    db = SessionLocal()
    try:
        v = db.scalar(
            select(MetricValue).where(MetricValue.instance_id == inst.id, MetricValue.period == period)
        )
        assert v.value == 87.5 and v.source == "import"
    finally:
        db.close()
    assert (
        viewer.post("/api/controls/kpis/import", params={"dry_run": "false"}, files=files).json()["valid"]
        == 0
    )
