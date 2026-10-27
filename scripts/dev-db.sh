#!/usr/bin/env bash
# Project-local PostgreSQL 17 cluster for development (no Docker required).
# Usage: scripts/dev-db.sh start|stop|status|psql|reset
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PGDATA="$ROOT/.data/pg"
PGPORT="${PGPORT:-55432}"
LOG="$ROOT/.data/pg.log"

init() {
  mkdir -p "$ROOT/.data"
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8 --locale=en_US.UTF-8 >/dev/null
    echo "listen_addresses = '127.0.0.1'" >> "$PGDATA/postgresql.conf"
    echo "port = $PGPORT" >> "$PGDATA/postgresql.conf"
  fi
}

case "${1:-start}" in
  start)
    init
    # A server that answers on the port is running, even when pg_ctl cannot see it: in the Claude Code sandbox
    # a command cannot signal a server that was started outside it, so `pg_ctl status` reports it as stopped.
    if ! "$PGBIN/pg_isready" -q -h 127.0.0.1 -p "$PGPORT" && ! "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
      "$PGBIN/pg_ctl" -D "$PGDATA" -l "$LOG" -w start >/dev/null
    fi
    for db in nis2 nis2_test; do
      "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='nis2'" | grep -q 1 \
        || "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -qc "CREATE ROLE nis2 LOGIN"
      "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
        || "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -qc "CREATE DATABASE $db OWNER nis2"
      "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -d "$db" -qc "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;"
    done
    echo "PostgreSQL running on 127.0.0.1:$PGPORT (databases: nis2, nis2_test)"
    ;;
  stop) "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop ;;
  status) "$PGBIN/pg_ctl" -D "$PGDATA" status ;;
  psql) shift; exec "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U nis2 -d "${1:-nis2}" ;;
  reset)
    "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -qc "DROP DATABASE IF EXISTS nis2 WITH (FORCE)"
    exec "$0" start ;;
  *) echo "usage: $0 start|stop|status|psql|reset"; exit 1 ;;
esac
