import asyncio
import importlib.util
import io
import logging
import os
import re
import ssl
import time
import tracemalloc
import uuid
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.main import integrity_handler
from app.services import notify
from app.services.extract import zip_is_safe
from app.services.workbook import GAP_TEMPLATE, PROJECT_TEMPLATE, parse_gap_workbook


def _smtp_settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "smtp_host", "smtp.example.org")
    monkeypatch.setattr(s, "smtp_from", "noreply@example.org")
    monkeypatch.setattr(s, "smtp_starttls", True)
    monkeypatch.setattr(s, "smtp_user", None)


def test_starttls_verifies_certificate(monkeypatch):
    _smtp_settings(monkeypatch)
    with patch("app.services.notify.smtplib.SMTP") as smtp_cls:
        notify.send_mail("someone@example.org", "subject", "text")
    smtp = smtp_cls.return_value.__enter__.return_value
    ctx = smtp.starttls.call_args.kwargs["context"]
    assert ctx.verify_mode == ssl.CERT_REQUIRED
    assert ctx.check_hostname is True


def test_failed_mail_logs_user_id_not_address(monkeypatch, caplog):
    _smtp_settings(monkeypatch)
    boom = RuntimeError("refused victim@example.org")
    with patch("app.services.notify.smtplib.SMTP", side_effect=boom), caplog.at_level(logging.WARNING):
        notify.send_mail("victim@example.org", "subject", "text", user_id=42)
    assert "user 42" in caplog.text
    assert "@" not in caplog.text


def test_integrity_error_logs_constraint_only(caplog):
    orig = MagicMock()
    orig.diag = SimpleNamespace(constraint_name="uq_users_email")
    orig.__str__ = lambda self: "Key (email)=(victim@example.org) already exists."
    exc = IntegrityError("INSERT", {}, orig)
    request = SimpleNamespace(method="POST", url=SimpleNamespace(path="/api/users"))
    with caplog.at_level(logging.INFO):
        resp = asyncio.run(integrity_handler(request, exc))
    assert resp.status_code == 409
    assert "uq_users_email" in caplog.text
    assert "@" not in caplog.text


def _zip_with(member: bytes, method: int = zipfile.ZIP_DEFLATED) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", method) as z:
        z.writestr("big.xml", member)
    return buf.getvalue()


def test_zip_ratio_checked_for_members_over_one_mib():
    assert not zip_is_safe(_zip_with(b"\0" * (2 * 1024 * 1024)))


def test_zip_total_size_capped_at_100_mib():
    assert not zip_is_safe(_zip_with(b"\0" * (101 * 1024 * 1024), zipfile.ZIP_STORED))


def test_small_high_ratio_member_is_accepted():
    assert zip_is_safe(_zip_with(b"\0" * 100_000))


def test_shipped_templates_pass_zip_check():
    assert zip_is_safe(GAP_TEMPLATE.read_bytes())
    assert zip_is_safe(PROJECT_TEMPLATE.read_bytes())


def test_read_only_gap_parse_matches_full_parse():
    assert parse_gap_workbook(GAP_TEMPLATE, read_only=True) == parse_gap_workbook(GAP_TEMPLATE)


