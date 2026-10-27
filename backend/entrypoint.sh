#!/bin/sh
# Container entrypoint: migrate, seed (idempotent), then serve.
set -e

# Extra CA certificates (deploy/certs, mounted read-only): trust bundle = default roots + internal CA, used by
# httpx (OIDC, AI endpoint) and smtplib via SSL_CERT_FILE. Files with private keys are refused.
CA_DIR=/etc/nis2/ca
if [ -d "$CA_DIR" ] && [ -n "$(find "$CA_DIR" -maxdepth 1 -type f \( -name '*.pem' -o -name '*.crt' \) 2>/dev/null)" ]; then
  bundle=/tmp/ca-bundle.pem
  cat "$(python -c 'import certifi; print(certifi.where())')" > "$bundle"
  names=""
  for f in "$CA_DIR"/*.pem "$CA_DIR"/*.crt; do
    [ -f "$f" ] || continue
    if grep -q "PRIVATE KEY" "$f"; then echo "Ignoring $f: contains a private key" >&2; continue; fi
    if ! grep -q "BEGIN CERTIFICATE" "$f"; then echo "Ignoring $f: no PEM certificate" >&2; continue; fi
    printf '\n' >> "$bundle"
    cat "$f" >> "$bundle"
    names="${names:+$names,}$(basename "$f")"
  done
  if [ -n "$names" ]; then
    echo "Trusting extra CA certificates: $names"
    export SSL_CERT_FILE="$bundle" REQUESTS_CA_BUNDLE="$bundle" NIS2_EXTRA_CA_CERTS="$names"
  fi
fi

echo "Running database migrations…"
alembic upgrade head
echo "Seeding initial data (only where empty)…"
if [ "${NIS2_LOAD_DEMO_DATA:-false}" = "true" ]; then python -m app.seed.seed --demo; else python -m app.seed.seed; fi
echo "Starting NIS2 Compass…"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "${NIS2_WORKERS:-2}" \
  --proxy-headers --forwarded-allow-ips "${NIS2_FORWARDED_ALLOW_IPS:-127.0.0.1}" --no-server-header
