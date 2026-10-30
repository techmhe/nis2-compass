"""POST /api/ai/assist/text: proofread / expand / translate a long text field (AI stubbed)."""

import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

import openai
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.features.audits.models import Audit, AuditFinding, EffectivenessReview
from app.features.risks.models import Risk
from app.models import Answer, Assessment, Entity, Incident

URL = "/api/ai/assist/text"
NO_TEXT = "The AI model returned no usable text. Try again or use another model."


class Stub:
    """Replaces aisvc.complete_json and records the prompts."""

    def __init__(self, result=None, exc=None):
        self.result = {"text": "Fixed."} if result is None else result
        self.exc = exc
        self.calls: list[tuple[str, str]] = []
        self.kwargs: list[dict] = []

    def __call__(self, cfg, system, user, *a, **kw):
        self.calls.append((system, user))
        self.kwargs.append(kw)
        if self.exc:
            raise self.exc
        return self.result


def ready(ok=True):
    return SimpleNamespace(ready=ok, chat_model="test-model")


@pytest.fixture
def ai():
    stub = Stub()
    with (
        patch("app.api.ai.aisvc.get_config", return_value=ready()),
        patch("app.api.ai.aisvc.complete_json", stub),
    ):
        yield stub


@pytest.fixture(scope="module")
def objs(database):
    tag = uuid.uuid4().hex[:6].upper()
    out = {}
    with SessionLocal() as db:
        ents = {e.code: e for e in db.scalars(select(Entity))}
        for code in ("ATL", "ATN"):
            e = ents[code]
            asm = db.scalar(select(Assessment).where(Assessment.entity_id == e.id).order_by(Assessment.id))
            out[f"answer_{code}"] = db.scalar(
                select(Answer.id).where(Answer.assessment_id == asm.id).order_by(Answer.id)
            )
            out[f"assessment_{code}"] = asm.id
            risk = Risk(code=f"WH-{code}-{tag}", entity_id=e.id, title=f"Risk {code}")
            inc = Incident(code=f"WI-{code}-{tag}", entity_id=e.id, title=f"Incident {code}")
            aud = Audit(
                code=f"WA-{code}-{tag}",
                type="internal",
                entity_id=e.id,
                scope="Scope",
                planned_start=date(2026, 1, 1),
                planned_end=date(2026, 1, 2),
            )
            db.add_all([risk, inc, aud])
            db.flush()
            fnd = AuditFinding(audit_id=aud.id, number="F1", type="minor", description="d", entity_id=None)
            rev = EffectivenessReview(entity_id=e.id, period=f"9{code}", status="draft")
            appr = EffectivenessReview(entity_id=e.id, period=f"8{code}", status="approved")
            db.add_all([fnd, rev, appr])
            db.flush()
            out.update(
                {
                    f"risk_{code}": risk.id,
                    f"incident_{code}": inc.id,
                    f"audit_{code}": aud.id,
                    f"audit_finding_{code}": fnd.id,
                    f"effectiveness_review_{code}": rev.id,
                    f"approved_{code}": appr.id,
                }
            )
        db.commit()
    return out


def body(typ, oid, field, **kw):
    return {
        "mode": "proofread",
        "language": None,
        "target": {"type": typ, "id": oid},
        "field": field,
        "text": "teh text",
        **kw,
    }


@pytest.mark.parametrize(("mode", "language"), [("proofread", None), ("expand", None), ("translate", "nl")])
def test_each_mode_returns_text_and_model(login, ai, objs, mode, language):
    r = login("isb@demo.local").post(
        URL, json=body("answer", objs["answer_ATL"], "gap_description", mode=mode, language=language)
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"text": "Fixed.", "model": "test-model"}
    system, user = ai.calls[0]
    assert "teh text" in user and "Gap description" in user
    if mode == "translate":
        assert "Dutch" in system + user