def _gap_with_dimension(dim: str, far_cell: bool = False) -> bytes:
    """The shipped template with the declared dimension of its requirements sheet replaced.

    far_cell adds a value in column Z of the last possible row, which the parser does not use.
    """
    src = zipfile.ZipFile(io.BytesIO(GAP_TEMPLATE.read_bytes()))
    names = [i.filename for i in src.infolist()]
    wb_xml = src.read("xl/workbook.xml").decode()
    rid = re.search(r'<sheet [^>]*name="Requirements"[^>]*r:id="([^"]+)"', wb_xml).group(1)
    rels = src.read("xl/_rels/workbook.xml.rels").decode()
    target = re.search(rf'<Relationship [^>]*Id="{rid}"[^>]*Target="([^"]+)"', rels) or re.search(
        rf'<Relationship [^>]*Target="([^"]+)"[^>]*Id="{rid}"', rels
    )
    sheet = "xl/" + target.group(1).lstrip("/").removeprefix("xl/")
    assert sheet in names
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in names:
            data = src.read(name)
            if name == sheet:
                data, n = re.subn(rb'<dimension ref="[^"]*"\s*/>', f'<dimension ref="{dim}"/>'.encode(), data)
                assert n == 1
                if far_cell:
                    cell = b'<row r="1048576"><c r="Z1048576" t="inlineStr"><is><t>x</t></is></c></row>'
                    data = data.replace(b"</sheetData>", cell + b"</sheetData>")
            z.writestr(name, data)
    return out.getvalue()


def test_read_only_gap_parse_ignores_a_one_cell_declared_dimension():
    full = parse_gap_workbook(GAP_TEMPLATE)
    parsed = parse_gap_workbook(io.BytesIO(_gap_with_dimension("A1")), read_only=True)
    assert parsed == full and len(full["requirements"]) > 100


def test_read_only_gap_parse_survives_a_huge_declared_dimension():
    full = parse_gap_workbook(GAP_TEMPLATE)
    data = _gap_with_dimension("A1:XFD1048576", far_cell=True)
    tracemalloc.start()
    started = time.monotonic()
    parsed = parse_gap_workbook(io.BytesIO(data), read_only=True)
    elapsed = time.monotonic() - started
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert parsed == full
    assert peak < 200 * 1024 * 1024 and elapsed < 30


# --- task 7: cheap low fixes ------------------------------------------------------------------------------


def test_viewer_cannot_link_documents_to_tasks(login):
    isb = login("isb@demo.local")
    viewer = login("viewer@demo.local")
    task = isb.post("/api/tasks", json={"title": "link target"}).json()
    doc = viewer.get("/api/documents").json()[0]
    body = {"target_type": "task", "target_id": task["id"]}
    assert viewer.post(f"/api/documents/{doc['id']}/links", json=body).status_code in (403, 404)
    assert isb.post(f"/api/documents/{doc['id']}/links", json=body).status_code == 200
    link_id = next(
        link["id"]
        for link in isb.get(f"/api/documents/{doc['id']}").json()["links"]
        if link["target_id"] == task["id"]
    )
    assert viewer.delete(f"/api/documents/links/{link_id}").status_code in (403, 404)
    assert isb.delete(f"/api/documents/links/{link_id}").status_code == 200


