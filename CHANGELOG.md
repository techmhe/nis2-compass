# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
