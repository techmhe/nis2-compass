# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.2] - 2026-10-29

### Changed
- Updating a deployment no longer needs a new `docker-compose.yml`: it defaults to the floating image tag `1`
  (newest 1.x release) and CI also publishes `latest`. `1` moves for the newest stable release of its major,
  `latest` for the newest overall, never for a pre-release or a re-run on an old tag. Image jobs run one at a
  time. The README explains how to verify what `:1` points to and pin the digest. An `APP_IMAGE` in `.env` still
  pins an exact image. Update with `docker compose pull && docker compose up -d`.
- Convention: a release that needs a new compose file says "Compose change required" in its section here.

## [1.2.1] - 2026-10-29

### Fixed
- The legal form of an entity is a select like the other fields, with "Other…" for forms that are not on the list
  (setup, Admin → Entities, entity page).
- Governance → legal basis: German requirements that link to a § 30(2) BSIG topic are now tagged binding (170
  instead of 9 for Germany), as the Dutch ones are under Cbb Art. 6–18. The IR (EU) 2024/2690 annex point stays the
  guidance on how to meet the duty. Chapter 17 (OT) stays a benchmark. Existing installs get the corrected tags on
  the next start; tags edited by hand are kept.

## [1.2.0] - 2026-10-29

### Added
- The first-run setup wizard has the steps Project and Roles. The project plan is scheduled from a start date, an
  optional end date and four sizing questions, with editable gate dates and a warning when the end date is tight.
  Project roles can be renamed, deselected or added.
- With OIDC enabled, roles take an e-mail address; the first OIDC login with a verified e-mail links the role to that
  person for "My work" and reminders (no permission is granted).
- API: `POST /api/setup/plan-preview` (schedule for the wizard, no login, only while setup is open) and the new
  fields `oidc_enabled`, `project_exists` and `roles` on `GET /api/setup/options` (`roles` is empty once setup is
  done). An end date more than five years after the start is rejected with 422.

### Changed
- Fresh installs no longer get the fixed 2026-2027 plan from the Excel template. Demo and bootstrap-admin installs get
  a default plan starting on the Monday of the current week. Existing installs keep their plan.

## [1.1.3] - 2026-10-28

### Upgrade notes
- Replace `docker-compose.yml` with this release's file: the app now gets the database password as
  `NIS2_DATABASE_PASSWORD` instead of inside the database URL. `.env` stays as it is.

### Fixed
- A database password with characters such as `/ @ : # ?` (for example from `openssl rand -base64`) broke the
  database connection, and the browser only showed 502. Any characters work now. README and `.env.example` explain
  that the database keeps the password it was created with, and how to change it.

### Changed
- CI uses actions/checkout 7.0.1 and setup-uv 10.3.0 (Node 24) with uv pinned to 0.10.4, and its checkout no longer
  keeps the job token.

## [1.1.2] - 2026-10-28

### Added
- Release images carry a signed GitHub build provenance attestation (Sigstore). The README shows how to verify an
  image with `gh attestation verify`, including the signing workflow and the release tag.

## [1.1.1] - 2026-10-27

### Added
- A disclaimer on the Help page and in the README: provided as is, developed with AI coding assistants, not legal
  advice, AI answers can be wrong.

### Changed
- `SECURITY.md` is written for reporters: private reporting through GitHub, supported versions, scope and what to
  expect.

## [1.1.0] - 2026-10-27

### Upgrade notes
- An install still running the example secret key (`change-me-…`) no longer starts. Set a new `NIS2_SECRET_KEY`
  (`openssl rand -hex 32`); this signs everyone out, invalidates all API tokens and the stored AI key: re-enter the
  AI key under Admin → AI and issue new tokens.
- SMTP STARTTLS now verifies the server certificate: a relay with an internal CA needs its root certificate in
  `deploy/certs/`, and `NIS2_SMTP_HOST` must be the name in the certificate (not an IP address).
- An AI API key set via `NIS2_AI_API_KEY` is only used with the base URL from `NIS2_AI_BASE_URL`.

### Security
- Upload limits are tighter: archives may unpack to 100 MiB, the compression-ratio check covers every member over
  1 MiB, and the GAP import streams the uploaded workbook instead of loading it whole.
