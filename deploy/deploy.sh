#!/bin/sh
# Zero-downtime-ish update for the VPS deployment.
# Usage: ./deploy/deploy.sh
set -eu

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example and fill in secrets first" >&2
  exit 1
fi
chmod 600 .env

git pull --ff-only
docker compose build
docker compose up -d
docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1);console.log('healthy')}).catch(()=>process.exit(1))"
docker image prune -f
echo "Deploy complete"
