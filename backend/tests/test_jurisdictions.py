"""Jurisdiction registry and the entity fields built on it."""

from app.core.jurisdictions import JURISDICTIONS, SECTORS, SIZE_CLASSES, entity_options, get_jurisdiction


def _entity(isb, code, **extra):
    body = {"code": code, "name": f"Test {code}", "finding_prefix": code, **extra}
    return isb.post("/api/entities", json=body)


def test_registry_has_de_and_nl():
    assert set(JURISDICTIONS) == {"DE", "NL"}
    de, nl = JURISDICTIONS["DE"], JURISDICTIONS["NL"]
    assert de.competent_authority == "BSI"
    assert de.csirt == "BSI"
    assert nl.csirt == "CSIRT-DSP / NCSC-NL"
    assert nl.competent_authority == "RDI / sector authority"
    assert "GmbH" in de.legal_forms
    assert "B.V." in nl.legal_forms


def test_unknown_country_returns_none():
    assert get_jurisdiction("FR") is None
    assert get_jurisdiction(None) is None
    assert get_jurisdiction("NL") is JURISDICTIONS["NL"]


def test_registry_portal_matches_registration_default(login):
    isb = login("isb@demo.local")
    ent = _entity(isb, "JNL1", country="NL")
    assert ent.status_code == 200, ent.text
    r = isb.post("/api/governance/registrations", json={"entity_id": ent.json()["id"], "jurisdiction": "NL"})
    assert r.status_code == 200, r.text
    assert r.json()["portal"] == JURISDICTIONS["NL"].portal


def test_registration_rejects_unknown_jurisdiction(login):
    isb = login("isb@demo.local")
    ent = _entity(isb, "JNL2", country="NL")
    r = isb.post("/api/governance/registrations", json={"entity_id": ent.json()["id"], "jurisdiction": "FR"})
    assert r.status_code == 422


def test_entity_accepts_legal_form_and_size_class(login):
    isb = login("isb@demo.local")
    r = _entity(isb, "JDE1", country="DE", legal_form="GmbH", size_class="medium")
    assert r.status_code == 200, r.text
    assert r.json()["legal_form"] == "GmbH"
    assert r.json()["size_class"] == "medium"


def test_entity_rejects_bad_size_class(login):
    isb = login("isb@demo.local")
    assert _entity(isb, "JDE2", size_class="huge").status_code == 422


def test_entity_rejects_unknown_country(login):
    isb = login("isb@demo.local")
    assert _entity(isb, "JFR1", country="FR").status_code == 422


def test_entity_rejects_unknown_sector(login):
    isb = login("isb@demo.local")
    r = _entity(isb, "JSEC1", activity_sector="Manufacturing of machinery")
    assert r.status_code == 422, r.text


def test_entity_accepts_sector_key(login):
    isb = login("isb@demo.local")
    r = _entity(isb, "JSEC2", activity_sector="manufacturing_machinery")
    assert r.status_code == 200, r.text
    assert r.json()["activity_sector"] == "manufacturing_machinery"
    assert _entity(isb, "JSEC3").json()["activity_sector"] is None


def test_nl_manufacturing_key_selects_ezk_profile():
    from app.features.incident_reporting.api import _default_profile
    from app.models import Entity

    def profile(country, sector):
        return _default_profile(Entity(country=country, activity_sector=sector))

    assert profile("NL", "manufacturing_electronics") == "ezk_manufacturing"
    assert profile("NL", "chemicals") == "other"
    assert profile("NL", None) == "other"
    assert profile("DE", "manufacturing_electronics") == "default"


def test_entity_options_lists_registry(login):
    isb = login("isb@demo.local")
    r = isb.get("/api/entities/options")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == entity_options()
    assert {j["code"] for j in body["jurisdictions"]} == set(JURISDICTIONS)
    nl_forms = next(j for j in body["jurisdictions"] if j["code"] == "NL")["legal_forms"]
    assert {"B.V.", "N.V.", "C.V.", "Stichting"} <= set(nl_forms)
    assert {"key": "chemicals", "label": SECTORS["chemicals"]} in body["sectors"]
    assert body["size_classes"] == list(SIZE_CLASSES)


def test_incident_overview_shows_sector_label_not_key(login):
    isb = login("isb@demo.local")
    r = _entity(isb, "SECL", country="NL", activity_sector="chemicals")
    assert r.status_code == 200, r.text
    inc = isb.post(
        "/api/incidents", json={"title": "Sector label", "entity_id": r.json()["id"], "severity": "High"}
    )
    assert inc.status_code == 200, inc.text
    ov = isb.get(f"/api/incident-reporting/incidents/{inc.json()['id']}").json()
    assert ov["affected"][0]["sector"] == SECTORS["chemicals"]


def test_entity_search_text_uses_sector_label(login):
    from app.db import SessionLocal
    from app.models import Entity
    from app.services.indexing import _build

    isb = login("isb@demo.local")
    eid = _entity(isb, "SECX", activity_sector="chemicals").json()["id"]
    with SessionLocal() as db:
        text = _build(db, "entity", db.get(Entity, eid))[0]["content"]
    assert SECTORS["chemicals"] in text and "Sector/activity: chemicals" not in text
