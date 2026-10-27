# Backlog

Deferred items. Keep this list current; remove entries when done.

## Deferred (agreed to postpone)

- **Annual inventory review task** (IR 2024/2690 point 12.4.3): generate a yearly obligation/control occurrence per
  entity to review the service and asset inventory.
- **Training import from an LMS**: CSV/Excel import of awareness and management training records
  (currently entered manually in Governance → Trainings).
- **More browser tests**: SSO login (needs a mock IdP in the test run), approvals, document uploads.

## Done recently

- Browser tests with Playwright (`npm run e2e`, local Chrome, separate database `nis2_e2e`): all main pages, sign-in,
  autosave, bundling, report drafts, entity scoping, read-only access, dialog layout, login page screenshot.

- Central-at-HQ evidence in the subsidiary's evidence pack (HQ answer, evidence and documents per central row).
- Intra-group IT service agreement: supplier category "Intra-group IT service" and data-quality check S1.
- Server-side PDF export of the management report (Reports → Download PDF).

## Manual verification pending (environment needed)

- Opening GAP exports with 1, 4 and about 10 entities in Excel and LibreOffice (dashboard charts, formulas, sheet tabs).
- Docker Compose deployment with Let's Encrypt on a VM, `deploy/backup.sh` backup and restore.
- Certificate from the internal ACME CA (`TLS_ISSUER=acme`/`acme_eab`) and app trust of `deploy/certs/`.
- SSO against the real identity provider (tested only against a mock OIDC provider).
- E-mail notifications via the real SMTP server.
- PDF preview of uploaded documents.
