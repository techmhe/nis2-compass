"""German legal tags: the ten § 30(2) BSIG topics are binding for entities outside IR (EU) 2024/2690."""

from sqlalchemy import select

from app.db import SessionLocal
from app.features.governance.models import RequirementLegal
from app.features.governance.seed import seed_reference
from app.models import Requirement, RequirementProvision


def _de_row(db, number: str) -> RequirementLegal:
    return db.scalar(
        select(RequirementLegal)
        .join(Requirement, Requirement.id == RequirementLegal.requirement_id)
        .where(Requirement.number == number, RequirementLegal.jurisdiction == "DE")
    )


def test_de_topic_is_binding_with_statutory_note():
    with SessionLocal() as db:
        row = _de_row(db, "1.1.1")
        assert row.status == "binding" and row.basis_label == "§ 30(2) Nr. 1 BSIG"
        assert "statutory duty" in row.note.lower() and "shows how the duty can be met" in row.note
        assert "§ 30(3) BSIG" in row.note


def test_de_chapter_17_stays_benchmark():
    with SessionLocal() as db:
        row = _de_row(db, "17.1")
        assert row.status == "benchmark" and row.basis_label == "§ 30(1) BSIG"


def test_de_binding_count_matches_linked_requirements():
    with SessionLocal() as db:
        rows = db.scalars(select(RequirementLegal).where(RequirementLegal.jurisdiction == "DE")).all()
        binding = [r for r in rows if r.status == "binding"]
        assert len(binding) == 170
        assert all(r.basis_label for r in binding)
        assert not any(r.status == "binding" for r in rows if r.basis_label == "§ 30(1) BSIG")


def test_seed_keeps_curated_row():
    with SessionLocal() as db:
        row = _de_row(db, "1.1.1")
        row.is_auto, row.status = False, "guidance"
        db.flush()
        seed_reference(db)
        assert _de_row(db, "1.1.1").status == "guidance"
        db.rollback()


def test_seed_refreshes_old_automatic_tag():
    with SessionLocal() as db:
        row = _de_row(db, "1.1.1")
        row.status, row.note = "benchmark", "Benchmark from the Annex of IR (EU) 2024/2690"
        db.flush()
        seed_reference(db)
        row = _de_row(db, "1.1.1")
        assert row.status == "binding" and "statutory duty" in row.note.lower()
        db.rollback()


def test_de_topic_without_30_2_link_is_benchmark_without_statutory_note():
    with SessionLocal() as db:
        req = db.scalar(select(Requirement).where(Requirement.number == "1.1.1"))
        links = [
            rp
            for rp in db.scalars(
                select(RequirementProvision).where(RequirementProvision.requirement_id == req.id)
            )
            if rp.provision.regulation.code == "BSIG" and rp.provision.key.startswith("30.2")
        ]
        assert links
        for rp in links:
            db.delete(rp)
        db.flush()
        db.expire_all()
        seed_reference(db)
        row = _de_row(db, "1.1.1")
        assert row.status == "benchmark"
        assert "Statutory duty under § 30(2)" not in row.note and "§ 30(1) BSIG" in row.note
        db.rollback()
