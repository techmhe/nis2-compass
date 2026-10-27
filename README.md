# NIS2 Compass

Web-based NIS-2 assessment and implementation management for a company group with several legal entities.
It replaces the two Excel workbooks in [`templates/`](templates/) — the **NIS2 GAP Analysis Questionnaire** and the
**NIS2 Implementation Project Plan** — and adds a document store, a regulations library, task management, an
incident register and an AI assistant.

## Features

| Area | What you get |
|---|---|
| **GAP assessment** | 174 requirements (161 from the Annex of Implementing Regulation (EU) 2024/2690 + 13 national: § 32/33/38 BSIG, OT) per legal entity; scope / implemented / documented / effectiveness scoring identical to the workbook formulas; evidence, gap, recommended action, responsible, target date, effort; finding IDs; assessment rounds with copy-forward; answer history with revert; copy answers between entities; bulk edit; core-question filter; keyboard-driven workspace |
| **Dashboard** | Coverage and average score per entity, chapter × entity compliance matrix with targets, gap-to-target ranking, answer distribution, action-plan and project indicators |
| **Action plan** | Consolidated AP-### items from findings (entity + requirement), acceptance criterion, expected evidence, due status (overdue / due soon / on track), "findings not yet in the plan" |
| **Project management** | Master plan with phases, dependencies (cycle-checked), gates with decisions, weekly Gantt, RACI matrix, risks/issues/decisions register, project dashboard |
| **Work packages & tasks** | WP-### bundling findings from several entities, task-based progress, Kanban board, checklists, comments, evidence-request tasks linked to answers |
| **My work** | Personal view of everything assigned to a user or to their role (tasks, answers, action items, activities, RAID records, gate decisions, document reviews) |
| **Documents** | Upload with versioning, automatic text extraction (PDF, Office, OpenDocument, e-mail, text), full-text search, links to requirements/answers/tasks/…, review dates, policy acknowledgements, classification incl. restricted documents |
| **Regulations library** | NIS2 Directive, IR 2024/2690, BSIG (NIS2UmsuCG), Dutch Cyberbeveiligingswet and -besluit, Störfall-Verordnung (full texts) and ISO/IEC 27001:2022 (titles only); every requirement linked to its legal basis, national equivalents and ISO controls; custom regulations via JSON import |
| **Incidents** | Incident register with the NIS2 Art. 23 / § 32 BSIG reporting clock (24 h early warning, 72 h notification, 1 month final report) and timeline |
| **AI assistant** | Chat over everything the user may see (documents, answers, requirements, law texts, tasks …) with cited sources, read-only tool calls, semantic search (pgvector) and AI drafting of findings and document summaries. Works with any OpenAI-compatible API |
| **Security** | OIDC (Entra ID, Keycloak, …) and local accounts, RBAC with entity-scoped roles, server-side sessions, CSRF protection, argon2id, login throttling, audit log, API tokens, strict security headers, upload validation |
| **Excel** | GAP workbook export with one Requirements sheet and one assessment sheet per entity (formulas stay intact), import of filled-in GAP workbooks with dry run |
| **Governance** | Legal basis per requirement and jurisdiction (binding under § 30 BSIG / Cbb Art. 6–18 vs. IR 2024/2690 benchmark), registrations (BSI portal / MijnNCSC) with a two-week change alarm, obligations calendar, management body register with decisions and training records (§ 38 BSIG, Cbw Art. 24 certificates) |
| **Risk register** | Risk method per entity, threat catalogue (BSI elementary threats + OT), inherent/residual 5×5 heat map, treatment linked to the action plan, risk acceptance only via 4-eyes approval, "create risk from gap", Excel export |
| **Approvals** | Generic 4-eyes approvals for documents, assessment answers, risk acceptances and more; version pinning ("changed after approval"), approval inbox |
| **Controls & KPIs** | Recurring control calendar per entity with results and evidence, evidence freshness per answer, documented exceptions with expiry, KPIs (computed and manual) for the effectiveness evaluation |
| **Incident reporting** | Significance wizard (DE: IR 2024/2690 Art. 3(1) criteria as BSI indicator; NL: Regeling cyberbeveiliging EZK Art. 12 for manufacturing), separate reporting tracks per entity and authority (BSI, NCSC-NL, GDPR, CRA) with deadlines and checklists, recurring-incident detection (IR Art. 4) |
| **Suppliers** | Supplier register with tiers, certificates, contract clause checklist IR 2024/2690 5.1.4 (a)–(h), assessments with review cycles, questionnaire export/import |
| **Services & continuity** | Service and asset inventory with dependencies and import wizard, BIA with derived MTPD/RTO/RPO, continuity plans, exercise and restore-test log |
| **Reports & data quality** | Printable management report with frozen snapshots, ISO/IEC 27001 applicability view derived from the assessment, evidence pack (ZIP) per entity for authorities, plausibility checks with deep links, AI evidence check against the check points |

