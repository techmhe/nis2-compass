# Security policy

## Supported versions

Only the latest release gets security fixes. Please check that the issue still exists in it before reporting.

## Reporting a vulnerability

Report privately through GitHub: **Security → Report a vulnerability**
(<https://github.com/techmhe/nis2-compass/security/advisories/new>). Do not open a public issue, pull request or
discussion for a vulnerability.

Helpful to include:
- the version or image digest, and whether you run the Docker deployment or a local setup
- where it is: API endpoint, page, deploy kit (compose file, Caddy configuration, backup script), container image or CI
- the steps to reproduce, ideally as a request sequence or a short script
- which account it needs: none, a read-only viewer, a contributor scoped to one company, an administrator
- the impact as you see it, and a fix if you have one

What to expect: this is a project maintained in spare time, so handling is best effort. You get an acknowledgement
once the report has been read, and a fix lands in a new release with a note in the CHANGELOG; tell us if you want
to be credited. Please keep the details private until that release is out, or for 90 days, whichever comes first.
There is no bug bounty.

## Scope

Especially interesting:
- a user scoped to one company seeing or changing another company's data
- a role doing more than its permissions allow (viewer writing, contributor approving, ...)
- sign-in, sessions, CSRF, API tokens, OIDC
- injection of any kind, uploads and imports (documents, Excel workbooks, archives)
- the AI assistant revealing data the asking user may not see
- the container image and the deploy kit as shipped

Out of scope:
- issues that need an administrator account, unless they reach the host or another company's data beyond what an
  administrator may see anyway
- deployments that depart from the documented setup (for example the app port exposed without the proxy, weak or
  example secrets)
- vulnerabilities in dependencies without a demonstrated impact on this application (report them upstream)
- denial of service by sheer volume, and findings from automated scanners without a working attack
- demo mode (`--demo`) and its published demo passwords, which are meant for evaluation only

Test only against an installation you run yourself, and do not access, keep or change other people's data.

## How releases are built

- Each release is one commit and one tag in this repository, built from a separate development repository.
- Every push runs the checks in `.claude/verify.sh` in CI: lint including the security rules, format, the API tests,
  the frontend type check and the dependency audits (`npm audit`, `pip-audit`).
- The container image `ghcr.io/techmhe/nis2-compass` is built by CI from the release tag only after those checks
  pass, with provenance and SBOM attestations. Base images and CI actions are pinned by digest. To pin the image
  itself, set `APP_IMAGE=ghcr.io/techmhe/nis2-compass:<version>@sha256:<digest>` in `.env`.

## Data

The tool stores personal data of its users and of people named in the compliance records: accounts (name, e-mail,
roles), the audit log, the management body register with training records, and incident records. It lives in
PostgreSQL and in the upload directory. Access is role-based with entity scope; restricted documents are limited
further. Whoever operates an installation is responsible for it under data protection law, including the choice of
AI provider: text sent to the assistant goes to the provider configured under Administration → AI assistant.
