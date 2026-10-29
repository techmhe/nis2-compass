"""Governance module: legal-basis tagging, registrations and change duty, obligations, management body."""

from datetime import date, timedelta

from app.features.governance.logic import add_months, bsig_label, member_training_status, next_due, nl_label
from app.features.governance.models import BoardMember, TrainingRecord, TrainingRule


def _ents(client) -> dict[str, dict]:
    return {e["code"]: e for e in client.get("/api/entities").json()}


def _req_id(client, number: str) -> int:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Requirement

    with SessionLocal() as db:
        return db.scalar(select(Requirement.id).where(Requirement.number == number))


# --------------------------------------------------------------------------- pure calculations


def test_label_formatting_and_recurrence():
    assert bsig_label(["30.2.3", "30.2.5"]) == "§ 30(2) Nr. 3, 5 BSIG"
    assert bsig_label(["32.1.3", "32.1.4", "32.2"]) == "§ 32(1) Nr. 3, 4; § 32(2) BSIG"
    assert nl_label("CBW", ["25", "26", "27", "28", "29"]) == "Cbw Art. 25–29"
    assert nl_label("CBB", ["11", "17"]) == "Cbb Art. 11, 17"
    assert nl_label("CBW", ["21.1", "21.3"]) == "Cbw Art. 21(1), 21(3)"
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert next_due(date(2026, 3, 15), "annual") == date(2027, 3, 15)
    assert next_due(date(2026, 3, 15), "quarterly") == date(2026, 6, 15)
    assert next_due(date(2026, 3, 15), "none") is None


def test_training_status_rules():
    today = date(2026, 9, 29)
    nl = TrainingRule(
        jurisdiction="NL",
        label="NL",
        initial_months=24,
        count_from=date(2026, 8, 15),
        cadence_months=None,
        requires_certificate=True,
    )
    de = TrainingRule(
        jurisdiction="DE",
        label="DE",
        initial_months=6,
        count_from=date(2025, 12, 6),
        cadence_months=24,
        requires_certificate=False,
    )
    old = BoardMember(id=1, entity_id=1, name="A", appointed_at=date(2015, 1, 1))
    new = BoardMember(id=2, entity_id=1, name="B", appointed_at=date(2027, 1, 10))
    # NL: members in office when the Cbw entered into force -> 15 Aug 2028
    st = member_training_status(old, nl, [], today)
    assert st["deadline"] == date(2028, 8, 15) and st["status"] == "due"
    assert member_training_status(new, nl, [], today)["deadline"] == date(2029, 1, 10)
    # a training without certificate does not count in NL, with certificate it does (one-off)
    t = TrainingRecord(board_member_ids=[1], training_date=date(2026, 6, 1), has_certificate=False)
    assert member_training_status(old, nl, [t], today)["status"] == "due"
    t.has_certificate = True
    t.cert_issued_on = date(2026, 6, 2)
    st = member_training_status(old, nl, [t], today)
    assert st["status"] == "compliant" and st["deadline"] is None and st["last_training"] == date(2026, 6, 2)
    # DE company rule: 6 months after 6 Dec 2025, then every 24 months
    st = member_training_status(old, de, [], today)
    assert st["deadline"] == date(2026, 6, 6) and st["status"] == "overdue"
    t2 = TrainingRecord(board_member_ids=[1], training_date=date(2024, 12, 1))
    assert (
        member_training_status(old, de, [t2], today)["status"] == "due"
    )  # next due 1 Dec 2026, within 90 days
    t2.training_date = date(2026, 3, 1)
    st = member_training_status(old, de, [t2], today)
    assert st["status"] == "compliant" and st["deadline"] == date(2028, 3, 1)


# --------------------------------------------------------------------------- legal tagging


