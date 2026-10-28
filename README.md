# NIS2 Compass

Web-based NIS-2 assessment and implementation management for a company group with several legal entities.
It replaces the two Excel workbooks in [`templates/`](templates/) — the **NIS2 GAP Analysis Questionnaire** and the
**NIS2 Implementation Project Plan** — and adds a document store, a regulations library, task management, an
incident register and an AI assistant.

> **Use at your own risk.** Provided as is, without warranty, and developed with the help of AI coding assistants.
> Not legal advice. See [Disclaimer](#disclaimer).

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
`Demo-Password-2026!`. Administrator: with `scripts/dev.sh`, which sets the bootstrap admin `admin@example.local` / `Admin-Password-2026!` (dev only); `scripts/run-local.sh` sets none and shows the setup page on first start; it asks for the setup token from the API
log (or `cd backend && .venv/bin/python -m app.setup_token`).

## Deploy on a server (Docker)

A server needs two files from `deploy/`: `docker-compose.yml` and `.env.example`. The app image is published at
`ghcr.io/techmhe/nis2-compass`, and the compose file of each release points to that release's image.

```bash
mkdir nis2-compass && cd nis2-compass       # put docker-compose.yml and .env.example here
cp .env.example .env && chmod 600 .env      # set DOMAIN, TLS_MODE, POSTGRES_PASSWORD (`openssl rand -hex 24`), NIS2_SECRET_KEY (`openssl rand -hex 32`)
docker compose up -d
```

To try it on your own machine (also Docker in WSL 2), set `DOMAIN=localhost` and `TLS_MODE=internal` and open
`https://localhost`; the browser warns about the self-signed certificate.

**Database password.** The database takes `POSTGRES_PASSWORD` when it is first created and keeps it. Changing it in
`.env` later does not change the database, and the app can no longer connect (the browser shows 502, the app log
`password authentication failed`). To change it, set it in the database first, then in `.env`:
`docker compose exec db psql -U nis2 -d nis2`, there `\password nis2` (asks without echo, leaves nothing in the
shell history), then edit `.env` and run `docker compose up -d`. On a test install without data, `docker compose down -v` deletes the database instead. The
password may contain any characters; with a `$` in it, wrap the value in single quotes in `.env`.

A 502 in the browser means the app container is not answering: see `docker compose ps` and
`docker compose logs --tail 30 app`. On the first start it is still seeding for a minute or two.

Docker Compose 2.23 or newer is needed (the Caddy configuration is inline in the compose file). To build the
image from a source checkout instead: `cd deploy && docker compose -f docker-compose.yml -f docker-compose.build.yml
up -d --build`.

First-run setup happens in the browser: open `https://<DOMAIN>/` and the setup page creates the administrator and
the first entities. The page asks for a setup token, which the server prints once at start while setup is open
(`docker compose logs app`, or `docker compose exec app python -m app.setup_token`). It is derived from
`NIS2_SECRET_KEY`; set `NIS2_SETUP_TOKEN` to choose your own. Complete setup soon after the first start anyway: the
token only keeps out those who cannot read the server log. On OIDC-only installs the setup administrator remains a
local break-glass account; keep its password safe. To sign in with it on an OIDC-only install, `NIS2_LOCAL_AUTH_ENABLED=true` is needed. `NIS2_BOOTSTRAP_ADMIN_*` is only a hook for tests and automation.

- `TLS_MODE=internal` → self-signed certificate (testing, also works with an IP address as `DOMAIN`).
- `TLS_MODE=you@example.com` → Let's Encrypt certificate; ports 80/443 must be reachable and `DOMAIN` must resolve to the server.
- `TLS_ISSUER=acme` → certificate from your **internal ACME CA**:
  set `ACME_CA_URL` (directory URL) and optionally `ACME_EMAIL`, and copy the CA's root certificate to
  `certs/acme-ca-root.pem` next to the compose file. The CA must be able to reach the server on port 80 (HTTP-01) or 443 (TLS-ALPN-01).
  If the CA requires External Account Binding, use `TLS_ISSUER=acme_eab` and put `ACME_EAB_KID`/`ACME_EAB_HMAC`
  into `caddy.env` next to the compose file (copy `deploy/caddy.env.example`, `chmod 600`), so that only the proxy
  sees them.
- Every `*.pem`/`*.crt` in `certs/` is also trusted by the app for outgoing TLS (OIDC issuer, AI endpoint, SMTP)
  when these use certificates from the internal CA. Python requires a standards-compliant CA certificate
  (`basicConstraints` CA:TRUE and `keyUsage` keyCertSign).
- Certificate settings are deliberately environment-only: they are shown read-only in Admin → System but cannot be
  changed from the web UI, so a compromised admin account cannot redirect certificate issuance or trust.
- Backups: `deploy/backup.sh` (database dump + uploaded files, integrity check, deletes backups older than
  `BACKUP_KEEP_DAYS`, default 30). Restore commands are in the script. Daily schedule with systemd:
  `sudo cp deploy/systemd/nis2-backup.* /etc/systemd/system/` (adjust the path in the service file), then
  `sudo systemctl enable --now nis2-backup.timer`. Copy `deploy/backups/` to off-site storage and test a restore
  at least once a year.
- Updates: replace `docker-compose.yml` with the one from the new release, then `docker compose pull && docker
  compose up -d`. Migrations run automatically on start. An `APP_IMAGE` in `.env` overrides the compose file's
  image: update or remove it at the same time. To pin the exact image you checked, append its digest:
  `APP_IMAGE=ghcr.io/techmhe/nis2-compass:<version>@sha256:<digest>`.
- Verify an image before you run it (GitHub CLI):
  ```bash
  gh attestation verify oci://ghcr.io/techmhe/nis2-compass:<version> -R techmhe/nis2-compass \
    --signer-workflow techmhe/nis2-compass/.github/workflows/verify.yml --source-ref refs/tags/v<version>
  ```

  It checks the signed build provenance that CI attaches to every release image from 1.1.2 on: built by this
  repository's release workflow from the release tag.

### Single sign-on (OIDC)

Register an application at your IdP with redirect URI `https://<DOMAIN>/api/auth/oidc/callback`, then set
`NIS2_OIDC_*` in `.env`. Map IdP groups to roles with `NIS2_OIDC_ROLE_MAPPING`, e.g.
`{"nis2-admins":"admin","nis2-isb":"security_officer","nis2-nl":"contributor@ATN,contributor@ATC"}`.
New SSO users get no role unless a group mapping grants one (`NIS2_OIDC_DEFAULT_ROLE` is empty by default; set it,
e.g. to `viewer`, to change that), so they see nothing until an administrator assigns a role. With Entra ID set
"Assignment required = Yes" on the enterprise application so that only assigned people can sign in at all.
Existing local accounts are linked on first SSO login only when the IdP asserts a verified e-mail (or
`NIS2_OIDC_TRUST_EMAIL=true`) and never for administrator accounts.

Roles follow the mapping at every login: a user who leaves a mapped group loses that role at the next login. Roles
assigned by hand to roles that appear nowhere in the mapping are left alone. Signing out of the app does not sign
out of the IdP, and an account disabled at the IdP keeps an open session until it times out
(`NIS2_SESSION_IDLE_MINUTES`, default 8 hours idle; `NIS2_SESSION_ABSOLUTE_HOURS`, default 7 days) or an
administrator deactivates the user in the app.

#### Microsoft Entra ID

1. **App registration** (Entra admin center → App registrations → New registration): single tenant, platform "Web",
   redirect URI `https://<DOMAIN>/api/auth/oidc/callback`. Create a client secret under "Certificates & secrets" and
   note when it expires; logins fail after that until a new one is set.
2. **Roles, recommended: app roles.** Under "App roles" create roles for users, e.g. `nis2.admin`, `nis2.isb`,
   `nis2.nl`. Assign them to users or groups in the enterprise application (Users and groups). Then set
   `NIS2_OIDC_GROUPS_CLAIM=roles` and map the values:
   `NIS2_OIDC_ROLE_MAPPING={"nis2.admin":"admin","nis2.isb":"security_officer","nis2.nl":"contributor@ATN,contributor@ATC"}`.
   App roles are always in the token, under readable names, and do not depend on how many groups a user is in.
3. **Alternative: groups.** Under "Token configuration" add a groups claim ("Groups assigned to the application" is
   best). Entra sends group **object IDs**, not names, so the mapping keys are GUIDs:
   `{"6f1c…-…":"security_officer"}`. A user in more than about 200 groups gets no groups claim at all ("overage");
   the app then removes that user's mapped roles, as for a user in no group, and logs a warning. With "Security
   groups" or "All groups" any user who may create or join groups can cause this, so use app roles or "Groups
   assigned to the application" for anything privileged.
4. **Enterprise application → Properties:** "Assignment required = Yes", so only assigned people can sign in.
5. **`.env`:** `NIS2_OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0` with your tenant ID (`common`
   and `organizations` are not supported), client ID and secret. Entra omits `email_verified`; set
   `NIS2_OIDC_TRUST_EMAIL=true` only while accounts created locally before SSO are being linked by e-mail address,
   and switch it off afterwards: Entra does not verify the `email` attribute, so while it is on any identity in the
   tenant (guests included) whose e-mail matches a non-administrator local account takes that account over.

### AI assistant

Administration → AI assistant: base URL of an OpenAI-compatible API (`/v1`), API key, chat model and optionally an
embedding model (enables semantic search). Tested against the OpenAI API format; works with Azure OpenAI, LiteLLM,
vLLM, Ollama and similar gateways. The key is stored encrypted; changing the base URL without entering a key removes the stored one. The assistant only ever sees data the asking user is
allowed to read. For local testing without an endpoint there is a mock server: `backend/tests/mock_llm.py`.

### KPI values from other systems

KPI values can be imported as CSV (Controls → KPIs → Import values), also from a scheduled script with an API token
(Profile → API tokens; a token always expires, 1 to 730 days, 90 by default). Columns: `kpi_code, entity_code, period, value, note`; `entity_code` is `group` for group-wide
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

- Verify (lint incl. security rules, format, API tests, type check, `npm audit`, `pip-audit`): `.claude/verify.sh`.
  It needs the database (`scripts/dev-db.sh start`) and the package registries, and is silent on success. CI runs
  the same script (`.github/workflows/verify.yml`). A newly published advisory can turn it red without a code change.
- Enable the git hooks once per clone: `git config core.hooksPath .githooks`. To skip the formatting commit in
  `git blame`: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
- Development happens in a separate repository; each release is published here as one commit and one tag.
  Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
- Decisions live in `docs/adr/`, diagrams in `docs/diagrams/` (open the `.html`). The design system is described in `docs/DESIGN.md`. Reporting
  vulnerabilities: [SECURITY.md](SECURITY.md).

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

## Disclaimer

- **No warranty.** This software is provided "as is" under the [MIT License](LICENSE), without warranty of any kind.
  You use it at your own risk; the authors are not liable for any damage arising from its use, to the extent the
  law allows.
- **Built with AI assistance.** Much of the code and documentation was written with AI coding assistants (Claude
  Code) and reviewed, tested and security-reviewed before each release. AI-assisted code can still contain errors that
  review and tests miss. Review and test it in your own environment before you rely on it, and keep backups.
- **Not legal advice.** The requirement catalogue, the legal mappings, reporting deadlines, authorities and the
  regulation texts were compiled with care but can be incomplete, out of date or wrong, and the law changes. The
  official texts are authoritative. Whether your organisation is in scope and what it has to do is for you, your
  legal counsel and the competent authority to decide. Using this tool does not make an organisation compliant.
- **AI answers can be wrong.** The assistant's answers and drafts come from the language model you connect. Check
  them against the cited sources. Text sent to the assistant goes to that provider; choose one that fits your data
  protection obligations.
- **Not affiliated** with the European Union, ENISA, the BSI, the NCSC-NL or any identity or AI provider named here.
