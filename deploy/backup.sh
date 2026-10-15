#!/bin/sh
# Daily PostgreSQL backup for the VPS deployment.
# Usage: POSTGRES_USER=... POSTGRES_DB=... ./deploy/backup.sh [/backups]
# Keeps 30 daily + 12 monthly dumps. Store /backups off-server (rsync/object storage).
set -eu

BACKUP_DIR="${1:-/backups}"
RETENTION_DAILY=30
RETENTION_MONTHLY=12
STAMP="$(date +%F)"
MONTH_STAMP="$(date +%Y-%m)"

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/monthly"

echo "Backing up ${POSTGRES_DB:-spectra}..."
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:?Set POSTGRES_USER}" -Fc "${POSTGRES_DB:?Set POSTGRES_DB}" > "$BACKUP_DIR/daily/spectra-$STAMP.dump"
cp "$BACKUP_DIR/daily/spectra-$STAMP.dump" "$BACKUP_DIR/monthly/spectra-$MONTH_STAMP.dump"

ls -1t "$BACKUP_DIR"/daily/spectra-*.dump | tail -n +$((RETENTION_DAILY + 1)) | xargs -r rm -f
ls -1t "$BACKUP_DIR"/monthly/spectra-*.dump | tail -n +$((RETENTION_MONTHLY + 1)) | xargs -r rm -f

echo "Backup complete: $BACKUP_DIR/daily/spectra-$STAMP.dump"
