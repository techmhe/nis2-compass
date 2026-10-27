"""4-eyes approval workflow: rules (requester != approver, requester write access, approver permission), decisions,
version pinning, inbox, visibility."""

import io
from contextlib import contextmanager

from sqlalchemy import select

from app.db import SessionLocal


def _doc(client, title):
    return next(d for d in client.get("/api/documents").json() if d["title"] == title)


def _state(client, target_type, target_id):
    r = client.get("/api/approvals/target", params={"target_type": target_type, "target_id": target_id})
    assert r.status_code == 200, r.text
    return r.json()


def _request(client, target_type, target_id, approver_id, note="Please approve"):
    return client.post(
        "/api/approvals",
        json={
            "target_type": target_type,
            "target_id": target_id,
            "approver_user_id": approver_id,
            "request_note": note,
        },
    )


def _upload_version(client, doc_id, content=b"new content"):
    return client.c.post(
        f"/api/documents/{doc_id}/versions",
        files={"file": ("v.txt", io.BytesIO(content), "text/plain")},
        headers={"X-CSRF-Token": client.csrf},
    )


@contextmanager
def _db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_request_rules(login):
    isb, pm, viewer, nl, it = (
        login(e)
        for e in (
            "isb@demo.local",
            "pm@demo.local",
            "viewer@demo.local",
            "nl.contact@demo.local",
            "it@demo.local",
        )
    )
    doc = _doc(isb, "Supplier Security Guideline")
    # requester must not be the approver
    r = _request(isb, "document", doc["id"], isb.me["id"])
    assert r.status_code == 400 and "4-eyes" in r.json()["detail"]
    # viewer has no write access to the document
    assert _request(viewer, "document", doc["id"], isb.me["id"]).status_code == 403
    # approver needs read access: nl.contact cannot see documents of HQ (entity ATL)
    hq_doc = _doc(isb, "Business Continuity Plan HQ")
    r = _request(it, "document", hq_doc["id"], nl.me["id"])
    assert r.status_code == 400 and "no access" in r.json()["detail"]
    # approver needs documents.manage for the document's entity: read-only users and pm cannot approve
    for u in (viewer, pm):
        r = _request(it, "document", hq_doc["id"], u.me["id"])
        assert r.status_code == 400 and "documents.manage" in r.json()["detail"]
    candidates = it.get(
        "/api/approvals/approvers", params={"target_type": "document", "target_id": hq_doc["id"]}
    ).json()
    ids = {u["id"] for u in candidates}
    assert isb.me["id"] in ids and not ids & {nl.me["id"], it.me["id"], viewer.me["id"], pm.me["id"]}
    # unknown target type
    assert _request(isb, "nonsense", 1, pm.me["id"]).status_code == 400


def test_group_document_needs_group_wide_write(login):
    """H1: an entity-scoped contributor must not request approval of a group-level document."""
    nl, isb, viewer = login("nl.contact@demo.local"), login("isb@demo.local"), login("viewer@demo.local")
    group_doc = _doc(isb, "Supplier Security Guideline")
    assert _request(nl, "document", group_doc["id"], viewer.me["id"]).status_code == 403
    assert _request(nl, "document", group_doc["id"], isb.me["id"]).status_code == 403
    assert (
        nl.get(
            "/api/approvals/approvers", params={"target_type": "document", "target_id": group_doc["id"]}
        ).status_code
        == 403
    )