@pytest.mark.parametrize(
    ("typ", "field"),
    [
        ("risk", "scenario"),
        ("incident", "root_cause"),
        ("audit", "conclusion"),
        ("audit", "finding_description"),
        ("audit_finding", "closure_note"),
        ("effectiveness_review", "conclusion"),
    ],
)
def test_success_per_target_type(login, ai, objs, typ, field):
    r = login("isb@demo.local").post(URL, json=body(typ, objs[f"{typ}_ATL"], field))
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "Fixed."


def test_entity_scoped_user_gets_404_for_other_entity(login, ai, objs):
    nl = login("nl.contact@demo.local")
    assert nl.post(URL, json=body("answer", objs["answer_ATL"], "notes")).status_code == 404
    assert nl.post(URL, json=body("risk", objs["risk_ATL"], "scenario")).status_code == 404
    assert nl.post(URL, json=body("risk", 10**9, "scenario")).status_code == 404
    assert ai.calls == []


@pytest.mark.parametrize(
    ("typ", "field"),
    [
        ("answer", "notes"),
        ("risk", "scenario"),
        ("incident", "impact"),
        ("audit", "summary"),
        ("audit_finding", "closure_note"),
        ("effectiveness_review", "conclusion"),
    ],
)
def test_reader_without_write_gets_403(login, ai, objs, typ, field):
    r = login("viewer@demo.local").post(URL, json=body(typ, objs[f"{typ}_ATL"], field))
    assert r.status_code == 403
    assert ai.calls == []


def test_missing_ai_use_gets_403(login, ai, objs):
    r = login("auditor@demo.local").post(URL, json=body("risk", objs["risk_ATL"], "scenario"))
    assert r.status_code == 403
    assert ai.calls == []


def test_contributor_can_write_answers_of_own_entity(login, ai, objs):
    nl = login("nl.contact@demo.local")
    assert nl.post(URL, json=body("answer", objs["answer_ATN"], "notes")).status_code == 200
    # assessments.edit only: risks.manage is missing
    assert nl.post(URL, json=body("risk", objs["risk_ATN"], "scenario")).status_code == 403


def test_locked_assessment_is_423_without_manage(login, ai, objs):
    def lock(value):
        with SessionLocal() as db:
            db.get(Assessment, objs["assessment_ATN"]).locked = value
            db.commit()

    lock(True)
    try:
        r = login("nl.contact@demo.local").post(URL, json=body("answer", objs["answer_ATN"], "notes"))
        assert r.status_code == 423
        assert ai.calls == []
    finally:
        lock(False)


