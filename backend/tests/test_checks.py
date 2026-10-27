def test_checks_run_and_respect_permissions(login):
    isb = login("isb@demo.local")
    d = isb.get("/api/checks").json()
    codes = {r["code"] for r in d["rules"]}
    assert {"A1", "F2", "P1", "D1"} <= codes
    nl = login("nl.contact@demo.local")
    ents = {e["code"]: e["id"] for e in isb.get("/api/entities").json()}
    for rule in nl.get("/api/checks").json()["rules"]:
        for item in rule["items"]:
            assert item["entity_id"] in (None, ents["ATN"], ents["ATC"])


def test_evidence_check_requires_ai(login):
    isb = login("isb@demo.local")
    asm = next(a for a in isb.get("/api/assessments").json() if a["entity"]["code"] == "ATL")
    ans = isb.get(f"/api/assessments/{asm['id']}/answers").json()[0]
    assert isb.post(f"/api/ai/assist/evidence-check/{ans['id']}").status_code == 503


def test_intragroup_agreement_check(login):
    isb = login("isb@demo.local")
    rule = next(r for r in isb.get("/api/checks").json()["rules"] if r["code"] == "S1")
    # demo data records HQ Central IT for ATS and ATN, not for ATC (served by an external MSP)
    codes = {i["label"].split()[0] for i in rule["items"]}
    assert "ATS" not in codes and "ATN" not in codes
