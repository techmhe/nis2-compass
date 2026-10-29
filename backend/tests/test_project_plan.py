from datetime import date, timedelta

import pytest

from app.services.project_plan import (
    WARNING,
    PlanError,
    PlanInputs,
    _assessment_weeks,
    earliest_end,
    phase_factors,
    schedule,
    template,
)

MONDAY = date(2026, 9, 21)


def inputs(**kw) -> PlanInputs:
    base = dict(
        start=MONDAY,
        end=None,
        capacity="part_time",
        assessment="sequential",
        starting_point="partial",
        external_support=False,
        companies=1,
    )
    base.update(kw)
    return PlanInputs(**base)


def friday(d: date) -> date:
    return d + timedelta(days=(4 - d.weekday()) % 7)


def last_finish(s) -> date:
    return max(x.finish for x in s.activities.values())


VARIANTS = [
    inputs(),
    inputs(capacity="dedicated", companies=4),
    inputs(assessment="parallel", companies=6, external_support=True),
    inputs(starting_point="none", start=date(2026, 10, 28)),
    inputs(starting_point="iso27001", start=date(2026, 10, 31), companies=3),
    inputs(companies=11),
    inputs(companies=12, external_support=True),
    inputs(companies=50, start=date(2026, 11, 2)),
    inputs(assessment="parallel", companies=50),
]


def test_template_matches_workbook():
    t = template()
    assert len(t.activities) == 26
    assert len(t.phases) == 6
    assert t.gates == tuple(f"Gate {i}" for i in range(1, 7))
    assert [a.code for a in t.activities if not a.dependencies] == ["P1.1"]
    p12 = next(a for a in t.activities if a.code == "P1.2")
    assert dict(p12.dependencies)["P1.1"] == 3


def test_factors_touch_only_their_phases():
    assert phase_factors(inputs(capacity="dedicated", companies=1))[0] == pytest.approx(0.7)
    assert phase_factors(inputs(capacity="dedicated")) == pytest.approx(
        [0.7, 0.7, 0.7 * 4 / 15, 0.7, 0.7, 0.7]
    )
    base = phase_factors(inputs(companies=1))
    seq = phase_factors(inputs(companies=4))
    assert [i for i in range(6) if seq[i] != base[i]] == [2]
    assert seq[2] == pytest.approx(16 / 15)
    ext = phase_factors(inputs(external_support=True))
    base = phase_factors(inputs())
    assert [i for i in range(6) if ext[i] != base[i]] == [2, 3]
    assert ext[2] == pytest.approx(base[2] * 0.9) and ext[3] == pytest.approx(base[3] * 0.9)
    none = phase_factors(inputs(starting_point="none"))
    iso = phase_factors(inputs(starting_point="iso27001"))
    assert none[4] == pytest.approx(1.25) and iso[4] == pytest.approx(0.6)
    assert [i for i in range(6) if none[i] != 1.0] == [2, 4] or none[0] == 1.0
    assert [i for i in range(6) if iso[i] != base[i]] == [4]


def test_assessment_weeks():
    assert _assessment_weeks(inputs(assessment="sequential", companies=1)) == 4
    assert _assessment_weeks(inputs(assessment="sequential", companies=10)) == 40
    assert _assessment_weeks(inputs(assessment="parallel", companies=1)) == 6
    assert _assessment_weeks(inputs(assessment="parallel", companies=4)) == 9
    assert _assessment_weeks(inputs(assessment="parallel", companies=0)) >= 4


@pytest.mark.parametrize("inp", VARIANTS)
def test_alignment(inp):
    for slot in schedule(inp).activities.values():
        assert slot.start.weekday() == 0
        assert slot.finish.weekday() == 4
        assert slot.finish >= slot.start + timedelta(days=4)


@pytest.mark.parametrize("inp", VARIANTS)
def test_dependencies_respected(inp):
    s = schedule(inp)
    t = template()
    for a in t.activities:
        assert s.activities[a.code].start >= inp.start
        for code, _lag in a.dependencies:
            assert s.activities[a.code].start >= s.activities[code].start
    for g in t.gates:
        assert s.gates[g] == max(s.activities[a.code].finish for a in t.activities if a.gate == g)
    dates = [s.gates[g] for g in t.gates]
    assert dates == sorted(dates)


@pytest.mark.parametrize("inp", VARIANTS)
def test_proposed_end_without_end_date(inp):
    s = schedule(inp)
    assert s.end == s.proposed_end == last_finish(s)
    assert s.fit_factor == 1.0
    assert s.warning is None


def test_fit_earlier_and_later():
    base = inputs()
    proposed = schedule(base).proposed_end
    for end in (proposed - timedelta(weeks=20), proposed + timedelta(weeks=20)):
        s = schedule(inputs(end=end))
        assert last_finish(s) == friday(end)
        assert s.end == end


def test_warning_boundary():
    base = inputs()
    proposed = schedule(base).proposed_end
    seen = set()
    for days in range(0, 250, 7):
        end = proposed - timedelta(days=days)
        s = schedule(inputs(end=end))
        ratio = (end - MONDAY).days / (proposed - MONDAY).days
        assert s.fit_factor == pytest.approx(ratio)
        assert (s.warning == WARNING) == (ratio < 0.75)
        seen.add(s.warning is None)
    assert seen == {True, False}
    low = next(
        s
        for d in range(0, 250, 7)
        if 0.7 <= (s := schedule(inputs(end=proposed - timedelta(days=d)))).fit_factor < 0.75
    )
    assert low.warning == WARNING
    high = next(
        s
        for d in range(0, 250, 7)
        if 0.8 <= (s := schedule(inputs(end=proposed - timedelta(days=d)))).fit_factor < 1.0
    )
    assert high.warning is None


def test_no_false_warning_when_most_time_is_kept():
    proposed = schedule(inputs()).proposed_end
    s = schedule(inputs(end=proposed - timedelta(days=70)))
    assert s.fit_factor > 0.8
    assert s.warning is None


@pytest.mark.parametrize("end", [date(2027, 10, 16), date(2027, 10, 17)])
def test_weekend_end_stays_in_its_week(end):
    s = schedule(inputs(end=end, starting_point="none"))
    assert last_finish(s) == date(2027, 10, 15)
    assert last_finish(s) <= end
    assert max(s.gates.values()) <= end


def test_infeasible_end_raises():
    inp = inputs(end=MONDAY + timedelta(weeks=4))
    with pytest.raises(PlanError) as exc:
        schedule(inp)
    assert exc.value.field == "end_date"
    assert exc.value.earliest_end == earliest_end(inp)


def test_saturday_start():
    s = schedule(inputs(start=date(2026, 9, 19)))
    assert s.activities["P1.1"].start == date(2026, 9, 21)


def test_fifty_sequential_companies():
    s = schedule(inputs(companies=50))
    gap_weeks = (s.phases[2][1].finish - s.phases[2][1].start).days / 7
    assert gap_weeks > 190
    assert s.end > MONDAY + timedelta(weeks=200)


def test_end_date_far_beyond_the_plan_is_rejected():
    far = MONDAY + timedelta(days=366 * 200)
    with pytest.raises(PlanError) as exc:
        schedule(inputs(end=far))
    assert exc.value.field == "end_date"
    assert "too late" in exc.value.message


def test_proposed_end_of_a_huge_group_is_accepted_as_end_date():
    big = inputs(companies=50)
    proposed = schedule(big).proposed_end
    assert proposed > MONDAY + timedelta(days=5 * 366)
    assert last_finish(schedule(inputs(companies=50, end=proposed))) == proposed