- First-run setup requires a setup token, printed to the server log while setup is open (derived from
  `NIS2_SECRET_KEY`, or set `NIS2_SETUP_TOKEN`). Whoever reaches a fresh install first without the token can no
  longer take it over; anyone who can read the server log still can.
- Production refuses to start with a secret key containing `change-me`; `deploy/.env.example` ships it empty and
  the compose file requires it.
- SMTP STARTTLS verifies the server certificate and host name. Logs carry user ids instead of e-mail addresses, and
  database conflict errors log only the constraint name.
- Inventory only links, shows and imports suppliers the user may see: invisible ones are refused like unknown ids
  and appear as "Hidden supplier" in services, assets, the dependency tree and the BIA.
- The risk register export lists only risks within the caller's `reports.export` scope, and treatment-plan rows
  only for action items and work packages the caller may read.
- Changing the AI base URL without entering a key removes the stored API key, and the AI connection test no longer
  returns error details (they go to the server log).
- API tokens always expire (1 to 730 days, default 90); `expires_in_days: null` is refused, and migration 0008
  gives existing tokens without expiry 90 days. Changing the password
  with an API token also ends all of the user's sessions.
- Linking or unlinking a document on a task needs the right to edit that task. Stakeholder names in the GAP export
  are never written as formulas. A bootstrap admin password that breaks the password policy stops the seed.
- Markdown written by users (comments, notes, AI answers) no longer renders images, so a crafted image link cannot
  make a viewer's browser call the app's own export endpoints.
- Base images (Dockerfile, compose, CI) are pinned by version and digest, the CI actions by commit, and CI's
  `pip-audit` by version. uv in the image is 0.10.4.
- `deploy/docker-compose.yml` rotates container logs (10 MB x 5 files per service) and caps the app at 2 GB of memory.

### Fixed
- OIDC: when Entra ID leaves out the groups claim because a user is in too many groups ("overage"), the login
  logs a warning that says so. Mapped roles are still removed, as for a user without groups (fail closed).

### Changed
- New SSO users get no role unless a group mapping grants one (`NIS2_OIDC_DEFAULT_ROLE` defaults to empty, was
  `viewer`). Set it to keep the old behaviour.
- `deploy/docker-compose.yml` runs the published image of its release and carries the Caddy configuration inline, so
  a server needs only that file and `.env` (Docker Compose 2.23 or newer). `deploy/Caddyfile` is gone; building from
  source uses the new `deploy/docker-compose.build.yml` override.
- README: step-by-step Microsoft Entra ID setup (app roles recommended, group object IDs, overage, tenant issuer).

## [1.0.1] - 2026-10-27

### Security
- Authlib 1.9.1 (OIDC login): fixes CVE-2026-96760 in 1.8.0.

### Added
- Container image `ghcr.io/techmhe/nis2-compass` (linux/amd64), built by CI for every version tag once the checks
  pass, tagged `X.Y.Z` and `X.Y`, with provenance and SBOM attestations.

## [1.0.0] - 2026-10-27

Initial release.

### Added
- First-run setup at `/setup`: the first administrator and the group's companies (name, code, legal form, country,
  sector, size class, headquarters). Germany (BSIG) and the Netherlands (Cbw/Cbb) are supported; the jurisdiction
  registry is built to take more EU countries.
- GAP assessment of 174 NIS2 requirements per company, with Excel import and export of the GAP workbook.
- Action plan, project plan and work packages; risks, controls and KPIs; threat information and vulnerabilities;
  audits and effectiveness reviews.
- Incidents with reporting stages to the competent authorities.
- Governance, suppliers and inventory.
- Documents, comments, 4-eyes approvals, and a regulations library linked to each requirement.
- Unified search and an AI assistant (OpenAI-compatible API, read-only tools, answers checked against the caller's
  permissions).
- Role-based access with per-company scope; local login (argon2id) and OIDC; API tokens.
- Demo mode with a fictional group (`--demo`).
- Docker Compose deployment with Caddy (internal CA, Let's Encrypt or ACME with EAB) and a backup timer.
