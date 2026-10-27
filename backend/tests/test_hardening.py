"""Regression tests for cross-cutting hardening (audit of the feature modules)."""

import io
import os


def test_out_of_range_ids_and_nul_bytes(login):
    isb = login("isb@demo.local")
    assert isb.get("/api/tasks/99999999999").status_code in (400, 404)
    assert isb.post("/api/tasks", json={"title": "a\u0000b"}).status_code == 400
    assert isb.get("/api/search", params={"q": "a\x00b"}).status_code in (200, 400)


def test_group_level_link_needs_global_write(login):
    isb = login("isb@demo.local")
    nl = login("nl.contact@demo.local")
    req = isb.get("/api/requirements").json()[0]
    # scoped contributors may comment on group-level requirements ...
    r = nl.post(
        "/api/comments",
        params={"target_type": "requirement", "target_id": req["id"]},
        json={"body": "question"},
    )
    assert r.status_code == 200
    # ... but may not attach evidence to them (that changes group-level content)
    docs = nl.get("/api/documents").json()
    assert docs
    r = nl.post(
        f"/api/documents/{docs[0]['id']}/links", json={"target_type": "requirement", "target_id": req["id"]}
    )
    assert r.status_code == 403


def test_report_unknown_round_is_404(login):
    isb = login("isb@demo.local")
    assert isb.get("/api/reports/management", params={"round_id": 999999}).status_code == 404
    assert (
        isb.post("/api/reports/snapshots", json={"kind": "management", "round_id": 999999}).status_code == 404
    )


def test_new_version_of_approved_document_needs_new_approval(login):
    isb = login("isb@demo.local")
    doc = next(d for d in isb.get("/api/documents").json() if d["status"] == "Approved")
    files = {"file": ("v2.txt", io.BytesIO(b"changed policy text"), "text/plain")}
    r = isb.post(f"/api/documents/{doc['id']}/versions", files=files, data={"change_note": "update"})
    assert r.status_code == 200
    assert r.json()["status"] == "In Review"


