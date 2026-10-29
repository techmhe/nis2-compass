"""Schedules the project plan template from the sizing answers of the first-run setup.

Pure: no database, no web framework. The template comes from the project workbook; durations and lags
(calendar days) are scaled per phase, run through a forward pass and aligned to Monday..Friday weeks.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from typing import Literal

from app.services.workbook import parse_project_workbook

Capacity = Literal["part_time", "dedicated"]
Assessment = Literal["sequential", "parallel"]
StartingPoint = Literal["none", "partial", "iso27001"]

WARNING = "The end date leaves less than 75% of the proposed time; the plan is compressed accordingly."
CAPACITY_FACTOR = {"part_time": 1.0, "dedicated": 0.7}
EXTERNAL_FACTOR = 0.9
STARTING_POINT_FACTOR = {"none": 1.25, "partial": 1.0, "iso27001": 0.6}
GAP_TEMPLATE_WEEKS = 15
WARN_BELOW = 0.75

GAP_PHASE, EXTERNAL_PHASES, REMEDIATION_PHASE = 2, (2, 3), 4
MIN_DAYS = 4  # Monday to Friday
FIT_ROUNDS, FIT_MAX, FIT_STEP = 40, 10.0, 0.005
MAX_PLAN_DAYS = 5 * 366  # the longest plan a user may ask for; the proposed end of a huge group always passes
_DEPENDENCY = re.compile(r"P\d+\.\d+")


@dataclass(frozen=True)
class PlanInputs:
    start: date
    end: date | None
    capacity: Capacity
    assessment: Assessment
    starting_point: StartingPoint
    external_support: bool
    companies: int


@dataclass(frozen=True)
class Slot:
    start: date
    finish: date


@dataclass(frozen=True)
class Schedule:
    activities: dict[str, Slot]
    gates: dict[str, date]
    phases: list[tuple[str, Slot]]
    proposed_end: date
    end: date
    fit_factor: float
    warning: str | None


class PlanError(ValueError):
    def __init__(self, field: str, message: str, earliest_end: date | None = None):
        super().__init__(message)
        self.field = field
        self.message = message
        self.earliest_end = earliest_end


@dataclass(frozen=True)
class TemplateActivity:
    code: str
    phase: int
    gate: str | None
    offset: int
    duration: int
    dependencies: tuple[tuple[str, int], ...]  # (code, lag = start - dependency finish)


@dataclass(frozen=True)
class Template:
    activities: tuple[TemplateActivity, ...]
    gates: tuple[str, ...]
    phases: tuple[str, ...]


@lru_cache(maxsize=1)
def template() -> Template:
    wb = parse_project_workbook()
    phases = tuple(wb["phases"])
    rows = wb["activities"]
    by_code = {a["code"]: a for a in rows}
    origin = min(a["planned_start"] for a in rows)
    out = []
    for a in rows:
        deps = tuple(
            (code, (a["planned_start"] - by_code[code]["planned_finish"]).days)
            for code in _DEPENDENCY.findall(a["dependency"] or "")
            if code in by_code
        )
        out.append(
            TemplateActivity(
                code=a["code"],
                phase=phases.index(a["phase"]),
                gate=a["gate"],
                offset=(a["planned_start"] - origin).days,
                duration=(a["planned_finish"] - a["planned_start"]).days,
                dependencies=deps,
            )
        )
    return Template(tuple(out), tuple(g["code"] for g in wb["gates"]), phases)


def _assessment_weeks(inputs: PlanInputs) -> int:
    n = max(inputs.companies, 1)
    weeks = 4 * n if inputs.assessment == "sequential" else 6 + (n - 1)
    return max(weeks, 4)


def phase_factors(inputs: PlanInputs) -> list[float]:
    factors = [CAPACITY_FACTOR[inputs.capacity]] * len(template().phases)
    factors[GAP_PHASE] *= _assessment_weeks(inputs) / GAP_TEMPLATE_WEEKS
    if inputs.external_support:
        for i in EXTERNAL_PHASES:
            factors[i] *= EXTERNAL_FACTOR
    factors[REMEDIATION_PHASE] *= STARTING_POINT_FACTOR[inputs.starting_point]
    return factors


def _monday(d: date) -> date:
    return d + timedelta(days=-d.weekday() % 7)


def _friday(d: date) -> date:
    return d + timedelta(days=(4 - d.weekday()) % 7)


def _week_friday(d: date) -> date:
    """Friday of the Monday..Sunday week that contains d (a weekend goes back, never forward)."""
    return d + timedelta(days=4 - d.weekday())


def _forward(inputs: PlanInputs, multiplier: float) -> dict[str, Slot]:
    tpl = template()
    factors = phase_factors(inputs)
    slots: dict[str, Slot] = {}
    for a in tpl.activities:
        f = factors[a.phase]
        if a.dependencies:
            raw = max(
                slots[code].finish + timedelta(days=round(lag * f * multiplier))
                for code, lag in a.dependencies
            )
            # Lags are scaled by this phase's factor while the dependency was scaled by its own, so an
            # overlap can reach back before the dependency began; never start before it or the project.
            raw = max(raw, inputs.start, *(slots[code].start for code, _lag in a.dependencies))
        else:
            raw = inputs.start + timedelta(days=round(a.offset * f))
        start = _monday(raw)
        finish = _friday(start + timedelta(days=max(round(a.duration * f * multiplier), MIN_DAYS)))
        slots[a.code] = Slot(start, finish)
    return slots


def _last_finish(slots: dict[str, Slot]) -> date:
    return max(s.finish for s in slots.values())


def earliest_end(inputs: PlanInputs) -> date:
    return _last_finish(_forward(inputs, 0.0))


def schedule(inputs: PlanInputs) -> Schedule:
    proposed = _forward(inputs, 1.0)
    proposed_end = _last_finish(proposed)
    if inputs.end is None:
        slots, end, fit = proposed, proposed_end, 1.0
    else:
        end = inputs.end
        limit = _week_friday(end)
        earliest = earliest_end(inputs)
        if limit < earliest:
            raise PlanError(
                "end_date", f"The end date is too early; the earliest feasible end is {earliest}.", earliest
            )
        stretched = _last_finish(_forward(inputs, FIT_MAX))
        latest = _week_friday(min(max(inputs.start + timedelta(days=MAX_PLAN_DAYS), proposed_end), stretched))
        if limit > latest:
            raise PlanError("end_date", f"The end date is too late; the latest end is {latest}.")
        # Week alignment makes the last finish slightly non-monotone in the multiplier, so a plain bisection
        # can settle in a local optimum. Scan down for the first multiplier that fits, then refine below it.
        steps = round(FIT_MAX / FIT_STEP)
        k = next(
            (k for k in range(steps, -1, -1) if _last_finish(_forward(inputs, k * FIT_STEP)) <= limit), 0
        )
        low, high = k * FIT_STEP, min((k + 1) * FIT_STEP, FIT_MAX)
        for _ in range(FIT_ROUNDS):
            mid = (low + high) / 2
            if _last_finish(_forward(inputs, mid)) <= limit:
                low = mid
            else:
                high = mid
        slots = _forward(inputs, low)
        fit = (end - inputs.start).days / (proposed_end - inputs.start).days
        # Week alignment makes the finish jump by weeks between neighbouring multipliers; the last
        # activity absorbs the remaining slack so the plan ends exactly in the week of the end date.
        last = max(slots, key=lambda code: slots[code].finish)
        slots[last] = Slot(slots[last].start, limit)
    tpl = template()
    gates = {
        g: max(slots[a.code].finish for a in tpl.activities if a.gate == g)
        for g in tpl.gates
        if any(a.gate == g for a in tpl.activities)
    }
    phases = []
    for i, name in enumerate(tpl.phases):
        members = [slots[a.code] for a in tpl.activities if a.phase == i]
        phases.append((name, Slot(min(m.start for m in members), max(m.finish for m in members))))
    return Schedule(
        activities=slots,
        gates=gates,
        phases=phases,
        proposed_end=proposed_end,
        end=end,
        fit_factor=fit,
        warning=WARNING if fit < WARN_BELOW else None,
    )
