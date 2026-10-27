"""Calculations reproduced 1:1 from the workbook formulas.

Score (entity sheet col N):
  blank if Scope <> "In Scope"; blank if no non-N/A answer in Implemented/Documented/Effectiveness;
  else (count(Yes)+count(Effective)+0.5*count(Partial)+0.25*count(Not Tested)) / count(non-N/A answers)
Work Package Required (col O):
  blank if out of scope or no answer; "Yes" if Implemented/Documented in (No, Partial) or Effectiveness in
  (Partial, Not Tested, Ineffective); else "No"
Finding ID (col U): "<entity prefix>-<requirement no.>" when a work package is required
Due Status (Action Plan col O / RAID col N), Schedule Status (Master Plan col P / Work Packages col P).
"""

from datetime import date, timedelta

ANSWER_POINTS = {
    "Yes": 1.0,
    "Effective": 1.0,
    "Partial": 0.5,
    "Not Tested": 0.25,
    "No": 0.0,
    "Ineffective": 0.0,
}
DUE_SOON_DAYS = 14


def score_answer(
    scope: str | None, implemented: str | None, documented: str | None, effectiveness: str | None
):
    if scope != "In Scope":
        return None
    given = [v for v in (implemented, documented, effectiveness) if v]
    counted = [v for v in given if v != "N/A"]
    if not counted:
        return None
    return sum(ANSWER_POINTS.get(v, 0.0) for v in counted) / len(counted)


def wp_required(
    scope: str | None, implemented: str | None, documented: str | None, effectiveness: str | None
):
    if scope != "In Scope" or not any((implemented, documented, effectiveness)):
        return None
    if implemented in ("No", "Partial") or documented in ("No", "Partial"):
        return True
    return effectiveness in ("Partial", "Not Tested", "Ineffective")


def finding_id(prefix: str, number: str, required: bool | None) -> str | None:
    return f"{prefix}-{number}" if required else None


def recalc(answer, prefix: str) -> None:
    answer.score = score_answer(answer.scope, answer.implemented, answer.documented, answer.effectiveness)
    answer.wp_required = wp_required(
        answer.scope, answer.implemented, answer.documented, answer.effectiveness
    )
    answer.finding_id = finding_id(prefix, answer.requirement.number, answer.wp_required)


def is_assessed(answer) -> bool:
    """Assessed = in scope and 'Implemented' answered (dashboard 'Assessed' column uses column J)."""
    return answer.scope == "In Scope" and bool(answer.implemented)


def due_status(
    target: date | None,
    status: str | None,
    today: date | None = None,
    done_values: tuple[str, ...] = ("Completed",),
) -> str | None:
    if not target:
        return None
    today = today or date.today()
    if status in done_values:
        return "Completed" if "Completed" in done_values else "Closed"
    if today > target:
        return "Overdue"
    if today + timedelta(days=DUE_SOON_DAYS) > target:
        return "Due soon"
    return "On track"


def raid_due_status(target: date | None, status: str | None, today: date | None = None) -> str | None:
    if not target:
        return None
    if status in ("Closed", "Accepted"):
        return "Closed"
    return due_status(target, status, today, done_values=())


def schedule_status(
    start: date | None, finish: date | None, status: str | None, today: date | None = None
) -> str:
    today = today or date.today()
    if status == "Completed":
        return "Green"
    if not start or not finish:
        return "Not Planned"
    if today > finish:
        return "Red"
    if today + timedelta(days=DUE_SOON_DAYS) > finish:
        return "Amber"
    return "Green"


def duration_weeks(start: date | None, finish: date | None) -> int | None:
    if not start or not finish:
        return None
    days = (finish - start).days + 1
    return -(-days // 7)  # ROUNDUP(days/7)
