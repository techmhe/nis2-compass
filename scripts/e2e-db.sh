#!/usr/bin/env bash
# Fresh database for the browser tests (leaves nis2 and nis2_test alone).
# Usage: e2e-db.sh [--empty] [dbname]
#   default            nis2_e2e with migrations and demo data
#   --empty [dbname]   migrations and the base seed only, no bootstrap admin: a system that needs first-run setup
# Called by frontend/playwright.config.ts before the test APIs start.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PGPORT="${PGPORT:-55432}"
EMPTY=0
if [ "${1:-}" = "--empty" ]; then EMPTY=1; shift; fi
DB="${1:-nis2_e2e}"
[[ "$DB" =~ ^[a-z0-9_]+$ ]] || { echo "invalid database name: $DB" >&2; exit 2; }
"$ROOT/scripts/dev-db.sh" start >/dev/null
psql() { "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -q "$@"; }
psql -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB OWNER nis2"
psql -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;"
cd "$ROOT/backend"
export NIS2_DATABASE_URL="postgresql+psycopg://nis2@127.0.0.1:$PGPORT/$DB"
.venv/bin/alembic upgrade head >/dev/null
if [ "$EMPTY" = 1 ]; then
  # An empty value overrides backend/.env, so no admin is created whatever the developer has configured there.
  NIS2_BOOTSTRAP_ADMIN_PASSWORD="" .venv/bin/python -m app.seed.seed >/dev/null
else
  .venv/bin/python -m app.seed.seed --demo >/dev/null
fi
echo "$DB ready"
