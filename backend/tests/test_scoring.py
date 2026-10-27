from datetime import date

from app.services.scoring import due_status, duration_weeks, schedule_status, score_answer, wp_required


def test_score_matches_workbook_formula():
    assert score_answer("In Scope", "Yes", "Yes", "Effective") == 1.0
    assert score_answer("In Scope", "Yes", "Yes", "Not Tested") == (1 + 1 + 0.25) / 3
    assert score_answer("In Scope", "Partial", "No", "Ineffective") == 0.5 / 3
    assert score_answer("In Scope", "Yes", "N/A", None) == 1.0  # N/A and blanks excluded
    assert score_answer("In Scope", "N/A", "N/A", "N/A") is None
    assert score_answer("In Scope", None, None, None) is None
    assert score_answer("Central at HQ", "Yes", "Yes", "Effective") is None


def test_75_percent_is_implemented_and_documented_but_untested():
    assert round(score_answer("In Scope", "Yes", "Yes", "Not Tested"), 4) == 0.75


def test_work_package_required():
    assert wp_required("In Scope", "Yes", "Yes", "Effective") is False
    assert wp_required("In Scope", "Yes", "Partial", "Effective") is True
    assert wp_required("In Scope", "Yes", "Yes", "Not Tested") is True
    assert wp_required("In Scope", "Yes", "Yes", "N/A") is False
    assert wp_required("In Scope", None, None, None) is None
    assert wp_required("Not Applicable", "No", "No", "No") is None


def test_due_and_schedule_status():
    today = date(2026, 10, 1)
    assert due_status(date(2026, 9, 30), "In Progress", today) == "Overdue"
    assert due_status(date(2026, 10, 10), "In Progress", today) == "Due soon"
    assert due_status(date(2026, 12, 1), "Not Started", today) == "On track"
    assert due_status(date(2026, 9, 1), "Completed", today) == "Completed"
    assert schedule_status(date(2026, 9, 1), date(2026, 9, 20), "In Progress", today) == "Red"
    assert schedule_status(date(2026, 9, 1), date(2026, 10, 5), "In Progress", today) == "Amber"
    assert schedule_status(None, None, "Not Started", today) == "Not Planned"
    assert duration_weeks(date(2026, 9, 21), date(2026, 9, 25)) == 1
    assert duration_weeks(date(2026, 10, 5), date(2026, 10, 16)) == 2