def test_legal_tags_seeded_from_links(login):
    isb = login("isb@demo.local")
    rid = _req_id(isb, "1.1.1")
    r = isb.get(f"/api/governance/legal/requirements/{rid}")
    assert r.status_code == 200
    rows = {x["jurisdiction"]: x for x in r.json()["rows"]}
    assert rows["DE"]["status"] == "binding" and rows["DE"]["basis_label"] == "§ 30(2) Nr. 1 BSIG"
    assert rows["DE"]["regulation_code"] == "BSIG"
    assert rows["NL"]["status"] == "binding" and rows["NL"]["basis_label"] == "Cbb Art. 6"
    assert rows["EU"]["basis_label"] == "IR 2024/2690 Annex 1.1.1"
    by_ent = {e["entity"]["code"]: e["effective"] for e in r.json()["entities"]}
    assert by_ent["ATL"]["status"] == "binding" and by_ent["ATN"]["status"] == "binding"

    rows14 = {
        x["jurisdiction"]: x
        for x in isb.get(f"/api/governance/legal/requirements/{_req_id(isb, '14.1')}").json()["rows"]
    }
    assert rows14["DE"]["status"] == "binding" and rows14["DE"]["basis_label"].startswith("§ 32(1)")
    assert rows14["NL"]["status"] == "binding" and rows14["NL"]["basis_label"].startswith("Cbw Art.")
    rows17 = {
        x["jurisdiction"]: x
        for x in isb.get(f"/api/governance/legal/requirements/{_req_id(isb, '17.1')}").json()["rows"]
    }
    assert rows17["DE"]["status"] == "benchmark" and rows17["DE"]["basis_label"] == "§ 30(1) BSIG"
    assert "Störfall" in rows17["DE"]["note"]

    all_rows = isb.get("/api/governance/legal", params={"jurisdiction": "DE"}).json()
    assert len(all_rows) == len({x["requirement_id"] for x in all_rows}) >= 170
    assert sum(1 for x in all_rows if x["status"] == "binding") == 170  # chapters 1-16 with a statutory link


def test_ir_profile_makes_annex_binding(login):
    isb = login("isb@demo.local")
    ents = _ents(isb)
    ats = ents["ATS"]["id"]
    rid = _req_id(isb, "5.1.1")
    item = {i["requirement_id"]: i for i in isb.get(f"/api/governance/legal/entities/{ats}").json()["items"]}[
        rid
    ]
    assert item["status"] == "binding" and item["jurisdiction"] == "DE"
    r = isb.put(
        f"/api/governance/profiles/{ats}",
        json={"nis2_entity_type": "Important – MSP", "ir_2024_2690_applicable": True},
    )
    assert r.status_code == 200
    item = {i["requirement_id"]: i for i in isb.get(f"/api/governance/legal/entities/{ats}").json()["items"]}[
        rid
    ]
    assert item["status"] == "binding" and item["jurisdiction"] == "EU"
    isb.put(
        f"/api/governance/profiles/{ats}",
        json={"nis2_entity_type": "Important", "ir_2024_2690_applicable": False},
    )
    # contributors cannot change profiles, not even for their own entities
    nl = login("nl.contact@demo.local")
    assert (
        nl.put(
            f"/api/governance/profiles/{ents['ATN']['id']}", json={"ir_2024_2690_applicable": True}
        ).status_code
        == 403
    )


def test_curate_legal_tag_permissions(login):
    isb, viewer = login("isb@demo.local"), login("viewer@demo.local")
    rid = _req_id(isb, "17.2")
    row = next(
        x
        for x in isb.get(f"/api/governance/legal/requirements/{rid}").json()["rows"]
        if x["jurisdiction"] == "DE"
    )
    assert viewer.patch(f"/api/governance/legal/{row['id']}", json={"status": "binding"}).status_code == 403
    r = isb.patch(
        f"/api/governance/legal/{row['id']}", json={"status": "binding", "note": "Site under 12. BImSchV"}
    )
    assert r.status_code == 200 and r.json()["status"] == "binding" and r.json()["is_auto"] is False
    # rebuild keeps curated rows
    assert isb.post("/api/governance/legal/rebuild", json={}).status_code == 200
    row2 = next(
        x
        for x in isb.get(f"/api/governance/legal/requirements/{rid}").json()["rows"]
        if x["jurisdiction"] == "DE"
    )
    assert row2["status"] == "binding"
    isb.post("/api/governance/legal/rebuild", json={"overwrite_curated": True})
    row3 = next(
        x
        for x in isb.get(f"/api/governance/legal/requirements/{rid}").json()["rows"]
        if x["jurisdiction"] == "DE"
    )
    assert row3["status"] == "benchmark" and row3["is_auto"] is True


