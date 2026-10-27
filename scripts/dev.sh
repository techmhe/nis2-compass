#!/usr/bin/env bash
# Development mode (no Docker): Postgres + API with auto-reload + Vite dev server.
#   scripts/dev.sh            start everything (Ctrl+C stops API and web; the database keeps running)
#   scripts/dev.sh --demo     also load demo users/data on first start
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/dev-db.sh" start
cd "$ROOT/backend"
[ -d .venv ] || uv sync
[ -f .env ] || cat > .env <<ENV
NIS2_ENV=development
NIS2_BASE_URL=http://localhost:5173
NIS2_BOOTSTRAP_ADMIN_EMAIL=admin@example.local
NIS2_BOOTSTRAP_ADMIN_PASSWORD=Admin-Password-2026!
ENV
.venv/bin/alembic upgrade head
.venv/bin/python -m app.seed.seed ${1:-}
.venv/bin/uvicorn app.main:app --port 8000 --reload --reload-dir app &
API=$!
cd "$ROOT/frontend"
[ -d node_modules ] || npm install
npx vite --port 5173 &
WEB=$!
trap 'kill $API $WEB 2>/dev/null' EXIT INT TERM
echo
echo "  NIS2 Compass (dev)  ->  http://localhost:5173"
echo
wait
