"""Risk calculations: effective method per entity, score and level, appetite, review dates, reminders."""

import calendar
import hashlib
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.features.risks.models import LEVELS, Risk, RiskMethod
from app.services.notify import owner_user, remind_due

DEFAULT_LIKELIHOOD = [
    {"label": "Rare", "description": "Not expected within the next 10 years"},
    {"label": "Unlikely", "description": "Could occur once in 5 to 10 years"},
    {"label": "Possible", "description": "Could occur once in 1 to 5 years"},
    {"label": "Likely", "description": "Expected about once a year"},
    {"label": "Almost certain", "description": "Expected several times a year"},
]
DEFAULT_IMPACT = [
    {
        "label": "Negligible",
        "description": "No noticeable effect on production, customers or compliance; loss below EUR 10k",
    },
    {
        "label": "Minor",
        "description": "Short disruption (under 4 h) of a non-critical process; loss below EUR 100k",
    },
    {
        "label": "Moderate",
        "description": "Disruption of a critical process up to 1 day or noticeable customer impact; loss below EUR 1m",
    },
    {
        "label": "Major",
        "description": "Production stop of 1 to 5 days or a significant incident to report; loss below EUR 5m",
    },
    {
        "label": "Severe",
        "description": "Production stop over 5 days, harm to people or environment, or loss of licence; loss of EUR 5m or more",
    },
]
DEFAULT_ACCEPTANCE = (
    "Residual risks up to level medium may be accepted by the risk owner together with the Information Security "
    "Officer, with a documented justification. Residual risks rated high or very high may only be accepted by the "
    "management body of the entity concerned, for a limited period and with a treatment plan. Risks that affect "
    "the services the entity provides may not be accepted or transferred as a blanket measure (BSI guidance on "
    "§ 30 BSIG). Every accepted risk is reviewed at least once a year (IR 2024/2690, 2.1.4)."
)


@dataclass
class Method:
    """Plain view of a RiskMethod (also used when no method row exists yet)."""

    id: int | None = None
    entity_id: int | None = None
    name: str = "Group risk method"
    likelihood_scale: list = field(default_factory=lambda: [dict(x) for x in DEFAULT_LIKELIHOOD])
    impact_scale: list = field(default_factory=lambda: [dict(x) for x in DEFAULT_IMPACT])
    threshold_medium: int = 5
    threshold_high: int = 10
    threshold_very_high: int = 16
    appetite_level: str = "medium"
    acceptance_criteria: str | None = DEFAULT_ACCEPTANCE
    review_cycle_months: int = 12
    inherited: bool = False  # True when an entity uses the group default

    @classmethod
    def of(cls, m: RiskMethod, inherited: bool = False) -> "Method":
        return cls(
            id=m.id,
            entity_id=m.entity_id,
            name=m.name,
            likelihood_scale=m.likelihood_scale,
            impact_scale=m.impact_scale,
            threshold_medium=m.threshold_medium,
            threshold_high=m.threshold_high,
            threshold_very_high=m.threshold_very_high,
            appetite_level=m.appetite_level,
            acceptance_criteria=m.acceptance_criteria,
            review_cycle_months=m.review_cycle_months,
            inherited=inherited,
        )

    def level(self, likelihood: int | None, impact: int | None) -> str | None:
        if not likelihood or not impact:
            return None
        s = likelihood * impact
        if s >= self.threshold_very_high:
            return "very_high"
        if s >= self.threshold_high:
            return "high"
        if s >= self.threshold_medium:
            return "medium"
        return "low"

    def above_appetite(self, level: str | None) -> bool:
        return level is not None and LEVELS.index(level) > LEVELS.index(self.appetite_level)

    def matrix(self) -> list[list[str]]:
        """levels[likelihood-1][impact-1]"""
        return [[self.level(ll, i) for i in range(1, 6)] for ll in range(1, 6)]  # type: ignore[misc]


class MethodCache:
    def __init__(self, db: Session):
        self.db = db
        self.rows = {m.entity_id: m for m in db.scalars(select(RiskMethod))}
        self._cache: dict[int | None, Method] = {}

    def get(self, entity_id: int | None) -> Method:
        if entity_id not in self._cache:
            if entity_id in self.rows:
                self._cache[entity_id] = Method.of(self.rows[entity_id])
            elif None in self.rows:
                self._cache[entity_id] = Method.of(self.rows[None], inherited=entity_id is not None)
            else:
                self._cache[entity_id] = Method(inherited=entity_id is not None)
        return self._cache[entity_id]


def effective_method(db: Session, entity_id: int | None) -> Method:
    return MethodCache(db).get(entity_id)


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y, m = d.year + m // 12, m % 12 + 1
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


def acceptance_version(r: Risk, m: Method) -> tuple[str, str]:
    """Pinned state of a risk acceptance. Everything the acceptance decision rests on is part of the key: entity,
    residual rating, treatment options, justification (category and text), the method's levels and appetite, and
    whether the risk is currently accepted (closing or reopening an accepted risk ends the acceptance)."""
    basis = "|".join(
        str(x)
        for x in (
            r.entity_id,
            r.residual_likelihood,
            r.residual_impact,
            "+".join(sorted(r.treatments or [])),
            r.acceptance_category or "",
            (r.treatment_justification or "").strip(),
            m.id,
            m.threshold_medium,
            m.threshold_high,
            m.threshold_very_high,
            m.appetite_level,
            r.status == "accepted",
        )
    )
    key = f"L{r.residual_likelihood}I{r.residual_impact}:{hashlib.sha256(basis.encode()).hexdigest()[:40]}"
    lvl = m.level(r.residual_likelihood, r.residual_impact)
    label = (
        f"residual {lvl.replace('_', ' ') if lvl else 'not rated'} "
        f"(likelihood {r.residual_likelihood or '-'}, impact {r.residual_impact or '-'})"
    )
    return key, label


def transfer_only(r: Risk) -> bool:
    return (r.treatments or []) == ["transfer"]


def owner_user_id(db: Session, r: Risk) -> int | None:
    return owner_user(db, r.owner_user_id, r.owner_stakeholder_id)


def run_risk_reminders(db: Session) -> int:
    """Notify risk owners when a risk review is due within 14 days or overdue (IR 2.1.4 annual review).

    Deduplicated per risk and review date (due soon) and per risk, review date and week (overdue).
    Intended to be called from app.services.notify.run_reminders (hourly reminder loop)."""
    today = date.today()
    n = 0
    rows = db.scalars(
        select(Risk).where(
            Risk.status != "closed",
            Risk.next_review_date.is_not(None),
            Risk.next_review_date <= date.fromordinal(today.toordinal() + 14),
        )
    )
    for r in rows:
        # never notify people about risks they may not see
        n += remind_due(
            db,
            owner_user_id(db, r),
            key=f"risk:{r.id}",
            due=r.next_review_date,
            today=today,
            what=f"Risk review: {r.code} {r.title}",
            link=f"/risks/{r.id}",
            soon_kind="review_due",
            perm="risks.read",
            entity_id=r.entity_id,
        )
    db.commit()
    return n
