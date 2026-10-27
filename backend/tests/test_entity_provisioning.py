from sqlalchemy import func, select

from app.db import SessionLocal
from app.features.governance.models import EntityProfile, Obligation
from app.features.governance.seed import ensure_entity_reference
from app.models import Answer, Assessment, AssessmentRound, Entity

ANSWER_FIELDS = (
    "implemented",
    "documented",
    "effectiveness",
    "evidence",
    "gap_description",
    "recommended_action",
    "responsible_id",
    "target_date",
    "effort",
    "notes",
)


def _create(isb, code, **extra):
    body = {"code": code, "name": f"Test {code}", "finding_prefix": code, "country": "NL", **extra}
    r = isb.post("/api/entities", json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _seed_obligations(db, entity_id):
    return db.scalar(
        select(func.count(Obligation.id)).where(
            Obligation.entity_id == entity_id, Obligation.source == "seed"
        )
    )


def test_new_entity_gets_assessment_in_open_round(login):
    isb = login("isb@demo.local")
    eid = _create(isb, "PRV1")
    with SessionLocal() as db:
        open_rounds = db.scalar(
            select(func.count(AssessmentRound.id)).where(AssessmentRound.status != "closed")
        )
        asms = db.scalars(select(Assessment).where(Assessment.entity_id == eid)).all()
        assert open_rounds >= 1 and len(asms) == open_rounds
        answers = db.scalars(select(Answer).where(Answer.assessment_id == asms[0].id)).all()
        assert len(answers) == 174
        assert {a.scope for a in answers} == {"In Scope"}
        for field in ANSWER_FIELDS:
            assert {getattr(a, field) for a in answers} == {None}, field


def test_new_entity_gets_governance_reference(login):
    isb = login("isb@demo.local")
    eid = _create(isb, "PRV2")
    with SessionLocal() as db:
        existing = db.scalar(
            select(Entity.id).where(
                Entity.country == "NL", Entity.is_headquarters.is_(False), Entity.id != eid
            )
        )
        expected = _seed_obligations(db, existing)
        assert expected > 0
        assert _seed_obligations(db, eid) == expected
        assert db.scalar(select(EntityProfile).where(EntityProfile.entity_id == eid)) is not None


def test_ensure_entity_reference_is_idempotent(login):
    isb = login("isb@demo.local")
    eid = _create(isb, "PRV3")
    with SessionLocal() as db:
        before = (
            _seed_obligations(db, eid),
            db.scalar(select(func.count(EntityProfile.id)).where(EntityProfile.entity_id == eid)),
        )
        entity = db.get(Entity, eid)
        ensure_entity_reference(db, entity)
        ensure_entity_reference(db, entity)
        db.flush()
        after = (
            _seed_obligations(db, eid),
            db.scalar(select(func.count(EntityProfile.id)).where(EntityProfile.entity_id == eid)),
        )
        assert before == after and before[1] == 1
        db.rollback()


def test_entity_profile_rationale_not_prefilled(login):
    isb = login("isb@demo.local")
    eid = _create(isb, "PRV4")
    with SessionLocal() as db:
        profile = db.scalar(select(EntityProfile).where(EntityProfile.entity_id == eid))
        assert not profile.rationale


def test_update_keeps_fields_the_body_omits(login):
    isb = login("isb@demo.local")
    eid = _create(isb, "KEEP", legal_form="B.V.", size_class="medium", activity_sector="chemicals")
    body = {"code": "KEEP", "name": "Renamed", "finding_prefix": "KEEP", "country": "NL"}
    assert isb.put(f"/api/entities/{eid}", json=body).status_code == 200
    e = isb.get(f"/api/entities/{eid}").json()
    assert e["name"] == "Renamed"
    assert (e["legal_form"], e["size_class"], e["activity_sector"]) == ("B.V.", "medium", "chemicals")


def test_seed_reference_does_not_recreate_deleted_obligations(login):
    from app.features.governance.seed import seed_reference

    isb = login("isb@demo.local")
    eid = _create(isb, "PRV5")
    with SessionLocal() as db:
        assert _seed_obligations(db, eid) > 0
        for o in db.scalars(select(Obligation).where(Obligation.entity_id == eid)):
            db.delete(o)
        db.commit()
        seed_reference(db)
        db.commit()
        assert _seed_obligations(db, eid) == 0
