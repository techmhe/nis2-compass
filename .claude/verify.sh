#!/usr/bin/env bash
# Deterministic project gate. Silent on success; prints only the failing
# tool's output. Exit 0 = pass, 1 = fail.
#
# Covers the backend (ruff incl. the bandit rules, format, pytest, dependency
# audit) and the frontend (type check, npm audit). The Playwright browser tests
# are too slow and need a local Chrome, so they stay out of the gate: run
# `npm run e2e` in frontend/ for UI changes.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

step() { # <dir> <cmd...>; prints output and fails only if the command fails
  local dir=$1 out rc
  shift
  out=$(cd "$dir" && "$@" 2>&1); rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '$ (cd %s && %s)\n%s\n' "$dir" "$*" "$out"
    exit 1
  fi
}

need() { # <path> <hint>; a missing toolchain must fail the gate, not skip it
  [ -e "$1" ] || { echo "verify: $1 is missing. Run: $2"; exit 1; }
}

# Test-tamper check. Existing test files deleted or modified relative to main
# must be named in the active plan (the docs/plans file whose Branch: is this
# branch), otherwise the gate fails. Prompting alone does not stop agents from
# weakening tests; a diff does. A human may override with ALLOW_TEST_CHANGES=1.
if [ "${ALLOW_TEST_CHANGES:-0}" != "1" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  base=""
  # Fully qualified: a tag called main or a branch called origin/main must not
  # stand in for the real one and empty the diff.
  for b in refs/heads/main refs/remotes/origin/main; do
    git rev-parse --verify --quiet "$b" >/dev/null && { base=$b; break; }
  done
  # A detached HEAD has no branch and therefore no plan: every changed test fails.
  branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo "")
  if [ -n "$base" ] && [ "$branch" != main ]; then
    changed=$(git diff --name-status "$base" -- 2>/dev/null | awk '$1 ~ /^(D|M|R)/ {print $NF}' \
      | grep -E '(^|/)(tests?|__tests__|spec|e2e)/|(^|/)test_[^/]*\.py$|_test\.py$|\.(test|spec)\.[cm]?[jt]sx?$' || true)
    if [ -n "$changed" ]; then
      plan=$(grep -lxF -- "Branch: $branch" docs/plans/*.md 2>/dev/null | head -1)
      # Only a plan this branch is working on counts. One that is already on
      # main unchanged is finished; a reused branch name must not inherit its
      # list of test files.
      [ -n "$plan" ] && git diff --quiet "$base" -- "$plan" 2>/dev/null && plan=""
      bad=""
      while IFS= read -r f; do
        [ -n "$plan" ] && grep -qF -- "$f" "$plan" && continue
        bad="$bad$f"$'\n'
      done <<<"$changed"
      if [ -n "$bad" ]; then
        printf 'test-tamper: existing tests changed or deleted and not named in the plan%s:\n%s' "${plan:+ ($plan)}" "$bad"
        echo "Add the file to the plan task that owns it, or (human only) ALLOW_TEST_CHANGES=1."
        exit 1
      fi
    fi
  fi
fi

# The publish script runs outside the sandbox; its guards are the only thing between a planted hook or
# credential helper and an unsandboxed shell. It is local tooling (macOS, keychain) and not part of the published
# tree, so its tests run only where it exists.
# Where the publish script exists, the private-trace tests must not skip for want of their pattern file.
if [ -f scripts/publish.sh ] && [ ! -s .local/publish-patterns.txt ]; then
  echo "verify: .local/publish-patterns.txt is missing; the private-trace tests would skip"
  exit 1
fi
if [ "$(uname -s)" = Darwin ] && [ -f scripts/tests/publish.test.sh ]; then
  step . bash scripts/tests/publish.test.sh
fi

# Backend. alembic/versions is not kept ruff-clean, so lint and format are
# scoped to app and tests. The bandit rules (S) are part of the selection in
# backend/pyproject.toml, so `ruff check` is also the security lint.
need backend/.venv/bin/python "(cd backend && uv sync)"
step backend .venv/bin/ruff check --quiet app tests
step backend .venv/bin/ruff format --check --quiet app tests

# The API tests need the project-local PostgreSQL (nis2_test is rebuilt per
# run). The gate does not start servers; it says how to.
if [ -z "${NIS2_TEST_DATABASE_URL:-}" ] && ! (exec 3<>"/dev/tcp/127.0.0.1/${PGPORT:-55432}") 2>/dev/null; then
  echo "verify: PostgreSQL is not reachable on 127.0.0.1:${PGPORT:-55432}. A human starts it (it cannot run in the Claude Code sandbox): scripts/dev-db.sh start"
  exit 1
fi
step backend .venv/bin/python -m pytest -q -x

# Known vulnerabilities in the locked Python dependencies. Always runs: a missing pip-audit used to skip this
# silently, so advisories only showed up in CI. CI installs pip-audit; locally uvx fetches the pinned version.
# The cache goes to TMPDIR because the default (~/Library/Caches) is not writable in the sandbox.
req=$(mktemp "${TMPDIR:-/tmp}/verify-req.XXXXXX"); trap 'rm -f "$req"' EXIT
step backend uv export --quiet --frozen --no-emit-project --no-hashes --format requirements-txt -o "$req"
if command -v pip-audit >/dev/null 2>&1; then audit=(pip-audit); else audit=(uvx pip-audit==2.10.1); fi
step backend "${audit[@]}" --cache-dir "${TMPDIR:-/tmp}/pip-audit-cache" --progress-spinner off --disable-pip \
  --no-deps -r "$req"

# Frontend.
need frontend/node_modules/.bin/tsc "(cd frontend && npm ci)"
step frontend node_modules/.bin/tsc -b --noEmit
# Known vulnerabilities in the lockfile, build tooling included. Needs the npm
# registry; if it cannot be reached the gate fails, because an audit that did
# not run has not passed.
step frontend npm audit --audit-level=high
exit 0
