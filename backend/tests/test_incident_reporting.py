"""Significance wizard, report tracks and recurring-incident detection (features/incident_reporting)."""

from datetime import UTC, datetime, timedelta

from app.features.incident_reporting.criteria import criteria_for, evaluate


def _ents(c) -> dict[str, int]:
    return {e["code"]: e["id"] for e in c.get("/api/entities").json()}


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def _incident(c, entity_id: int, title: str, aware: datetime | None, **kw) -> dict:
    r = c.post(
        "/api/incidents",
        json={
            "title": title,
            "entity_id": entity_id,
            "severity": "High",
            "aware_at": _iso(aware) if aware else None,
            **kw,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_evaluate_rules():
    de = {c["key"] for g in criteria_for("DE", "default") for c in g["criteria"]}
    assert {"ir_3_1_a", "ir_3_1_e", "bsig_2_11_a", "ir_3_2"} <= de
    assert evaluate("DE", "default", {"ir_3_1_e": "yes"})[0] == "significant"
    assert evaluate("DE", "default", {"ir_3_1_e": "yes", "ir_3_2": "yes"})[0] == "not_significant"
    assert evaluate("DE", "default", {"ir_3_1_a": "unknown"})[0] == "undetermined"
    all_no = {k: "no" for k in de}
    assert evaluate("DE", "default", all_no)[0] == "not_significant"
    nl_other = {c["key"] for g in criteria_for("NL", "other") for c in g["criteria"]}
    assert nl_other == {"cbw_25_2_a", "cbw_25_2_b"}
    res, met = evaluate("NL", "ezk_manufacturing", {"ezk_12_e": "yes", "cbw_25_2_a": "no"})
    assert res == "significant" and met == ["ezk_12_e"]


def test_wizard_tracks_and_rbac(login):
    isb, viewer, nl = login("isb@demo.local"), login("viewer@demo.local"), login("nl.contact@demo.local")
    ents = _ents(isb)
    aware = datetime.now(UTC) - timedelta(hours=2)
    inc = _incident(isb, ents["ATN"], "Test: loss of line control", aware)
    base = f"/api/incident-reporting/incidents/{inc['id']}"
    ov = isb.get(base).json()
    assert (
        ov["affected"][0]["jurisdiction"] == "NL"
        and ov["affected"][0]["default_profile"] == "ezk_manufacturing"
    )
    assert ov["tracks"] == [] and ov["can_edit"]
    # read-only roles
    assert nl.get(base).status_code == 200  # ATN is in scope of nl.contact
    body = {"entity_id": ents["ATN"], "answers": {"ezk_12_b": "yes"}, "rationale": "SCADA view lost"}
    assert nl.post(f"{base}/assessments", json=body).status_code == 403
    assert viewer.post(f"{base}/assessments", json=body).status_code == 403
    # invalid criteria and unexplained override
    assert isb.post(f"{base}/assessments", json={**body, "answers": {"ir_3_1_a": "yes"}}).status_code == 422
    assert (
        isb.post(
            f"{base}/assessments", json={**body, "result": "not_significant", "rationale": ""}
        ).status_code
        == 422
    )
    r = isb.post(f"{base}/assessments", json=body)
    assert r.status_code == 200, r.text
    ov = r.json()
    a = ov["assessments"][0]
    assert a["result"] == "significant" and a["decided_by"] == "Isabel Schmidt"
    assert a["met_criteria"][0]["label"].startswith("Regeling cyberbeveiliging EZK Art. 12(b)")
    assert len(ov["tracks"]) == 1
    t = ov["tracks"][0]
    assert t["regime"] == "nis2" and t["jurisdiction"] == "NL" and "MijnNCSC" in t["authority"]
    stages = {s["stage"]: s for s in t["stages"]}
    assert list(stages) == ["early_warning", "notification", "final"]
    ew_due = datetime.fromisoformat(stages["early_warning"]["due_at"])
    assert abs((ew_due - aware).total_seconds() - 24 * 3600) < 60
    assert [c["key"] for c in stages["early_warning"]["checklist"]][:3] == [
        "malicious",
        "cross_border",
        "contact",
    ]
    detail = isb.get(f"/api/incidents/{inc['id']}").json()["incident"]
    assert detail["is_significant"] is True and "ATN (NL): significant" in detail["significance_rationale"]
    assert detail["track_count"] == 1 and detail["next_deadline"]["stage"] == "early_warning"
    # submit the early warning
    tid = t["id"]
    future = _iso(datetime.now(UTC) + timedelta(hours=2))
    assert (
        isb.put(
            f"/api/incident-reporting/tracks/{tid}/stages/early_warning", json={"submitted_at": future}
        ).status_code
        == 422
    )
    assert isb.put(f"/api/incident-reporting/tracks/{tid}/stages/progress_x", json={}).status_code == 404
    sub = _iso(datetime.now(UTC) - timedelta(minutes=5))
    r = isb.put(
        f"/api/incident-reporting/tracks/{tid}/stages/early_warning",
        json={
            "submitted_at": sub,
            "reference": "NCSC-TEST-1",
            "checklist": {"malicious": True, "bogus": True},
        },
    )
    assert r.status_code == 200, r.text
    st = {s["stage"]: s for s in r.json()["tracks"][0]["stages"]}
    assert st["early_warning"]["state"] == "submitted"
    assert [c for c in st["early_warning"]["checklist"] if c["done"]] == [
        {"key": "malicious", "label": st["early_warning"]["checklist"][0]["label"], "done": True}
    ]
    assert r.json()["tracks"][0]["reference"] == "NCSC-TEST-1"
    detail = isb.get(f"/api/incidents/{inc['id']}").json()["incident"]
    assert detail["early_warning_at"] is not None  # mirrored into the core reporting clock
    assert any("Early warning submitted" in e["text"] for e in detail["timeline"])
    assert detail["next_deadline"]["stage"] == "notification"
    # intermediate report on request
    r = isb.put(
        f"/api/incident-reporting/tracks/{tid}/stages/intermediate",
        json={"requested_at": sub, "due_override": _iso(datetime.now(UTC) + timedelta(days=5))},
    )
    assert "intermediate" in [s["stage"] for s in r.json()["tracks"][0]["stages"]]
    # additional GDPR track; duplicates rejected; tracks with submissions cannot be deleted
    r = isb.post(f"{base}/tracks", json={"entity_id": ents["ATN"], "regime": "gdpr"})
    assert r.status_code == 200 and {x["regime"] for x in r.json()["tracks"]} == {"nis2", "gdpr"}
    gdpr = next(x for x in r.json()["tracks"] if x["regime"] == "gdpr")
    assert (
        gdpr["authority"] == "Autoriteit Persoonsgegevens"
        and gdpr["stages"][0]["label"] == "Breach notification"
    )
    assert isb.post(f"{base}/tracks", json={"entity_id": ents["ATN"], "regime": "gdpr"}).status_code == 409
    assert isb.delete(f"/api/incident-reporting/tracks/{tid}").status_code == 400
    assert isb.delete(f"/api/incident-reporting/tracks/{gdpr['id']}").status_code == 200
    # nl.contact cannot change tracks; the incident list shows the next deadline
    assert nl.patch(f"/api/incident-reporting/tracks/{tid}", json={"reference": "x"}).status_code == 403
    listed = next(i for i in viewer.get("/api/incidents").json() if i["id"] == inc["id"])
    assert listed["next_deadline"]["stage"] == "notification"


def test_scoping_other_entity(login):
    isb, nl = login("isb@demo.local"), login("nl.contact@demo.local")
    ents = _ents(isb)
    inc = _incident(isb, ents["ATS"], "Test: ATS incident", datetime.now(UTC) - timedelta(hours=1))
    assert nl.get(f"/api/incident-reporting/incidents/{inc['id']}").status_code == 403
    # a DE assessment offers only the DE criteria
    r = isb.post(
        f"/api/incident-reporting/incidents/{inc['id']}/assessments",
        json={"entity_id": ents["ATS"], "answers": {"ezk_12_a": "yes"}},
    )
    assert r.status_code == 422
    r = isb.post(
        f"/api/incident-reporting/incidents/{inc['id']}/assessments",
        json={
            "entity_id": ents["ATS"],
            "answers": {
                k: "no"
                for k in (
                    "ir_3_1_a",
                    "ir_3_1_b",
                    "ir_3_1_c",
                    "ir_3_1_d",
                    "ir_3_1_e",
                    "ir_art4",
                    "bsig_2_11_a",
                    "bsig_2_11_b",
                )
            },
        },
    )
    assert r.status_code == 200
    assert r.json()["assessments"][0]["result"] == "not_significant" and r.json()["tracks"] == []
    assert isb.get(f"/api/incidents/{inc['id']}").json()["incident"]["is_significant"] is False
    # adding an affected entity outside the caller's scope is refused for scoped users; group users may add it
    r = isb.put(
        f"/api/incident-reporting/incidents/{inc['id']}/profile",
        json={"affected_entity_ids": [ents["ATS"], ents["ATN"]], "root_cause_category": "supplier"},
    )
    assert r.status_code == 200 and len(r.json()["affected"]) == 2
    assert (
        isb.put(
            f"/api/incident-reporting/incidents/{inc['id']}/profile", json={"root_cause_category": "nope"}
        ).status_code
        == 422
    )


def test_progress_report_and_final_after_handling(login):
    isb = login("isb@demo.local")
    ents = _ents(isb)
    aware = datetime.now(UTC) - timedelta(days=40)
    inc = _incident(isb, ents["ATL"], "Test: long-running incident", aware)
    base = f"/api/incident-reporting/incidents/{inc['id']}"
    ov = isb.post(
        f"{base}/assessments", json={"entity_id": ents["ATL"], "answers": {"ir_3_1_e": "yes"}}
    ).json()
    tid = ov["tracks"][0]["id"]
    isb.put(
        f"/api/incident-reporting/tracks/{tid}/stages/early_warning",
        json={"submitted_at": _iso(aware + timedelta(hours=10))},
    )
    ov = isb.put(
        f"/api/incident-reporting/tracks/{tid}/stages/notification",
        json={"submitted_at": _iso(aware + timedelta(hours=60))},
    ).json()
    stages = {s["stage"]: s for s in ov["tracks"][0]["stages"]}
    # still open one month after the notification: progress report due (§ 32(2) BSIG), final waits for handling
    assert stages["progress"]["state"] == "overdue"
    assert stages["final"]["due_at"] is None and stages["final"]["state"] == "waiting"
    detail = isb.get(f"/api/incidents/{inc['id']}").json()["incident"]
    r = isb.put(f"/api/incidents/{inc['id']}", json={**_body(detail), "status": "Resolved"})
    assert r.status_code == 200, r.text
    stages = {s["stage"]: s for s in isb.get(base).json()["tracks"][0]["stages"]}
    assert stages["final"]["due_at"] is not None and stages["final"]["state"] == "pending"
    assert isb.get(base).json()["profile"]["handled_at"] is not None


def _body(i: dict) -> dict:
    keys = [
        "title",
        "description",
        "category",
        "severity",
        "status",
        "is_significant",
        "significance_rationale",
        "detected_at",
        "aware_at",
        "early_warning_at",
        "notification_at",
        "intermediate_report_at",
        "final_report_at",
        "authority",
        "authority_reference",
        "suspected_malicious",
        "cross_border_impact",
        "impact",
        "indicators_of_compromise",
        "root_cause",
        "measures",
        "lessons_learned",
        "handler_id",
    ]
    return {**{k: i[k] for k in keys}, "entity_id": i["entity"]["id"] if i["entity"] else None}


def test_recurring_detection(login):
    isb = login("isb@demo.local")
    ents = _ents(isb)
    first = _incident(isb, ents["ATC"], "Test: supplier outage 1", datetime.now(UTC) - timedelta(days=100))
    second = _incident(isb, ents["ATC"], "Test: supplier outage 2", datetime.now(UTC) - timedelta(days=5))
    for inc, loss in ((first, 300_000), (second, 250_000)):
        r = isb.put(
            f"/api/incident-reporting/incidents/{inc['id']}/profile",
            json={"root_cause_category": "supplier", "financial_loss_eur": loss},
        )
        assert r.status_code == 200
    rec = r.json()["recurring"]
    assert (
        rec["count"] >= 2 and rec["combined_loss_eur"] >= 550_000 and rec["meets_financial_criterion"] is True
    )
    groups = isb.get("/api/incident-reporting/recurring").json()
    assert any(g["entity"]["code"] == "ATC" and g["category"] == "supplier" for g in groups)
    crit = isb.get("/api/incident-reporting/criteria").json()
    assert "DE" in crit["criteria"] and "NL" in crit["sector_profiles"]
    assert isinstance(isb.get("/api/incident-reporting/deadlines").json(), list)


# --- security regressions ------------------------------------------------------------------------------------


def test_recurring_only_readable_incidents(login):
    isb, nl = login("isb@demo.local"), login("nl.contact@demo.local")
    ents = _ents(isb)
    atl = _incident(isb, ents["ATL"], "Test: DoS at ATL", datetime.now(UTC) - timedelta(days=20))
    atn = _incident(isb, ents["ATN"], "Test: DoS at ATN", datetime.now(UTC) - timedelta(days=2))
    isb.put(f"/api/incident-reporting/incidents/{atl['id']}/profile", json={"root_cause_category": "dos"})
    r = isb.put(
        f"/api/incident-reporting/incidents/{atn['id']}/profile",
        json={"root_cause_category": "dos", "affected_entity_ids": [ents["ATN"], ents["ATL"]]},
    )
    assert r.json()["recurring"]["count"] >= 2
    rec = nl.get(f"/api/incident-reporting/incidents/{atn['id']}").json()["recurring"]
    assert rec is None or all(i["id"] != atl["id"] for i in rec["incidents"])
    assert all(
        g["entity"]["code"] in ("ATN", "ATC") or all(i["id"] != atl["id"] for i in g["incidents"])
        for g in nl.get("/api/incident-reporting/recurring").json()
    )


def test_stage_and_date_bounds(login):
    isb = login("isb@demo.local")
    ents = _ents(isb)
    r = isb.post(
        "/api/incidents",
        json={"title": "Test: far future", "entity_id": ents["ATL"], "aware_at": "9999-12-31T23:00:00Z"},
    )
    assert r.status_code == 422
    aware = datetime.now(UTC) - timedelta(hours=5)
    inc = _incident(isb, ents["ATL"], "Test: bounds", aware)
    ov = isb.post(
        f"/api/incident-reporting/incidents/{inc['id']}/assessments",
        json={"entity_id": ents["ATL"], "answers": {"ir_3_1_c": "yes"}},
    ).json()
    tid = ov["tracks"][0]["id"]
    too_early = _iso(aware - timedelta(days=3))
    assert (
        isb.put(
            f"/api/incident-reporting/tracks/{tid}/stages/early_warning", json={"submitted_at": too_early}
        ).status_code
        == 422
    )
    assert (
        isb.put(
            f"/api/incident-reporting/tracks/{tid}/stages/intermediate",
            json={"requested_at": _iso(aware), "due_override": "9999-01-01T00:00:00Z"},
        ).status_code
        == 422
    )
    assert (
        isb.patch(
            f"/api/incident-reporting/tracks/{tid}", json={"aware_at": "1900-01-01T00:00:00Z"}
        ).status_code
        == 422
    )
    assert isb.patch(f"/api/incident-reporting/tracks/{tid}", json={"status": "withdrawn"}).status_code == 200
    assert (
        isb.put(
            f"/api/incident-reporting/tracks/{tid}/stages/early_warning",
            json={"submitted_at": _iso(aware + timedelta(hours=1))},
        ).status_code
        == 400
    )
    assert isb.patch(f"/api/incident-reporting/tracks/{tid}", json={"reference": "X"}).status_code == 400
    assert isb.patch(f"/api/incident-reporting/tracks/{tid}", json={"status": "active"}).status_code == 200
    ok = isb.put(
        f"/api/incident-reporting/tracks/{tid}/stages/early_warning",
        json={"submitted_at": _iso(aware + timedelta(hours=1))},
    )
    assert ok.status_code == 200


def test_follow_up_suppliers_tasks_and_risk(login):
    isb, viewer = login("isb@demo.local"), login("viewer@demo.local")
    ents = _ents(isb)
    inc = _incident(
        isb,
        ents["ATS"],
        "Test: supplier VPN compromise",
        None,
        root_cause="Stolen supplier credentials",
        lessons_learned="Enforce MFA for supplier remote access",
    )
    base = f"/api/incident-reporting/incidents/{inc['id']}"
    sup = isb.post(
        "/api/suppliers", json={"name": "Remote Maintenance GmbH", "entity_ids": [ents["ATS"]]}
    ).json()
    ov = isb.put(f"{base}/profile", json={"affected_entity_ids": [], "supplier_ids": [sup["id"]]}).json()
    assert ov["suppliers"] == [{"id": sup["id"], "name": "Remote Maintenance GmbH"}]
    # a profile update without supplier_ids keeps the involved suppliers
    ov = isb.put(f"{base}/profile", json={"affected_entity_ids": [], "root_cause_category": None}).json()
    assert ov["profile"]["supplier_ids"] == [sup["id"]]
    assert (
        isb.put(f"{base}/profile", json={"affected_entity_ids": [], "supplier_ids": [99999999]}).status_code
        == 404
    )

    r = isb.post(
        f"{base}/follow-up-tasks",
        json={"title": "Enforce MFA for supplier remote access", "due_date": "2026-12-31"},
    )
    assert r.status_code == 200, r.text
    task = r.json()["follow_up_tasks"][0]
    assert task["key"].startswith("T-") and task["status"] == "todo"
    assert viewer.post(f"{base}/follow-up-tasks", json={"title": "x"}).status_code in (403, 404)

    draft = isb.get(f"/api/risks/from-incident/{inc['id']}").json()
    assert "Stolen supplier credentials" in draft["scenario"] and draft["entity"]["id"] == ents["ATS"]
    r = isb.post(
        "/api/risks",
        json={
            "entity_id": ents["ATS"],
            "title": draft["title"],
            "scenario": draft["scenario"],
            "source_incident_id": inc["id"],
        },
    )
    assert r.status_code == 200, r.text
    linked = isb.get("/api/risks/linked", params={"target_type": "incident", "target_id": inc["id"]}).json()
    assert [x["id"] for x in linked] == [r.json()["risk"]["id"]]
    isb.delete(f"/api/risks/{r.json()['risk']['id']}")
    isb.delete(f"/api/suppliers/{sup['id']}")


def test_report_draft_prefilled_from_incident(login):
    isb, viewer = login("isb@demo.local"), login("viewer@demo.local")
    ents = _ents(isb)
    inc = _incident(
        isb,
        ents["ATN"],
        "Test: ransomware on file server",
        datetime.now(UTC) - timedelta(hours=1),
        suspected_malicious=True,
        indicators_of_compromise="185.0.0.1",
    )
    base = f"/api/incident-reporting/incidents/{inc['id']}"
    ov = isb.post(f"{base}/tracks", json={"entity_id": ents["ATN"], "regime": "nis2"}).json()
    track = ov["tracks"][0]["id"]
    d = isb.get(f"/api/incident-reporting/tracks/{track}/stages/early_warning/draft").json()
    fields = {f["key"]: f["text"] for f in d["fields"]}
    assert (
        fields["malicious"].startswith("Yes")
        and "contact" in fields
        and fields["recovery"] == "Not yet known."
    )
    n = isb.get(f"/api/incident-reporting/tracks/{track}/stages/notification/draft").json()
    assert {f["key"]: f["text"] for f in n["fields"]}["ioc"] == "185.0.0.1"
    assert isb.get(f"/api/incident-reporting/tracks/{track}/stages/bogus/draft").status_code == 404
    assert viewer.get(f"/api/incident-reporting/tracks/{track}/stages/early_warning/draft").status_code in (
        403,
        404,
    )
