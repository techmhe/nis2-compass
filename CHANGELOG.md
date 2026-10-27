# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