def test_ai_base_url_change_drops_stored_key(login):
    isb = login("admin@example.local", os.environ["NIS2_BOOTSTRAP_ADMIN_PASSWORD"])
    base = {"enabled": False, "chat_model": "m"}
    r = isb.put(
        "/api/ai/settings", json={**base, "base_url": "https://llm.example.org/v1", "api_key": "sk-1"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["has_api_key"] is True
    same = isb.put("/api/ai/settings", json={**base, "base_url": "https://llm.example.org/v1"})
    assert same.json()["has_api_key"] is True
    moved = isb.put("/api/ai/settings", json={**base, "base_url": "https://evil.example.net/v1"})
    assert moved.json()["has_api_key"] is False
    new_key = isb.put(
        "/api/ai/settings", json={**base, "base_url": "https://llm.example.org/v1", "api_key": "sk-2"}
    )
    assert new_key.json()["has_api_key"] is True
    isb.put("/api/ai/settings", json={**base, "base_url": None, "api_key": ""})


def test_ai_test_hides_connection_details(login, caplog):
    from app.services import ai as aisvc

    cfg = SimpleNamespace(chat_model="m", embedding_model="e", api_key="sk-secret")
    boom = RuntimeError("connect to 10.0.0.5:5432 refused, key sk-secret")
    with (
        patch.object(aisvc, "_client", side_effect=boom),
        patch.object(aisvc, "embed_texts", side_effect=boom),
        caplog.at_level(logging.WARNING),
    ):
        out = aisvc.test_connection(cfg)
    assert out["chat"] == {"ok": False, "error": "connection failed"}
    assert out["embeddings"] == {"ok": False, "error": "connection failed"}
    assert "10.0.0.5" not in str(out)
    assert "connection test failed" in caplog.text
    assert "sk-secret" not in caplog.text


def test_api_token_expiry_is_required_and_bounded(login):
    isb = login("isb@demo.local")
    assert isb.post("/api/auth/tokens", json={"name": "t", "expires_in_days": None}).status_code == 422
    assert isb.post("/api/auth/tokens", json={"name": "t", "expires_in_days": 731}).status_code == 422
    r = isb.post("/api/auth/tokens", json={"name": "default"})
    assert r.status_code == 200 and r.json()["expires_at"]
    isb.delete(f"/api/auth/tokens/{r.json()['id']}")


def test_password_change_via_token_ends_all_sessions(app_, login):
    from fastapi.testclient import TestClient

    from tests.conftest import Client

    isb = login("isb@demo.local")
    roles = {r["key"]: r["id"] for r in isb.get("/api/roles").json()}
    old, new = "Old-Password-2026!", "New-Password-2026!"
    email = f"tokpw-{uuid.uuid4().hex[:8]}@demo.local"
    created = isb.post(
        "/api/users",
        json={
            "email": email,
            "display_name": "Token PW",
            "password": old,
            "assignments": [{"role_id": roles["viewer"], "entity_id": None}],
        },
    )
    assert created.status_code == 200, created.text
    from app.db import SessionLocal
    from app.models import User

    with SessionLocal() as db:
        db.query(User).filter(User.email == email).update({"must_change_password": False})
        db.commit()
    user = Client(app_, email, old)
    made = user.post("/api/auth/tokens", json={"name": "cli"})
    assert made.status_code == 200, made.text
    token = made.json()["token"]
    assert user.get("/api/auth/sessions").json()
    bearer = TestClient(app_)
    r = bearer.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": old, "new_password": new},
    )
    assert r.status_code == 200, r.text
    assert user.get("/api/auth/me").status_code == 401


def test_stakeholder_names_are_not_exported_as_formulas():
    import openpyxl
    from sqlalchemy.orm import Session

    from app.db import engine
    from app.models import Stakeholder
    from app.services.export import export_gap

    with Session(engine) as db:
        db.add(Stakeholder(name="=1+1", kind="role", is_active=True, sort_order=-1))
        db.flush()
        data = export_gap(db, 1, None)
        db.rollback()
    cell = openpyxl.load_workbook(io.BytesIO(data))["Lists"]["S6"]
    assert cell.value == "=1+1" and cell.data_type == "s"


def test_bootstrap_admin_password_must_meet_policy(monkeypatch):
    import pytest

    from app.seed import seed

    settings = get_settings()
    monkeypatch.setattr(settings, "bootstrap_admin_password", "short")
    db = MagicMock()
    db.scalar.return_value = 0
    with pytest.raises(RuntimeError, match="NIS2_BOOTSTRAP_ADMIN_PASSWORD"):
        seed.bootstrap_admin(db)
    db.add.assert_not_called()


# --- review findings ---------------------------------------------------------------------------------------


def test_env_ai_key_is_not_sent_to_an_admin_chosen_url(monkeypatch):
    from app.db import SessionLocal
    from app.models import Setting
    from app.services import ai as aisvc

    s = get_settings()
    monkeypatch.setattr(s, "ai_base_url", "https://llm.example.org/v1")
    monkeypatch.setattr(s, "ai_api_key", "sk-env")
    with SessionLocal() as db:
        assert aisvc.get_config(db).api_key == "sk-env"
        row = db.get(Setting, "ai.base_url") or Setting(key="ai.base_url")
        previous = row.value
        db.add(row)
        try:
            row.value = "https://evil.example.net/v1"
            db.commit()
            cfg = aisvc.get_config(db)
            assert cfg.base_url == "https://evil.example.net/v1" and cfg.api_key is None
            row.value = "https://llm.example.org/v1/"
            db.commit()
            assert aisvc.get_config(db).api_key == "sk-env"
        finally:
            row.value = previous
            db.commit()


def test_settings_response_reports_no_key_after_url_change(login, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "ai_base_url", "https://llm.example.org/v1")
    monkeypatch.setattr(s, "ai_api_key", "sk-env")
    admin = login("admin@example.local", os.environ["NIS2_BOOTSTRAP_ADMIN_PASSWORD"])
    base = {"enabled": False, "chat_model": "m"}
    try:
        assert admin.get("/api/ai/settings").json()["has_api_key"] is True
        moved = admin.put("/api/ai/settings", json={**base, "base_url": "https://evil.example.net/v1"})
        assert moved.json()["has_api_key"] is False
    finally:
        admin.put("/api/ai/settings", json={**base, "base_url": None, "api_key": ""})


def test_api_token_backfill_gives_tokens_without_expiry_90_days():
    from datetime import timedelta

    from sqlalchemy import select, text

    from app.core.security import token_hash
    from app.db import SessionLocal, utcnow
    from app.models import ApiToken, User

    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0008_api_token_expiry_backfill.py"
    spec = importlib.util.spec_from_file_location("migration_0008", path)
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)
    with SessionLocal() as db:
        uid = db.scalar(select(User.id).where(User.email == "isb@demo.local"))
        keep = utcnow() + timedelta(days=3)
        old = ApiToken(
            user_id=uid, name="old", token_hash=token_hash("backfill-1"), prefix="p1", expires_at=None
        )
        dated = ApiToken(
            user_id=uid, name="dated", token_hash=token_hash("backfill-2"), prefix="p2", expires_at=keep
        )
        db.add_all([old, dated])
        db.commit()
        try:
            db.execute(text(mig.BACKFILL_SQL))
            db.commit()
            db.refresh(old)
            db.refresh(dated)
            assert timedelta(days=89) < old.expires_at - utcnow() <= timedelta(days=90)
            assert dated.expires_at == keep
        finally:
            db.delete(old)
            db.delete(dated)
            db.commit()


