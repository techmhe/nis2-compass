"""The one way a company comes into existence: setup, the entity API and the demo seed all call provision_entity."""

from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Answer, Assessment, AssessmentRound, Entity, Requirement
from app.services.scoring import recalc

ENTITY_HOOKS: list[Callable[[Session, Entity], None]] = []


def register_entity_hook(fn: Callable[[Session, Entity], None]) -> None:
    """Feature modules register what a new entity needs (reference data, defaults); hooks must be idempotent."""
    ENTITY_HOOKS.append(fn)


def provision_entity(db: Session, entity: Entity) -> None:
    """Give a persisted entity an assessment in every open round, then run the registered hooks.
    Flushes, never commits."""
    db.flush()
    reqs = db.scalars(select(Requirement).where(Requirement.is_active.is_(True))).all()
    for rnd in db.scalars(select(AssessmentRound).where(AssessmentRound.status != "closed")):
        asm = Assessment(round_id=rnd.id, entity_id=entity.id)
        db.add(asm)
        db.flush()
        for r in reqs:
            a = Answer(assessment_id=asm.id, requirement_id=r.id, scope="In Scope")
            a.requirement = r
            recalc(a, entity.finding_prefix)
            db.add(a)
    for hook in ENTITY_HOOKS:
        hook(db, entity)
    db.flush()