def test_document_approval_flow_and_version_pinning(login):
    isb, it, pm, assessor = (
        login(e) for e in ("isb@demo.local", "it@demo.local", "pm@demo.local", "assessor@demo.local")
    )
    doc = _doc(isb, "Supplier Security Guideline")
    r = _request(it, "document", doc["id"], isb.me["id"])
    assert r.status_code == 200, r.text
    req = r.json()
    assert req["status"] == "pending" and req["target_version_label"].startswith("v")
    assert _doc(isb, "Supplier Security Guideline")["status"] == "In Review"
    # only one pending request per object
    assert _request(it, "document", doc["id"], isb.me["id"]).status_code == 409
    # inbox + notification of the approver
    waiting = isb.get("/api/approvals", params={"mine": "waiting"}).json()
    assert any(a["id"] == req["id"] and a["can_decide"] for a in waiting)
    assert any(
        n["kind"] == "approval_request" and "Supplier Security Guideline" in n["title"]
        for n in isb.get("/api/notifications").json()["items"]
    )
    assert any(
        a["id"] == req["id"] and a["can_withdraw"]
        for a in it.get("/api/approvals", params={"mine": "requested"}).json()
    )
    # only the approver decides; rejecting needs a note
    for other in (assessor, it, pm):
        assert (
            other.post(f"/api/approvals/{req['id']}/decide", json={"decision": "approved"}).status_code == 403
        )
    r = isb.post(f"/api/approvals/{req['id']}/decide", json={"decision": "rejected", "note": "  "})
    assert r.status_code == 400
    r = isb.post(f"/api/approvals/{req['id']}/decide", json={"decision": "approved", "note": "Fine"})
    assert r.status_code == 200 and r.json()["status"] == "approved"
    d = _doc(isb, "Supplier Security Guideline")
    assert d["status"] == "Approved" and d["approved_by"] == isb.me["display_name"] and d["approved_at"]
    assert _state(isb, "document", doc["id"])["state"] == "approved"
    assert any(n["kind"] == "approval_decision" for n in it.get("/api/notifications").json()["items"])
    # decided requests cannot be decided again
    assert (
        isb.post(f"/api/approvals/{req['id']}/decide", json={"decision": "rejected", "note": "x"}).status_code
        == 409
    )
    # a new version after the approval: "changed after approval"
    assert _upload_version(it, doc["id"]).status_code == 200
    st = _state(isb, "document", doc["id"])
    assert st["state"] == "changed_after_approval" and st["current"]["stale"] and st["can_request"]


def test_approval_blocked_when_target_changed_while_pending(login):
    isb, it = login("isb@demo.local"), login("it@demo.local")
    doc = _doc(isb, "Access Control Policy")
    req = _request(it, "document", doc["id"], isb.me["id"]).json()
    assert _upload_version(it, doc["id"], b"x").status_code == 200
    assert isb.post(f"/api/approvals/{req['id']}/decide", json={"decision": "approved"}).status_code == 409
    r = isb.post(
        f"/api/approvals/{req['id']}/decide",
        json={"decision": "changes_requested", "note": "Please request again for the new version"},
    )
    assert r.status_code == 200
    assert _state(isb, "document", doc["id"])["state"] == "changes_requested"


def test_approver_permission_rechecked_on_decision(login):
    """Permissions can change between request and decision: the approver rule is enforced again."""
    from app.core.security import hash_password
    from app.models import Role, RoleAssignment, User

    it = login("it@demo.local")
    with _db() as db:
        role = db.scalar(select(Role).where(Role.key == "security_officer"))
        u = User(
            email="deputy.iso@demo.local",
            display_name="Deputy ISO",
            password_hash=hash_password("Demo-Password-2026!"),
        )
        db.add(u)
        db.flush()
        db.add(RoleAssignment(user_id=u.id, role_id=role.id, entity_id=None))
        db.commit()
        uid = u.id
    deputy = login("deputy.iso@demo.local")
    doc = _doc(it, "Backup and Recovery Guideline")
    req = _request(it, "document", doc["id"], uid).json()
    assert req["status"] == "pending"
    with _db() as db:  # the deputy is demoted to viewer
        ra = db.scalar(select(RoleAssignment).where(RoleAssignment.user_id == uid))
        ra.role_id = db.scalar(select(Role.id).where(Role.key == "viewer"))
        db.commit()
    r = deputy.post(f"/api/approvals/{req['id']}/decide", json={"decision": "approved"})
    assert r.status_code == 403 and "documents.manage" in r.json()["detail"]
    assert it.get(f"/api/approvals/{req['id']}").json()["status"] == "pending"
    it.post(f"/api/approvals/{req['id']}/withdraw")


def test_withdraw_and_visibility(login):
    isb, it, pm, nl = (
        login(e) for e in ("isb@demo.local", "it@demo.local", "pm@demo.local", "nl.contact@demo.local")
    )
    doc = _doc(isb, "Business Continuity Plan HQ")
    req = _request(it, "document", doc["id"], isb.me["id"]).json()
    # outsiders without access to the (ATL) document cannot see the request
    assert nl.get(f"/api/approvals/{req['id']}").status_code == 404
    assert all(a["id"] != req["id"] for a in nl.get("/api/approvals", params={"mine": "all"}).json())
    assert pm.get(f"/api/approvals/{req['id']}").status_code == 200
    assert isb.post(f"/api/approvals/{req['id']}/withdraw").status_code == 403
    r = it.post(f"/api/approvals/{req['id']}/withdraw")
    assert r.status_code == 200 and r.json()["status"] == "withdrawn"
    assert isb.post(f"/api/approvals/{req['id']}/decide", json={"decision": "approved"}).status_code == 409


