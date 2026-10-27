import io
import zipfile


def test_management_report_and_snapshot(login):
    isb = login("isb@demo.local")
    r = isb.get("/api/reports/management")
    assert r.status_code == 200
    d = r.json()
    assert d["totals"]["in_scope"] > 0 and len(d["chapters"]) == 17
    snap = isb.post("/api/reports/snapshots", json={"kind": "management"})
    assert snap.status_code == 200
    got = isb.get(f"/api/reports/snapshots/{snap.json()['id']}").json()
    assert got["data"]["title"].startswith("NIS-2 management report")


def test_report_respects_entity_scope(login):
    nl = login("nl.contact@demo.local")
    d = nl.get("/api/reports/management").json()
    assert {e["code"] for e in d["entities"]} <= {"ATN", "ATC"}
    ents = {e["code"]: e for e in login("isb@demo.local").get("/api/entities").json()}
    assert nl.get("/api/reports/management", params={"entity_id": ents["ATL"]["id"]}).status_code == 403
    # snapshots are only available to report exporters
    assert nl.get("/api/reports/snapshots").status_code == 403


def test_soa(login):
    isb = login("isb@demo.local")
    d = isb.get("/api/reports/soa").json()
    controls = [r for r in d["rows"] if r["kind"] == "control"]
    assert len(controls) == 93
    a5_1 = next(r for r in controls if r["key"] == "A.5.1")
    assert "1.1.1" in a5_1["requirements"]


def test_evidence_pack(login):
    isb = login("isb@demo.local")
    ents = {e["code"]: e for e in isb.get("/api/entities").json()}
    r = isb.get("/api/reports/evidence-pack", params={"entity_id": ents["ATL"]["id"]})
    assert r.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = z.namelist()
    assert {"answers.csv", "action_plan.csv", "documents.csv", "index.html"} <= set(names)
    assert any(n.startswith("documents/") for n in names)
    viewer = login("viewer@demo.local")
    assert (
        viewer.get("/api/reports/evidence-pack", params={"entity_id": ents["ATL"]["id"]}).status_code == 403
    )


def test_seed_indexes_core_and_feature_sources(login):
    isb = login("isb@demo.local")
    doc_hits = isb.get(
        "/api/search", params={"q": "Backup and Recovery Guideline", "types": ["document"]}
    ).json()
    assert doc_hits, "seeded documents must be searchable"
    req_hits = isb.get("/api/search", params={"q": "3.2.1", "types": ["requirement"]}).json()
    assert req_hits
    sup_hits = isb.get("/api/search", params={"q": "NordIT", "types": ["supplier"]}).json()
    assert sup_hits, "feature module objects must be searchable"


def test_evidence_pack_includes_hq_answers_for_central_rows(login):
    isb = login("isb@demo.local")
    ents = {e["code"]: e for e in isb.get("/api/entities").json()}
    r = isb.get("/api/reports/evidence-pack", params={"entity_id": ents["ATS"]["id"], "include_files": False})
    assert r.status_code == 200
    csv_text = zipfile.ZipFile(io.BytesIO(r.content)).read("answers.csv").decode("utf-8-sig")
    header, *rows = csv_text.splitlines()
    assert "Operated by HQ: implemented" in header
    central = [row for row in rows if ";Central at HQ;" in row]
    assert central, "demo data has central-at-HQ rows for ATS"
    assert any(row.split(";")[16] for row in central), "HQ answer values are filled in"


def test_management_report_pdf(login):
    isb = login("isb@demo.local")
    r = isb.get("/api/reports/management.pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    assert login("nl.contact@demo.local").get("/api/reports/management.pdf").status_code == 403


def test_every_report_section_has_the_shared_shape(login):
    """Feature modules add sections via reports.register_section; the UI and the PDF expect title, items, notes."""
    sections = login("isb@demo.local").get("/api/reports/management").json()["sections"]
    assert "audits" in sections  # demo data has open audit findings
    for key, s in sections.items():
        assert isinstance(s.get("title"), str), key
        assert isinstance(s.get("items"), list), key
        assert all({"label", "value"} <= set(it) for it in s["items"]), key
        assert isinstance(s.get("notes", []), list), key