def test_ai_content_parts_are_normalised():
    from app.services.ai import _text

    assert _text("abc") == "abc"
    assert _text(None) == ""
    assert _text([{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]) == "ab"


def test_tolerant_json_parsing_of_model_output():
    from app.services.ai import parse_json_object

    assert parse_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json_object('Here you go: {"summary": "line1\nline2"} hope it helps') == {
        "summary": "line1\nline2"
    }
    assert parse_json_object("no json") == {"text": "no json"}


def test_truncated_json_is_salvaged():
    from app.services.ai import parse_json_object

    raw = '{"summary": "- a\\n- b", "key_obligations": ["x", "y", "unterminated'
    out = parse_json_object(raw)
    assert out["summary"] == "- a\n- b"
    assert out["key_obligations"] == ["x", "y"]


def test_system_info_shows_certificate_settings_read_only(login, monkeypatch):
    admin = login("admin@example.local", os.environ["NIS2_BOOTSTRAP_ADMIN_PASSWORD"])
    monkeypatch.setenv("TLS_ISSUER", "acme_eab")
    monkeypatch.setenv("ACME_CA_URL", "https://ca.example.internal/acme/directory")
    monkeypatch.setenv("ACME_EAB_HMAC", "secret-mac")
    monkeypatch.setenv("NIS2_EXTRA_CA_CERTS", "acme-ca-root.pem,proxy.crt")
    r = admin.get("/api/admin/system")
    assert r.status_code == 200
    tls = r.json()["tls"]
    assert tls == {
        "issuer": "acme_custom",
        "acme_ca_url": "https://ca.example.internal/acme/directory",
        "eab": True,
        "extra_ca_certs": ["acme-ca-root.pem", "proxy.crt"],
    }
    assert "secret-mac" not in r.text
    monkeypatch.setenv("TLS_ISSUER", "default")
    monkeypatch.setenv("TLS_MODE", "ops@example.com")
    assert admin.get("/api/admin/system").json()["tls"]["issuer"] == "letsencrypt"
    assert login("isb@demo.local").get("/api/admin/system").status_code == 403


def test_absence_deputy_receives_copies_and_preferences_are_validated(login):
    from datetime import date, timedelta

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Notification, User
    from app.services.notify import notify

    isb = login("isb@demo.local")
    assert isb.patch("/api/auth/me", json={"preferences": {"is_admin": True}}).status_code == 422
    assert isb.patch("/api/auth/me", json={"preferences": {"email_notifications": "yes"}}).status_code == 422
    db = SessionLocal()
    try:
        me = db.scalar(select(User).where(User.email == "isb@demo.local"))
        deputy = db.scalar(select(User).where(User.email == "it@demo.local"))
        today = date.today()
        assert (
            isb.put(
                "/api/auth/me/absence",
                json={"start": today.isoformat(), "until": today.isoformat(), "deputy_id": me.id},
            ).status_code
            == 422
        )
        r = isb.put(
            "/api/auth/me/absence",
            json={
                "start": (today - timedelta(days=1)).isoformat(),
                "until": (today + timedelta(days=5)).isoformat(),
                "deputy_id": deputy.id,
            },
        )
        assert r.status_code == 200 and r.json()["preferences"]["absence"]["deputy_id"] == deputy.id
        db.expire_all()
        notify(db, me.id, "assigned", "Deputy test notification", "/tasks", dedupe_key="deputy-test")
        db.commit()
        copies = db.scalars(
            select(Notification).where(
                Notification.user_id == deputy.id, Notification.dedupe_key.like("deputy-test:deputy:%")
            )
        ).all()
        # without a permission to check, the deputy only learns that something arrived
        assert (
            len(copies) == 1 and copies[0].title.startswith("For ") and "Deputy test" not in copies[0].title
        )
        assert isb.delete("/api/auth/me/absence").json()["preferences"].get("absence") is None
    finally:
        db.close()


def test_deputy_without_access_gets_no_item_details(login):
    from datetime import date, timedelta

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Entity, Notification, User
    from app.services.notify import remind_due

    isb = login("isb@demo.local")
    db = SessionLocal()
    try:
        me = db.scalar(select(User).where(User.email == "isb@demo.local"))
        deputy = db.scalar(select(User).where(User.email == "nl.contact@demo.local"))  # scoped to ATN/ATC
        hq = db.scalar(select(Entity).where(Entity.code == "ATL"))
        today = date.today()
        isb.put(
            "/api/auth/me/absence",
            json={
                "start": today.isoformat(),
                "until": (today + timedelta(days=2)).isoformat(),
                "deputy_id": deputy.id,
            },
        )
        db.expire_all()
        remind_due(
            db,
            me.id,
            key="deputy-scope-test",
            due=today - timedelta(days=1),
            today=today,
            what="SECRET-HQ-OBLIGATION",
            link="/governance/obligations?obligation=1",
            perm="governance.read",
            entity_id=hq.id,
        )
        db.commit()
        rows = db.scalars(
            select(Notification).where(
                Notification.user_id == deputy.id, Notification.dedupe_key.like("%deputy-scope-test%")
            )
        ).all()
        assert len(rows) == 1 and "SECRET" not in rows[0].title and rows[0].link is None
    finally:
        isb.delete("/api/auth/me/absence")
        db.close()


def test_entity_details_and_scoped_objects_stay_within_scope(login):
    isb, nl = login("isb@demo.local"), login("nl.contact@demo.local")  # nl: contributor for ATN and ATC only
    ents = {e["code"]: e for e in nl.get("/api/entities").json()}
    assert set(ents) >= {"ATL", "ATN"}  # names and codes of all entities stay available for labels
    assert ents["ATL"]["contact_email"] is None and ents["ATL"]["annual_turnover_meur"] is None
    assert ents["ATN"]["nis2_classification"] is not None
    assert nl.get(f"/api/entities/{ents['ATL']['id']}").status_code == 404
    assert nl.get(f"/api/entities/{ents['ATN']['id']}").status_code == 200
    # tasks cannot be created for entities outside the caller's scope
    assert nl.post("/api/tasks", json={"title": "x", "entity_id": ents["ATL"]["id"]}).status_code == 403
    # control activities limited to other entities are hidden, and entity lists are filtered
    pg_only = isb.post(
        "/api/controls/activities",
        json={
            "title": "Test activity ATL only",
            "entity_scope": "list",
            "entity_ids": [ents["ATL"]["id"]],
            "recurrence": "annual",
        },
    )
    assert pg_only.status_code == 200, pg_only.text
    aid = pg_only.json()["id"]
    assert aid not in [a["id"] for a in nl.get("/api/controls/activities").json()["items"]]
    assert nl.get(f"/api/controls/activities/{aid}").status_code == 404
    for a in nl.get("/api/controls/activities").json()["items"]:
        assert all(e["code"] in ("ATN", "ATC") for e in a["entities"])
    isb.delete(f"/api/controls/activities/{aid}")
