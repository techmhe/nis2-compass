# Security

## Reporting a vulnerability

Report privately to the repository owner. Do not open a public issue.

## Rules for this repository

- Secrets come from the environment only. `backend/.env`, `deploy/.env` and `deploy/caddy.env` are ignored; the
  `.env.example` files next to them list the variables with placeholders.
- Development happens on `plan/<slug>` branches in a private repository. This repository receives one commit per
  release, built by a publish script that leaves out local-only files (agent settings, plans, specs) and refuses to
  publish when the snapshot or its metadata match a private list of patterns (names, hosts, home paths). Releases
  are never force-pushed.
- `.claude/verify.sh` is the gate: lint including the security rules (ruff `S`), format, the API tests, the
  frontend type check and the dependency audits: `npm audit` for the frontend (fails on high and critical
  findings) and, where `pip-audit` is installed, `pip-audit` for the backend. A newly published advisory can turn
  the gate red without a code change; that is intended.
- The `.githooks/pre-commit` hook blocks direct commits to `main` and staged credentials.
- New dependencies need a one-line justification in the pull request.
- Claude Code runs shell commands in the OS sandbox: writes only inside the repo, network only to the package
  registries, the model API and localhost (not to the git host), `~/.ssh`, `~/.aws`, the GitHub CLI login and token
  variables hidden. Only `git fetch`, `git pull` and the publish script run outside it, and the sandbox denies
  writes to that script, so a session cannot swap it out. The development repository's push URL points nowhere,
  so a plain `git push` fails. PostgreSQL cannot run inside the sandbox, so a human starts it
  (`scripts/dev-db.sh start`).
- One workflow, `.github/workflows/verify.yml`, runs on pushes and pull requests with a read-only token and no
  secrets. A pull request build is checked out detached; the workflow gives it its branch name for the test-tamper
  check only when the branch lives in this repository. A pull request from a fork stays detached, so every changed
  test fails there.
- A plan authorizes test changes only while its branch is working on it: a plan that is already on `main`
  unchanged does not count.
- CI is not a boundary against the author of a pull request. The gate and the workflow run from the pull request's
  own tree, so a pull request that changes `.claude/`, `.githooks/` or `.github/` changes its own check. Those
  paths always get a human review before merge.
- Existing tests are never edited or deleted to get green: `verify.sh` fails unless the active plan names the file.
- Every authorization fix gets a regression test in `backend/tests/`.

## Data

The tool stores personal data of its users and of people named in the compliance records: accounts (name, e-mail,
roles), the audit log, the management body register with training records, and incident records. It lives in
PostgreSQL and in the upload directory. Access is role-based with entity scope; restricted documents are limited
further.
