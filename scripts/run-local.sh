#!/usr/bin/env bash
# Production-like local deployment on macOS without Docker:
# built frontend served by the API (2 workers) behind Caddy with a self-signed certificate.
#   scripts/run-local.sh      ->  https://nis2.localhost:8443
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NIS2_ROOT="$ROOT"
"$ROOT/scripts/dev-db.sh" start
(cd "$ROOT/frontend" && { [ -d node_modules ] || npm install; } && npm run build)
cd "$ROOT/backend"
[ -d .venv ] || uv sync
SECRET_FILE="$ROOT/.data/secret_key"
[ -f "$SECRET_FILE" ] || { mkdir -p "$ROOT/.data"; openssl rand -base64 48 | tr -d '\n' > "$SECRET_FILE"; chmod 600 "$SECRET_FILE"; }
export NIS2_ENV=development NIS2_COOKIE_SECURE=true NIS2_BASE_URL=https://nis2.localhost:8443 \
       NIS2_FRONTEND_DIST="$ROOT/frontend/dist" NIS2_SECRET_KEY="$(cat "$SECRET_FILE")"
.venv/bin/alembic upgrade head
.venv/bin/python -m app.seed.seed ${1:-}
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 --workers 2 --proxy-headers --forwarded-allow-ips 127.0.0.1 &
API=$!
caddy run --config "$ROOT/scripts/Caddyfile.local" --adapter caddyfile &
PROXY=$!
trap 'kill $API $PROXY 2>/dev/null' EXIT INT TERM
echo
echo "  NIS2 Compass  ->  https://nis2.localhost:8443   (self-signed; run 'caddy trust' once to trust it)"
echo
wait