def _setup_hint_logs(monkeypatch, caplog, *, token, secret, env="production"):
    from app import main

    s = get_settings()
    assert main.settings is s
    monkeypatch.setattr(s, "setup_token", token)
    monkeypatch.setattr(s, "secret_key", secret)
    monkeypatch.setattr(s, "env", env)
    with caplog.at_level(logging.WARNING, logger="nis2"):
        main._log_setup_hint()
    return caplog.text


def test_configured_setup_token_is_never_logged(monkeypatch, caplog):
    text = _setup_hint_logs(monkeypatch, caplog, token="configured-token-123", secret="k" * 40)
    assert "configured-token-123" not in text
    assert "use the configured NIS2_SETUP_TOKEN" in text


def test_derived_setup_token_is_logged(monkeypatch, caplog):
    from app.services.setup import expected_setup_token

    text = _setup_hint_logs(monkeypatch, caplog, token=None, secret="k" * 40)
    assert expected_setup_token() in text
    assert "predictable" not in text


def test_default_secret_key_warns_that_the_setup_token_is_predictable(monkeypatch, caplog):
    text = _setup_hint_logs(
        monkeypatch, caplog, token=None, secret="dev-insecure-secret-change-me-please-0123456789"
    )
    assert "predictable" in text and "NIS2_SECRET_KEY" in text


def test_default_secret_key_is_not_warned_about_in_test_env(monkeypatch, caplog):
    text = _setup_hint_logs(
        monkeypatch, caplog, token=None, secret="dev-insecure-secret-change-me-please-0123456789", env="test"
    )
    assert "predictable" not in text
