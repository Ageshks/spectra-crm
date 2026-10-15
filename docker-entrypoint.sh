#!/bin/sh
set -eu

# Production entrypoint: wait for Postgres, apply migrations, start the API.
# MODE selects the process: api (default) or worker (BullMQ consumers only).

MODE="${MODE:-api}"

wait_for_postgres() {
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is not set" >&2
    exit 1
  fi
  echo "Waiting for PostgreSQL..."
  for i in $(seq 1 30); do
    if node -e "const {Client}=require('pg');" 2>/dev/null; then
      :
    fi
    if npx prisma db execute --stdin <<'SQL' 2>/dev/null
SELECT 1;
SQL
    then
      echo "PostgreSQL is reachable"
      return 0
    fi
    sleep 2
  done
  echo "PostgreSQL did not become ready in time" >&2
  exit 1
}

if [ "$MODE" = "worker" ]; then
  echo "Starting queue worker..."
  exec node dist/worker.js
fi

wait_for_postgres
echo "Applying database migrations..."
npx prisma migrate deploy
echo "Starting API..."
exec node dist/main.js
