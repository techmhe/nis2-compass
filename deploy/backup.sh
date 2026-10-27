#!/usr/bin/env bash
# Backup database and uploaded files into ./backups/<timestamp>/ (run from the deploy directory).
# Checks that the dump is readable and deletes backups older than BACKUP_KEEP_DAYS (default 30).
# Scheduled daily by systemd/nis2-backup.timer (see README).
set -euo pipefail
cd "$(dirname "$0")"
umask 077
ts=$(date +%Y%m%d-%H%M%S)
dir="backups/$ts"
mkdir -p "$dir"
docker compose exec -T db pg_dump -U nis2 -d nis2 -Fc > "$dir/nis2.dump"
docker compose run --rm --no-deps -T --entrypoint tar app -C /data -czf - . > "$dir/data.tar.gz"
# integrity: the dump's table of contents must be readable and the archive must be a valid gzip tar
docker compose exec -T db pg_restore --list < "$dir/nis2.dump" > /dev/null
gzip -t "$dir/data.tar.gz"
find backups -mindepth 1 -maxdepth 1 -type d -mtime +"${BACKUP_KEEP_DAYS:-30}" -exec rm -rf {} +
echo "Backup written to $dir"
# Restore:  docker compose exec -T db pg_restore -U nis2 -d nis2 --clean --if-exists < backups/<ts>/nis2.dump
#           docker compose run --rm --no-deps -T --entrypoint tar app -C /data -xzf - < backups/<ts>/data.tar.gz
