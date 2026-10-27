"""Recurring control calendar, evidence freshness, exceptions and KPI / effectiveness metrics.

Research roadmap items 7 (C1, C2, C6) and 11 (C4). Background job: `app.features.controls.jobs.run_daily(db)`
(generates occurrences for the next 12 months, sends due/overdue reminders, expires exceptions and refreshes
computed KPIs); `daily_loop()` wraps it for the app lifespan.
"""