def test_approved_review_is_409(login, ai, objs):
    r = login("isb@demo.local").post(
        URL, json=body("effectiveness_review", objs["approved_ATL"], "conclusion")
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "An approved review cannot be edited"
    assert ai.calls == []


@pytest.mark.parametrize(
    "change",
    [
        {"field": "title"},
        {"mode": "translate", "language": None},
        {"mode": "proofread", "language": "de"},
        {"mode": "translate", "language": "fr"},
        {"text": "   "},
        {"text": "x" * 6001},
        {"target": {"type": "document", "id": 1}},
    ],
)
def test_invalid_requests_are_422(login, ai, objs, change):
    r = login("isb@demo.local").post(URL, json={**body("risk", objs["risk_ATL"], "scenario"), **change})
    assert r.status_code == 422
    assert ai.calls == []


def test_field_must_belong_to_target_type(login, ai, objs):
    r = login("isb@demo.local").post(URL, json=body("risk", objs["risk_ATL"], "closure_note"))
    assert r.status_code == 422


def test_6000_characters_are_accepted(login, ai, objs):
    r = login("isb@demo.local").post(URL, json=body("risk", objs["risk_ATL"], "scenario", text="x" * 6000))
    assert r.status_code == 200


def test_unconfigured_is_503(login, objs):
    with (
        patch("app.api.ai.aisvc.get_config", return_value=ready(False)),
        patch("app.api.ai.aisvc.complete_json") as cj,
    ):
        r = login("isb@demo.local").post(URL, json=body("risk", objs["risk_ATL"], "scenario"))
    assert r.status_code == 503
    assert r.json()["detail"] == "AI assistant is not configured"
    cj.assert_not_called()


@pytest.mark.parametrize(
    "stub",
    [
        Stub({"text": ""}),
        Stub({}),
        Stub(exc=openai.APIConnectionError(request=None)),
    ],
)
def test_no_usable_text_is_502(login, objs, stub):
    with (
        patch("app.api.ai.aisvc.get_config", return_value=ready()),
        patch("app.api.ai.aisvc.complete_json", stub),
    ):
        r = login("isb@demo.local").post(URL, json=body("risk", objs["risk_ATL"], "scenario"))
    assert r.status_code == 502
    assert r.json()["detail"] == NO_TEXT


@pytest.mark.parametrize(
    "raw",
    ['"Fixed."', "```\nFixed.\n```", '```text\n"Fixed."\n```', "  Fixed.  "],
)
def test_quotes_and_fences_are_stripped(login, objs, raw):
    with (
        patch("app.api.ai.aisvc.get_config", return_value=ready()),
        patch("app.api.ai.aisvc.complete_json", Stub({"text": raw})),
    ):
        r = login("isb@demo.local").post(URL, json=body("risk", objs["risk_ATL"], "scenario"))
    assert r.json()["text"] == "Fixed."


def test_inner_quotes_are_kept():
    from app.services.writing_help import clean_text

    assert clean_text('"a" and "b"') == '"a" and "b"'


def test_truncated_model_json_is_502(login, objs):
    stub = Stub({"text": '{"text": "cut off'})
    with (
        patch("app.api.ai.aisvc.get_config", return_value=ready()),
        patch("app.api.ai.aisvc.complete_json", stub),
    ):
        r = login("isb@demo.local").post(URL, json=body("risk", objs["risk_ATL"], "scenario"))
    assert r.status_code == 502
    assert r.json()["detail"] == NO_TEXT


def test_budget_fits_a_6000_character_text(login, objs, ai):
    login("isb@demo.local").post(URL, json=body("risk", objs["risk_ATL"], "scenario"))
    assert ai.kwargs[-1].get("min_tokens", 0) >= 8000


@pytest.mark.parametrize(
    ("typ", "field"),
    [
        ("answer", "notes"),
        ("risk", "scenario"),
        ("incident", "impact"),
        ("audit", "summary"),
        ("audit_finding", "closure_note"),
        ("effectiveness_review", "conclusion"),
    ],
)
def test_invisible_and_missing_ids_give_the_same_404(login, ai, objs, typ, field):
    nl = login("nl.contact@demo.local")
    hidden = nl.post(URL, json=body(typ, objs[f"{typ}_ATL"], field))
    missing = nl.post(URL, json=body(typ, 10**9, field))
    assert hidden.status_code == missing.status_code == 404
    assert hidden.json()["detail"] == missing.json()["detail"]


def test_provider_error_does_not_log_request_content(login, objs, caplog):
    secret = "patient zero details"
    req = SimpleNamespace(method="POST", url="http://x")
    exc = openai.APIStatusError(
        f"bad request: {secret}",
        response=SimpleNamespace(status_code=400, request=req, headers={}),
        body=None,
    )
    stub = Stub(exc=exc)
    with (
        patch("app.api.ai.aisvc.get_config", return_value=ready()),
        patch("app.api.ai.aisvc.complete_json", stub),
        caplog.at_level("DEBUG"),
    ):
        r = login("isb@demo.local").post(
            URL, json={**body("risk", objs["risk_ATL"], "scenario"), "text": secret}
        )
    assert r.status_code == 502
    assert caplog.records
    assert secret not in caplog.text
    assert "APIStatusError" in caplog.text
    assert "400" in caplog.text