def test_binding_gaps_scoped(login):
    isb, nl = login("isb@demo.local"), login("nl.contact@demo.local")
    data = isb.get("/api/governance/binding-gaps").json()
    by = {e["entity"]["code"]: e for e in data["entities"]}
    assert by["ATL"]["binding"] == 170 and by["ATN"]["binding"] > 150
    assert by["ATL"]["open"] == by["ATL"]["findings"] + by["ATL"]["unanswered"]
    codes = {e["entity"]["code"] for e in nl.get("/api/governance/binding-gaps").json()["entities"]}
    assert codes == {"ATN", "ATC"}


# --------------------------------------------------------------------------- registrations


def test_registration_change_creates_two_week_deadline(login):
    isb = login("isb@demo.local")
    regs = isb.get("/api/governance/registrations").json()
    atl = next(r for r in regs if r["entity"]["code"] == "ATL")
    detail = isb.get(f"/api/governance/registrations/{atl['id']}").json()
    assert [s["field"] for s in detail["sheet"]][:3] == ["legal_name", "legal_form", "register_number"]
    body = {
        k: detail[k]
        for k in (
            "portal",
            "status",
            "registration_number",
            "submitted_at",
            "registered_at",
            "legal_name",
            "legal_form",
            "register_number",
            "address",
            "entity_type",
            "contact_point",
            "contact_point_phone",
            "contact_point_email",
            "contact_person",
            "contact_person_phone",
            "contact_person_email",
            "public_ip_ranges",
            "domain_names",
            "sectors",
            "member_states",
            "authorities",
            "scope_rationale",
            "reviewed_at",
            "notes",
        )
    }
    known = date.today() - timedelta(days=2)
    body.update(
        public_ip_ranges=[*body["public_ip_ranges"], "192.0.2.128/25"],
        known_at=known.isoformat(),
        notes="internal note only",
    )
    r = isb.put(f"/api/governance/registrations/{atl['id']}", json=body)
    assert r.status_code == 200, r.text
    new = [c for c in r.json()["changes"] if c["field"] == "public_ip_ranges" and not c["reported_at"]]
    assert len(new) == 1 and new[0]["due_at"] == (known + timedelta(days=14)).isoformat()
    assert not any(c["field"] == "notes" for c in r.json()["changes"])  # internal fields are not reportable
    # reporting needs a date not before the change and a reference
    cid = new[0]["id"]
    assert (
        isb.post(
            f"/api/governance/registration-changes/{cid}/report",
            json={"reported_at": (known - timedelta(days=1)).isoformat(), "reference": "X"},
        ).status_code
        == 400
    )
    r = isb.post(
        f"/api/governance/registration-changes/{cid}/report",
        json={"reported_at": date.today().isoformat(), "reference": "BSI-CHG-1"},
    )
    assert r.status_code == 200 and r.json()[0]["state"] == "reported"
    # entity master data mirrors the registration
    ent = isb.get(f"/api/entities/{atl['entity']['id']}").json()
    assert (
        ent["registration_status"] == "confirmed"
        and ent["registration_reference"] == body["registration_number"]
    )