## Architecture

- **Backend:** Python 3.14+, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 17 with pgvector (full-text search in German/English/Dutch and vector search in one database).
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui (Radix), TanStack Query, Recharts.
- **Deployment:** one application container (API + built frontend), PostgreSQL, Caddy as reverse proxy with automatic HTTPS (ACME / Let's Encrypt in production, internal CA for testing).

## Run locally (macOS, no Docker)

Requirements: Homebrew `postgresql@17`, `pgvector`, `caddy`, plus `uv` and Node.js 22+.

```bash
brew install postgresql@17 pgvector caddy
scripts/dev.sh --demo          # dev mode with hot reload  ->  http://localhost:5173
scripts/run-local.sh           # production-like, HTTPS     ->  https://nis2.localhost:8443
```

Both scripts start a project-local PostgreSQL cluster in `.data/pg` on port 55432 (`scripts/dev-db.sh start|stop|psql|reset`).

Demo accounts (only with `--demo`): `isb@demo.local`, `pm@demo.local`, `assessor@demo.local`, `it@demo.local`,
`nl.contact@demo.local` (scoped to the Dutch entities), `viewer@demo.local`, `auditor@demo.local` — password
`Demo-Password-2026!`. Administrator: with `scripts/dev.sh`, which sets the bootstrap admin `admin@example.local` / `Admin-Password-2026!` (dev only); `scripts/run-local.sh` sets none and shows the setup page on first start.

## Deploy on a server (Docker)

```bash
cd deploy
cp .env.example .env           # set DOMAIN, TLS_MODE, POSTGRES_PASSWORD, NIS2_SECRET_KEY
docker compose up -d --build
```

First-run setup happens in the browser: open `https://<DOMAIN>/` and the setup page creates the administrator and
the first entities. **Complete it before the server is reachable from the network.** Until setup is done, whoever
reaches a fresh install first becomes the administrator. On OIDC-only installs the setup administrator remains a
local break-glass account; keep its password safe. To sign in with it on an OIDC-only install, `NIS2_LOCAL_AUTH_ENABLED=true` is needed. `NIS2_BOOTSTRAP_ADMIN_*` is only a hook for tests and automation.

- `TLS_MODE=internal` → self-signed certificate (testing, also works with an IP address as `DOMAIN`).
- `TLS_MODE=you@example.com` → Let's Encrypt certificate; ports 80/443 must be reachable and `DOMAIN` must resolve to the server.
- `TLS_ISSUER=acme` → certificate from your **internal ACME CA**:
  set `ACME_CA_URL` (directory URL) and optionally `ACME_EMAIL`, and copy the CA's root certificate to
  `deploy/certs/acme-ca-root.pem`. The CA must be able to reach the server on port 80 (HTTP-01) or 443 (TLS-ALPN-01).
  If the CA requires External Account Binding, use `TLS_ISSUER=acme_eab` and put `ACME_EAB_KID`/`ACME_EAB_HMAC`
  into `deploy/caddy.env` (see `caddy.env.example`), so that only the proxy sees them.
- Every `*.pem`/`*.crt` in `deploy/certs/` is also trusted by the app for outgoing TLS (OIDC issuer, AI endpoint, SMTP)
  when these use certificates from the internal CA. Python requires a standards-compliant CA certificate
  (`basicConstraints` CA:TRUE and `keyUsage` keyCertSign).
- Certificate settings are deliberately environment-only: they are shown read-only in Admin → System but cannot be
  changed from the web UI, so a compromised admin account cannot redirect certificate issuance or trust.
- Backups: `deploy/backup.sh` (database dump + uploaded files, integrity check, deletes backups older than
  `BACKUP_KEEP_DAYS`, default 30). Restore commands are in the script. Daily schedule with systemd:
  `sudo cp deploy/systemd/nis2-backup.* /etc/systemd/system/` (adjust the path in the service file), then
  `sudo systemctl enable --now nis2-backup.timer`. Copy `deploy/backups/` to off-site storage and test a restore
  at least once a year.
- Updates: `git pull && docker compose up -d --build` (migrations run automatically on start).

### Single sign-on (OIDC)

Register an application at your IdP with redirect URI `https://<DOMAIN>/api/auth/oidc/callback`, then set
`NIS2_OIDC_*` in `.env`. Map IdP groups to roles with `NIS2_OIDC_ROLE_MAPPING`, e.g.
`{"nis2-admins":"admin","nis2-isb":"security_officer","nis2-nl":"contributor@ATN,contributor@ATC"}`.
Existing local accounts are linked on first SSO login only when the IdP asserts a verified e-mail (or
`NIS2_OIDC_TRUST_EMAIL=true`) and never for administrator accounts.

### AI assistant

Administration → AI assistant: base URL of an OpenAI-compatible API (`/v1`), API key, chat model and optionally an
embedding model (enables semantic search). Tested against the OpenAI API format; works with Azure OpenAI, LiteLLM,
vLLM, Ollama and similar gateways. The key is stored encrypted. The assistant only ever sees data the asking user is
allowed to read. For local testing without an endpoint there is a mock server: `backend/tests/mock_llm.py`.

### KPI values from other systems

KPI values can be imported as CSV (Controls → KPIs → Import values), also from a scheduled script with an API token
(Profile → API tokens). Columns: `kpi_code, entity_code, period, value, note`; `entity_code` is `group` for group-wide
KPIs, `period` is `2026-09`, `2026-Q3` or `2026` depending on the KPI's frequency. Example:

```bash
curl -fsS -H "Authorization: Bearer $NIS2_TOKEN" -F file=@kpis.csv \
  "https://nis2.example.com/api/controls/kpis/import?dry_run=false"
```

## Roles

| Role | Typical user | Rights |
|---|---|---|
| Administrator | IT admin | everything |
| Information Security Officer | ISB / CISO | everything except roles & system settings |
| Project Manager | PMO | project, work packages, tasks, action plan; read everything |
| Assessor | internal/external auditor conducting interviews | answer requirements, action plan, upload evidence |
| Contributor | entity contact, IT staff | answer requirements, upload evidence, work on own tasks |
| Viewer | management, stakeholders | read only |
| Auditor | internal audit | read only incl. audit log and exports |

Roles can be granted group-wide or for a single legal entity. Custom roles can be created in the UI.

## Development

```bash
cd backend && .venv/bin/python -m pytest          # API + scoring tests (uses database nis2_test)
cd backend && .venv/bin/ruff check app
cd frontend && npx tsc -b --noEmit && npm run build
cd frontend && npm run e2e                         # browser tests (Playwright, local Google Chrome)
```

- Verify (lint incl. security rules, format, API tests, type check, `npm audit`): `.claude/verify.sh`. It needs the
  database (`scripts/dev-db.sh start`) and the npm registry, and is silent on success. CI runs the same script
  (`.github/workflows/verify.yml`).
- Enable the git hooks once per clone: `git config core.hooksPath .githooks`. To skip the formatting commit in
  `git blame`: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
- Work happens on `plan/<slug>` branches and lands on `main` through a pull request. Commits follow
  [Conventional Commits](https://www.conventionalcommits.org/).
- Decisions live in `docs/adr/`, diagrams in `docs/diagrams/` (open the `.html`). The design system is described in `docs/DESIGN.md`. Security rules:
  [SECURITY.md](SECURITY.md).

The browser tests start their own API (port 8100) and web server (port 5180) against a fresh database `nis2_e2e`
with demo data, so the development database stays untouched. A second project, `first-run`, tests the setup page with
its own API (port 8101), web server (port 5181) and an empty database. They cover every main page (no crash, no horizontal
overflow), sign-in and sign-out, autosave in the assessment, bundling action plan items, report drafts, entity scoping,
read-only access and a layout check that no dialog content sticks out of its dialog. `npm run e2e -- --headed` shows
the browser, `npm run e2e:ui` opens Playwright's UI mode; the HTML report is in `frontend/playwright-report/`. After
an intended visual change of the login page, update the reference image with `npm run e2e -- --update-snapshots`.

Regulation texts are generated by the scripts in `tools/regulations/` from official sources (EUR-Lex / Publications
Office, gesetze-im-internet.de, wetten.overheid.nl). See `backend/app/seed/regulations/notes.md` for legal status
notes and sources.
