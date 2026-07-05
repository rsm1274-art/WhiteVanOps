#!/bin/bash
# White Van Ops — Backup script
# Dumps PostgreSQL to a timestamped file.
# Run manually or add to crontab:
#   0 2 * * * /path/to/whitevanops/deploy/backup.sh >> /var/log/wvo-backup.log 2>&1
set -e

BACKUP_DIR="${BACKUP_DIR:-/mnt/backup/whitevanops}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="wvo_backup_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] Starting backup at $TIMESTAMP..."

docker compose exec -T db \
  pg_dump -U postgres whitevanops \
  | gzip > "${BACKUP_DIR}/${FILENAME}"

echo "[backup] Saved to ${BACKUP_DIR}/${FILENAME}"

# Keep only the 30 most recent backups
ls -1t "${BACKUP_DIR}"/wvo_backup_*.sql.gz | tail -n +31 | xargs -r rm --
echo "[backup] Old backups pruned (keeping 30 most recent)."
