#!/bin/sh
# Restore a PostgreSQL dump into the Compose database.
# Usage: ./deploy/restore.sh /backups/daily/spectra-YYYY-MM-DD.dump
set -eu

DUMP="${1:?Usage: restore.sh /path/to/spectra-YYYY-MM-DD.dump}"

cat "$DUMP" | docker compose exec -T postgres pg_restore \
  -U "${POSTGRES_USER:?Set POSTGRES_USER}" \
  -d "${POSTGRES_DB:?Set POSTGRES_DB}" \
  --clean --if-exists
echo "Restore complete from $DUMP"