def test_registration_rbac(login):
    isb, nl, viewer = login("isb@demo.local"), login("nl.contact@demo.local"), login("viewer@demo.local")
    ents = _ents(isb)
    pg_reg = next(r for r in isb.get("/api/governance/registrations").json() if r["entity"]["code"] == "ATL")
    assert nl.get(f"/api/governance/registrations/{pg_reg['id']}").status_code == 403
    assert all(r["entity"]["code"] in ("ATN", "ATC") for r in nl.get("/api/governance/registrations").json())
    assert (
        nl.post(
            "/api/governance/registrations", json={"entity_id": ents["ATN"]["id"], "jurisdiction": "NL"}
        ).status_code
        == 403
    )
    assert viewer.get(f"/api/governance/registrations/{pg_reg['id']}").status_code == 200
    assert viewer.delete(f"/api/governance/registrations/{pg_reg['id']}").status_code == 403
    # create NL registration as ISB, then a draft can be deleted
    r = isb.post(
        "/api/governance/registrations",
        json={
            "entity_id": ents["ATC"]["id"],
            "jurisdiction": "NL",
            "status": "draft",
            "register_number": "KvK 12345678",
        },
    )
    assert r.status_code == 200 and r.json()["portal"].startswith("MijnNCSC")
    assert (
        isb.post(
            "/api/governance/registrations", json={"entity_id": ents["ATC"]["id"], "jurisdiction": "NL"}
        ).status_code
        == 409
    )
    assert nl.get(f"/api/governance/registrations/{r.json()['id']}").status_code == 200
    assert isb.delete(f"/api/governance/registrations/{r.json()['id']}").status_code == 200


# --------------------------------------------------------------------------- obligations


def test_completing_recurring_obligation_creates_next(login):
    isb = login("isb@demo.local")
    atn = _ents(isb)["ATN"]["id"]
    r = isb.post(
        "/api/governance/obligations",
        json={
            "entity_id": atn,
            "kind": "bcm_test",
            "title": "Restore test",
            "due_date": "2026-11-30",
            "recurrence": "annual",
            "legal_ref": "Cbb Art. 9",
        },
    )
    assert r.status_code == 200
    oid = r.json()["id"]
    r = isb.post(f"/api/governance/obligations/{oid}/complete", json={"note": "Done"})
    assert r.status_code == 200
    assert r.json()["completed"]["status"] == "done"
    assert r.json()["next"]["due_date"] == "2027-11-30" and r.json()["next"]["previous_id"] == oid
    assert isb.post(f"/api/governance/obligations/{oid}/complete", json={}).status_code == 400


def test_obligation_owner_can_complete_and_scoping(login):
    isb, it, nl, viewer = (
        login("isb@demo.local"),
        login("it@demo.local"),
        login("nl.contact@demo.local"),
        login("viewer@demo.local"),
    )
    ents = _ents(isb)
    r = isb.post(
        "/api/governance/obligations",
        json={
            "entity_id": ents["ATL"]["id"],
            "title": "Firewall rule review",
            "due_date": "2026-10-15",
            "owner_user_id": it.me["id"],
        },
    )
    oid = r.json()["id"]
    assert any(o["id"] == oid for o in it.get("/api/governance/my-obligations").json()["obligations"])
    assert viewer.post(f"/api/governance/obligations/{oid}/complete", json={}).status_code == 403
    assert it.post(f"/api/governance/obligations/{oid}/complete", json={}).status_code == 200
    # entity scoping: nl.contact sees only ATN/ATC obligations and cannot create any
    codes = {o["entity"]["code"] for o in nl.get("/api/governance/obligations").json() if o["entity"]}
    assert codes <= {"ATN", "ATC"}
    assert (
        nl.post(
            "/api/governance/obligations",
            json={"entity_id": ents["ATN"]["id"], "title": "x", "due_date": "2026-10-15"},
        ).status_code
        == 403
    )
    assert (
        viewer.post("/api/governance/obligations", json={"title": "x", "due_date": "2026-10-15"}).status_code
        == 403
    )


# --------------------------------------------------------------------------- management body