def test_parties_who_lost_access_do_not_see_details(login):
    from app.models import Document, Entity

    nl, isb = login("nl.contact@demo.local"), login("isb@demo.local")
    doc = _doc(isb, "Beleid informatiebeveiliging NL")
    req = _request(nl, "document", doc["id"], isb.me["id"], note="confidential detail").json()
    assert req["accessible"] and req["target_label"] == doc["title"]
    with _db() as db:  # the document moves to HQ, which nl.contact cannot see
        d = db.get(Document, doc["id"])
        old = d.entity_id
        d.entity_id = db.scalar(select(Entity.id).where(Entity.code == "ATL"))
        db.commit()
    try:
        mine = next(
            a for a in nl.get("/api/approvals", params={"mine": "requested"}).json() if a["id"] == req["id"]
        )
        assert not mine["accessible"] and mine["target_label"] != doc["title"]
        assert mine["request_note"] is None and mine["target_url"] is None
    finally:
        with _db() as db:
            db.get(Document, doc["id"]).entity_id = old
            db.commit()
    nl.post(f"/api/approvals/{req['id']}/withdraw")


def test_answer_approval_pins_revision(login):
    isb, assessor, pm = login("isb@demo.local"), login("assessor@demo.local"), login("pm@demo.local")
    asm = next(a for a in isb.get("/api/assessments").json() if a["entity"]["code"] == "ATS")
    ans = isb.get(f"/api/assessments/{asm['id']}/answers").json()[3]
    assert (
        assessor.patch(f"/api/answers/{ans['id']}", json={"notes": "checked in interview"}).status_code == 200
    )
    # the approver of an answer needs assessments.manage for the entity
    r = _request(assessor, "answer", ans["id"], pm.me["id"])
    assert r.status_code == 400 and "assessments.manage" in r.json()["detail"]
    req = _request(assessor, "answer", ans["id"], isb.me["id"]).json()
    assert isb.post(f"/api/approvals/{req['id']}/decide", json={"decision": "approved"}).status_code == 200
    detail = isb.get(f"/api/answers/{ans['id']}").json()
    assert detail["answer"]["review_status"] == "reviewed"
    assert (
        _state(isb, "answer", ans["id"])["state"] == "approved"
    )  # the review flag itself is no content change
    assert assessor.patch(f"/api/answers/{ans['id']}", json={"evidence": "new evidence"}).status_code == 200
    assert _state(isb, "answer", ans["id"])["state"] == "changed_after_approval"


def test_summary_and_filters(login):
    isb = login("isb@demo.local")
    s = isb.get("/api/approvals/summary").json()
    assert set(s) == {"waiting", "waiting_overdue", "requested_pending"}
    waiting = isb.get("/api/approvals", params={"mine": "waiting"}).json()
    assert s["waiting"] == len([a for a in waiting if a["status"] == "pending"])
    closed = isb.get("/api/approvals", params={"mine": "all", "status": "closed"}).json()
    assert all(a["status"] != "pending" for a in closed)


def test_approval_reminders(login):
    from datetime import date, timedelta

    from app.features.approvals.models import ApprovalRequest
    from app.features.approvals.service import run_approval_reminders
    from app.models import Notification

    isb, it = login("isb@demo.local"), login("it@demo.local")
    doc = _doc(isb, "Information Security Policy")
    req = _request(it, "document", doc["id"], isb.me["id"]).json()
    with _db() as db:
        db.get(ApprovalRequest, req["id"]).due_date = date.today() - timedelta(days=1)
        db.commit()
        key = f"overdue:approval:{req['id']}:%"
        assert run_approval_reminders(db) >= 1
        assert (
            db.query(Notification)
            .filter(Notification.user_id == isb.me["id"], Notification.dedupe_key.like(key))
            .count()
            == 1
        )
        run_approval_reminders(db)  # deduplicated per day
        assert (
            db.query(Notification)
            .filter(Notification.user_id == isb.me["id"], Notification.dedupe_key.like(key))
            .count()
            == 1
        )
    it.post(f"/api/approvals/{req['id']}/withdraw")
