"""Computed KPI sources for open critical/high vulnerabilities and critical patch/remediation latency.

Registered into the controls module's computation registry (`app.features.controls.kpi.COMPUTATIONS`) rather
than editing that shared file: any `MetricDefinition` whose `computation` matches one of these keys is refreshed
by the controls module's existing `refresh_computed` / daily job, exactly like a built-in computation."""

from datetime import date
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.features.controls.kpi import COMPUTATIONS
from app.features.threats.models import Vulnerability

OPEN_HIGH_CRIT_KEY = "threats_open_high_crit_vulns"
CRIT_REMEDIATION_KEY = "threats_crit_remediation_days"


def _scoped(db: Session, entity_id: int | None) -> list[Vulnerability]:
    stmt = select(Vulnerability)
    if entity_id is not None:
        stmt = stmt.where(Vulnerability.entity_id == entity_id)
    return list(db.scalars(stmt))


def _open_high_crit_vulns(db: Session, entity_id: int | None, start: date, end: date) -> float | None:
    """Critical/high vulnerabilities open at the end of the period (snapshot)."""
    n = 0
    for v in _scoped(db, entity_id):
        if v.severity not in ("critical", "high") or v.status == "accepted" or v.discovered_on > end:
            continue
        if v.remediated_on is None or v.remediated_on > end:
            n += 1
    return float(n)


def _crit_remediation_days(db: Session, entity_id: int | None, start: date, end: date) -> float | None:
    """Median days from discovery to remediation for critical vulnerabilities remediated in the period."""
    days = [
        (v.remediated_on - v.discovered_on).days
        for v in _scoped(db, entity_id)
        if v.severity == "critical"
        and v.status in ("remediated", "mitigated")
        and v.remediated_on
        and start <= v.remediated_on <= end
    ]
    return float(median(days)) if days else None


COMPUTATIONS[OPEN_HIGH_CRIT_KEY] = (
    "Critical or high vulnerabilities still open at period end",
    _open_high_crit_vulns,
    True,
)
COMPUTATIONS[CRIT_REMEDIATION_KEY] = (
    "Median days from discovery to remediation, critical vulnerabilities remediated in the period",
    _crit_remediation_days,
    False,
)