def test_new_board_member_gets_training_obligation(login):
    isb = login("isb@demo.local")
    ents = _ents(isb)
    r = isb.post(
        "/api/governance/board-members",
        json={
            "entity_id": ents["ATN"]["id"],
            "name": "Lotte Visser",
            "function": "Directeur",
            "appointed_at": "2025-05-01",
        },
    )
    assert r.status_code == 200
    mid = r.json()["id"]
    assert r.json()["training"]["status"] == "due" and r.json()["training"]["deadline"] == "2028-08-15"
    obs = [
        o
        for o in isb.get("/api/governance/obligations", params={"status": "open"}).json()
        if o["source_type"] == "board_member" and o["source_id"] == mid
    ]
    assert len(obs) == 1 and obs[0]["due_date"] == "2028-08-15" and obs[0]["kind"] == "training"
    # certificate training closes the obligation (NL is one-off)
    r = isb.post(
        "/api/governance/trainings",
        json={
            "person_name": "Lotte Visser",
            "board_member_ids": [mid],
            "title": "Bestuurderstraining Cbw",
            "provider": "Academy",
            "training_date": "2026-09-20",
            "start_time": "09:00",
            "end_time": "12:30",
            "topics": ["Cbw duties"],
            "legal_refs": ["Cbw Art. 24"],
            "has_certificate": True,
            "cert_holder_name": "Lotte Visser",
            "cert_issued_on": "2026-09-20",
            "cert_language": "NL",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["duration_minutes"] == 210 and r.json()["entity_ids"] == [ents["ATN"]["id"]]
    tid = r.json()["id"]
    assert not [
        o
        for o in isb.get("/api/governance/obligations", params={"status": "open"}).json()
        if o["source_type"] == "board_member" and o["source_id"] == mid
    ]
    matrix = isb.get("/api/governance/training-matrix").json()
    row = next(m for e in matrix for m in e["members"] if m["member"]["id"] == mid)
    assert row["status"] == "compliant"
    # comments and document links work on training records and decisions
    assert (
        isb.post(
            "/api/comments",
            params={"target_type": "training", "target_id": tid},
            json={"body": "Certificate checked"},
        ).status_code
        == 200
    )
    # deleting the training reopens the requirement
    assert isb.delete(f"/api/governance/trainings/{tid}").status_code == 200
    row = next(
        m
        for e in isb.get("/api/governance/training-matrix").json()
        for m in e["members"]
        if m["member"]["id"] == mid
    )
    assert row["status"] == "due"
    assert isb.delete(f"/api/governance/board-members/{mid}").status_code == 200


def test_board_rbac_and_decisions(login):
    isb, nl, viewer = login("isb@demo.local"), login("nl.contact@demo.local"), login("viewer@demo.local")
    ents = _ents(isb)
    codes = {m["entity"]["code"] for m in nl.get("/api/governance/board-members").json()}
    assert codes == {"ATN", "ATC"}
    assert {e["entity"]["code"] for e in nl.get("/api/governance/training-matrix").json()} == {"ATN", "ATC"}
    assert (
        nl.post(
            "/api/governance/board-members", json={"entity_id": ents["ATN"]["id"], "name": "X"}
        ).status_code
        == 403
    )
    assert (
        viewer.post(
            "/api/governance/decisions",
            json={
                "entity_id": ents["ATL"]["id"],
                "decided_on": "2026-09-01",
                "decision_type": "other",
                "subject": "x",
            },
        ).status_code
        == 403
    )
    # decision fulfilling the annual measures approval completes the obligation and schedules the next one
    ob = next(
        o
        for o in isb.get(
            "/api/governance/obligations", params={"entity_id": ents["ATC"]["id"], "status": "open"}
        ).json()
        if o["kind"] == "measures_approval"
    )
    r = isb.post(
        "/api/governance/decisions",
        json={
            "entity_id": ents["ATC"]["id"],
            "decided_on": date.today().isoformat(),
            "decision_type": "approve_measures",
            "subject": "Measures 2026/27 approved",
            "complete_obligation_id": ob["id"],
        },
    )
    assert r.status_code == 200 and r.json()["code"].startswith("BD-")
    assert any(link["type"] == "obligation" for link in r.json()["linked"])
    did = r.json()["id"]
    obs = isb.get("/api/governance/obligations", params={"entity_id": ents["ATC"]["id"]}).json()
    assert next(o for o in obs if o["id"] == ob["id"])["status"] == "done"
    assert any(o["previous_id"] == ob["id"] and o["status"] == "open" for o in obs)
    assert nl.get(f"/api/governance/decisions/{did}").status_code == 200
    pg_dec = next(d for d in isb.get("/api/governance/decisions").json() if d["entity"]["code"] == "ATL")
    assert nl.get(f"/api/governance/decisions/{pg_dec['id']}").status_code == 403
    assert (
        nl.get(
            "/api/comments", params={"target_type": "board_decision", "target_id": pg_dec["id"]}
        ).status_code
        == 403
    )
    assert isb.delete(f"/api/governance/decisions/{did}").status_code == 200


def test_training_rule_is_editable_by_group_manager_only(login):
    isb, nl = login("isb@demo.local"), login("nl.contact@demo.local")
    rules = {r["jurisdiction"]: r for r in isb.get("/api/governance/training-rules").json()}
    de = rules["DE"]
    assert de["is_statutory"] is False and de["cadence_months"] == 24
    payload = {
        k: de[k]
        for k in ("label", "initial_months", "count_from", "cadence_months", "requires_certificate", "note")
    }
    assert nl.put(f"/api/governance/training-rules/{de['id']}", json=payload).status_code == 403
    assert (
        isb.put(
            f"/api/governance/training-rules/{de['id']}", json={**payload, "cadence_months": 36}
        ).status_code
        == 200
    )
    assert isb.put(f"/api/governance/training-rules/{de['id']}", json=payload).json()["cadence_months"] == 24


def test_reminders_run(login):
    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.features.governance.reminders import run_governance_reminders
    from app.models import Notification

    login("isb@demo.local")
    with SessionLocal() as db:
        assert run_governance_reminders(db) > 0  # demo data has overdue obligations
        before = db.scalar(select(func.count(Notification.id)))
        run_governance_reminders(db)  # deduplicated per day
        assert db.scalar(select(func.count(Notification.id))) == before


# --------------------------------------------------------------------------- security regressions


def _full_reg_body(detail: dict) -> dict:
    keys = (
        "portal",
        "status",
        "registration_number",
        "submitted_at",
        "registered_at",
        "legal_name",
        "legal_form",
        "register_number",
        "address",
        "entity_type",
        "contact_point",
        "contact_point_phone",
        "contact_point_email",
        "contact_person",
        "contact_person_phone",
        "contact_person_email",
        "public_ip_ranges",
        "domain_names",
        "sectors",
        "member_states",
        "authorities",
        "scope_rationale",
        "reviewed_at",
        "notes",
    )
    return {k: detail[k] for k in keys}


def test_registration_change_duty_cannot_be_bypassed(login):
    isb = login("isb@demo.local")
    ats = next(r for r in isb.get("/api/governance/registrations").json() if r["entity"]["code"] == "ATS")
    url = f"/api/governance/registrations/{ats['id']}"
    # no way back to draft, no silent withdraw via PUT, no delete
    assert isb.patch(url, json={"status": "draft"}).status_code == 400
    assert isb.put(url, json={"status": "not_registered"}).status_code == 400
    assert isb.patch(url, json={"status": "withdrawn"}).status_code == 400
    assert isb.delete(url).status_code == 400
    # known_at in the future or out of range is rejected
    future = (date.today() + timedelta(days=3)).isoformat()
    assert isb.patch(url, json={"legal_form": "AG", "known_at": future}).status_code == 422
    assert isb.patch(url, json={"reviewed_at": "9999-01-01"}).status_code == 422
    # withdraw is an explicit, audited action; later edits are still recorded as reportable changes
    assert isb.post(f"{url}/withdraw", json={"reason": "x"}).status_code == 422
    r = isb.post(f"{url}/withdraw", json={"reason": "Entity merged into ATL"})
    assert r.status_code == 200 and r.json()["status"] == "withdrawn"
    ent = isb.get(f"/api/entities/{ats['entity']['id']}").json()
    assert ent["registration_status"] == "not_registered"
    r = isb.patch(url, json={"contact_person": "Someone Else"})
    assert r.status_code == 200
    assert any(c["field"] == "contact_person" and not c["reported_at"] for c in r.json()["changes"])
    assert isb.patch(url, json={"status": "draft"}).status_code == 400
    assert isb.delete(url).status_code == 400
    # re-registration is possible
    assert isb.patch(url, json={"status": "submitted"}).json()["status"] == "submitted"


def test_partial_updates_keep_other_fields(login):
    isb = login("isb@demo.local")
    ents = _ents(isb)
    atl = next(r for r in isb.get("/api/governance/registrations").json() if r["entity"]["code"] == "ATL")
    before = isb.get(f"/api/governance/registrations/{atl['id']}").json()
    r = isb.put(f"/api/governance/registrations/{atl['id']}", json={"notes": "partial update"})
    assert r.status_code == 200
    after = r.json()
    for k in ("legal_name", "public_ip_ranges", "status", "registration_number", "contact_person"):
        assert after[k] == before[k], k
    assert _full_reg_body(after)["notes"] == "partial update"

    ob = isb.post(
        "/api/governance/obligations",
        json={
            "entity_id": ents["ATL"]["id"],
            "title": "Partial test",
            "due_date": "2026-12-01",
            "recurrence": "annual",
            "legal_ref": "§ 30 BSIG",
        },
    ).json()
    r = isb.put(f"/api/governance/obligations/{ob['id']}", json={"title": "Renamed"})
    assert (
        r.status_code == 200 and r.json()["due_date"] == "2026-12-01" and r.json()["recurrence"] == "annual"
    )
    assert r.json()["legal_ref"] == "§ 30 BSIG" and r.json()["entity_id"] == ents["ATL"]["id"]
    assert isb.patch(f"/api/governance/obligations/{ob['id']}", json={"title": None}).status_code == 422
    assert (
        isb.patch(f"/api/governance/obligations/{ob['id']}", json={"due_date": "1900-01-01"}).status_code
        == 422
    )

    m = next(x for x in isb.get("/api/governance/board-members").json() if x["name"] == "Dr. Katrin Vogel")
    r = isb.put(f"/api/governance/board-members/{m['id']}", json={"notes": "Chair"})
    assert (
        r.status_code == 200
        and r.json()["appointed_at"] == m["appointed_at"]
        and r.json()["name"] == m["name"]
    )
    assert (
        isb.patch(f"/api/governance/board-members/{m['id']}", json={"left_at": "2000-01-01"}).status_code
        == 422
    )

    d = next(x for x in isb.get("/api/governance/decisions").json() if x["code"] == "BD-002")
    r = isb.put(f"/api/governance/decisions/{d['id']}", json={"participants": "Board"})
    assert (
        r.status_code == 200
        and r.json()["subject"] == d["subject"]
        and r.json()["decided_on"] == d["decided_on"]
    )

    t = next(x for x in isb.get("/api/governance/trainings").json() if x["has_certificate"])
    r = isb.put(f"/api/governance/trainings/{t['id']}", json={"notes": "Checked"})
    assert r.status_code == 200
    body = r.json()
    assert (
        body["topics"] == t["topics"]
        and body["has_certificate"]
        and body["cert_issued_on"] == t["cert_issued_on"]
    )
    assert body["board_member_ids"] == t["board_member_ids"]


def test_obligation_owner_must_see_entity(login):
    isb, nl = login("isb@demo.local"), login("nl.contact@demo.local")
    ents = _ents(isb)
    # nl.contact reads governance only for ATN / ATC
    assert (
        isb.post(
            "/api/governance/obligations",
            json={
                "entity_id": ents["ATL"]["id"],
                "title": "x",
                "due_date": "2026-12-01",
                "owner_user_id": nl.me["id"],
            },
        ).status_code
        == 400
    )
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Stakeholder

    with SessionLocal() as db:
        local = db.scalar(select(Stakeholder.id).where(Stakeholder.user_id == nl.me["id"]))
    assert (
        isb.post(
            "/api/governance/obligations",
            json={
                "entity_id": ents["ATL"]["id"],
                "title": "x",
                "due_date": "2026-12-01",
                "owner_stakeholder_id": local,
            },
        ).status_code
        == 400
    )
    ok = isb.post(
        "/api/governance/obligations",
        json={
            "entity_id": ents["ATN"]["id"],
            "title": "NL owner",
            "due_date": "2026-12-01",
            "owner_user_id": nl.me["id"],
        },
    )
    assert ok.status_code == 200
    assert (
        isb.patch(
            f"/api/governance/obligations/{ok.json()['id']}", json={"entity_id": ents["ATL"]["id"]}
        ).status_code
        == 400
    )
    # an obligation that slipped through (legacy data) is not shown to or reminded to an owner without access
    from app.core.deps import build_principal
    from app.features.governance.hooks import _my_obligations
    from app.features.governance.models import Obligation
    from app.features.governance.reminders import run_governance_reminders
    from app.models import Notification, User

    with SessionLocal() as db:
        leak = Obligation(
            entity_id=ents["ATL"]["id"],
            kind="other",
            title="Secret ATL duty",
            due_date=date.today(),
            owner_user_id=nl.me["id"],
            source="manual",
        )
        db.add(leak)
        db.commit()
        run_governance_reminders(db)
        assert not db.scalar(
            select(Notification.id).where(
                Notification.user_id == nl.me["id"], Notification.title.contains("Secret ATL duty")
            )
        )
        pr = build_principal(db.get(User, nl.me["id"]))
        assert not any(i["title"] == "Secret ATL duty" for i in _my_obligations(db, pr, {local}))
        lid = leak.id
    assert not any(
        o["title"] == "Secret ATL duty"
        for o in nl.get("/api/governance/my-obligations").json()["obligations"]
    )
    assert nl.post(f"/api/governance/obligations/{lid}/complete", json={}).status_code == 403


def test_decision_links_must_be_internal_paths(login):
    isb = login("isb@demo.local")
    atl = _ents(isb)["ATL"]["id"]
    base = {"entity_id": atl, "decided_on": "2026-09-01", "decision_type": "other", "subject": "Links"}
    for bad in (
        "https://evil.example",
        "//evil.example",
        "/\\evil.example",
        "javascript:alert(1)",
        "/a b",
        "/" + "x" * 400,
    ):
        r = isb.post(
            "/api/governance/decisions", json={**base, "linked": [{"type": "link", "label": "x", "url": bad}]}
        )
        assert r.status_code == 422, bad
    r = isb.post(
        "/api/governance/decisions",
        json={**base, "linked": [{"type": "link", "label": "Risk", "url": "/risks/4"}]},
    )
    assert r.status_code == 200
    assert (
        isb.post(
            "/api/governance/decisions",
            json={**base, "decided_on": (date.today() + timedelta(days=5)).isoformat()},
        ).status_code
        == 422
    )
    isb.delete(f"/api/governance/decisions/{r.json()['id']}")


def test_completion_and_report_bounds(login):
    isb = login("isb@demo.local")
    ents = _ents(isb)
    ob = isb.post(
        "/api/governance/obligations",
        json={"entity_id": ents["ATN"]["id"], "title": "Bounds", "due_date": "2026-12-01"},
    ).json()
    url = f"/api/governance/obligations/{ob['id']}/complete"
    assert (
        isb.post(url, json={"completed_at": (date.today() + timedelta(days=1)).isoformat()}).status_code
        == 422
    )
    assert isb.post(url, json={"completed_at": "2020-01-01"}).status_code == 400
    assert isb.post(url, json={"completed_at": "9999-12-31"}).status_code == 422
    assert isb.post(url, json={}).status_code == 200
    # training obligations of board members close only through a training record
    tr = next(
        o
        for o in isb.get("/api/governance/obligations", params={"status": "open"}).json()
        if o["source_type"] == "board_member"
    )
    assert tr["can_complete"] is False
    assert isb.post(f"/api/governance/obligations/{tr['id']}/complete", json={}).status_code == 400
    # a reported change cannot be reported again
    atl = next(r for r in isb.get("/api/governance/registrations").json() if r["entity"]["code"] == "ATL")
    r = isb.patch(f"/api/governance/registrations/{atl['id']}", json={"legal_form": "GmbH & Co. KG"})
    cid = next(c["id"] for c in r.json()["changes"] if c["field"] == "legal_form" and not c["reported_at"])
    body = {"reported_at": date.today().isoformat(), "reference": "REF-1"}
    assert isb.post(f"/api/governance/registration-changes/{cid}/report", json=body).status_code == 200
    assert (
        isb.post(
            f"/api/governance/registration-changes/{cid}/report", json={**body, "reference": "REF-2"}
        ).status_code
        == 409
    )
