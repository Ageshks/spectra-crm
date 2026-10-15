# Spectra Water Service Backend

NestJS REST API for customer bookings and field service operations. PostgreSQL is accessed through Prisma; Redis/BullMQ is used for asynchronous delivery. API routes are versioned under `/api/v1` and OpenAPI is served at `/api/docs` (disabled in production by default).

## Included modules

The current codebase includes authentication and refresh token storage, role guards, customers and service locations, employees and managers, services and categories, enquiries, bookings, work orders and status history, assignments and transfer requests, service reports, work photos, attendance, overtime, leave, maintenance schedules, notifications/device tokens, dashboard summaries, audit records, health checks, Cloudinary integration, Firebase integration, queue producers + workers, and scheduled housekeeping. Database models and PostgreSQL migrations are under `prisma/`.

## Account and staff workflows

- `POST /api/v1/auth/register` creates customer accounts only. The role is assigned by the server.
- Admins create employee/field staff through `POST /api/v1/employees` and manager/supervisor accounts through `POST /api/v1/managers`.
- Both mobile apps authenticate through `POST /api/v1/auth/login`; the returned role scopes API access. The field staff/supervisor app uses employee and manager roles, while the customer app uses the customer role.
- Employees and managers can use `POST /api/v1/attendance/check-in`, `POST /api/v1/attendance/check-out`, and `GET /api/v1/attendance/today`. Attendance is stored against the authenticated staff profile.
- Employees submit overtime through `POST /api/v1/overtime`; duration is calculated from completed attendance and configured work hours. Managers approve/reject it through `POST /api/v1/overtime/{id}/decision`.
- Admins record payment for approved overtime through `PATCH /api/v1/overtime/{id}/payment`, with `{ "amount": 1250.00, "paymentReference": "optional-reference" }`. Staff can see the payment amount, status, and date in their own `GET /api/v1/overtime` results. Amounts are recorded in INR; this endpoint records payment, it does not transfer money.

## Production status

This repo is VPS-ready: validated env config with production fail-fast, hardened Dockerfile (non-root, tini, prod-only deps, auto-migrations), Compose with `api` + `worker` + Postgres + Redis, Nginx TLS template with rate limiting, backup/restore/deploy scripts, seed script, queue workers, and cron housekeeping. Firebase and Cloudinary features still require real credentials and external account configuration.

## Requirements

- Node.js 20 or newer and npm
- PostgreSQL 16 or compatible
- Redis 7 or compatible
- Firebase service account and Cloudinary account for push and image storage

## Local setup

```sh
npm ci
cp .env.example .env
# Set unique JWT secrets and database/Redis URLs in .env
npx prisma generate
npx prisma migrate dev
npm run start:dev
```

The API listens on `PORT` (default 3000). Health is available at `/health` (readiness) and `/health/live` (liveness); Swagger UI is at `/api/docs` when enabled. API routes default to `/api/v1`.

## Configuration

See [.env.example](.env.example). At minimum set `DATABASE_URL`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`. Generate secrets with `openssl rand -hex 32` (access and refresh must differ). Production boot fails fast on weak secrets, `CORS_ORIGIN=*`, or missing `DATABASE_URL`. Key knobs:

- `SWAGGER_ENABLED` (default false in production, true elsewhere)
- `WORKERS_ENABLED` / `SCHEDULER_ENABLED` (set false on scaled replicas so cron runs once)
- `TRUST_PROXY=true` behind Nginx, `BODY_LIMIT=1mb`
- `REDIS_URL` for queues
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` for Firebase Cloud Messaging; encode newlines as `\\n` in environment stores
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` for image uploads
- `CORS_ORIGIN` as a comma-separated allowlist (required in production)
- `APP_TIMEZONE=Asia/Kolkata` and attendance settings for India-local attendance rules

Do not commit `.env` or place credentials in an image. The Compose deployment also requires `POSTGRES_PASSWORD` and `REDIS_PASSWORD` in its environment.

## Database

Prisma schema: `prisma/schema.prisma`. Development migration commands:

```sh
npx prisma generate
npx prisma migrate dev
npx prisma studio
```

For a release, review and commit a migration, then run `npx prisma migrate deploy` against the target database (the container entrypoint does this automatically). Never run `migrate dev` against production. Seed a first admin with:

```sh
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='<strong unique password>' npm run seed
```

## Commands

```sh
npm run start:dev
npm run build
npm run start:prod      # API
npm run worker:prod     # dedicated queue worker (same as compose `worker` service)
npm run typecheck
npm test
```

## Docker Compose (production)

1. Copy `.env.example` to `.env` and fill every `CHANGE_ME_*` value (`chmod 600 .env`).
2. Generate secrets: `openssl rand -hex 32` (JWT x2), `openssl rand -base64 32` (Postgres/Redis).
3. Start: `docker compose up -d --build` — runs `postgres`, `redis`, `api` (migrations + HTTP), and `worker` (BullMQ consumers, scheduler disabled).
4. Check: `docker compose ps`, `curl http://127.0.0.1:3000/health/live`, `docker compose logs -f api worker`.

PostgreSQL data and Redis persistence use named volumes. The API binds to loopback so Nginx can proxy it locally. Log rotation is capped via Compose logging options.

## Ubuntu VPS and Nginx

```sh
sudo ./deploy/vps-setup.sh        # Docker, firewall (22/80/443), app user/dir
# copy project to /opt/spectra, create .env (chmod 600), then:
docker compose up -d --build
```

Point your API domain to the VPS and obtain a certificate with Certbot, for example:

```sh
sudo certbot --nginx -d api.example.com
```

Use [deploy/nginx.conf](deploy/nginx.conf) as the proxy template after replacing `api.example.com` and connecting the certificate paths. Validate with `sudo nginx -t`, then reload Nginx. Keep PostgreSQL and Redis private to the Docker network; expose only HTTPS through the firewall. Updates: `./deploy/deploy.sh`.

## Backups and restore

Store backups away from the VPS (object storage or a separate backup host), encrypt them, and monitor backup success. `deploy/backup.sh` keeps 30 daily + 12 monthly dumps:

```sh
POSTGRES_USER=spectra POSTGRES_DB=spectra ./deploy/backup.sh /backups
./deploy/restore.sh /backups/daily/spectra-YYYY-MM-DD.dump
```

Schedule `backup.sh` via cron and periodically test restore into a separate database. A backup on the same VPS is not a backup.

## API security and operations

Authentication uses access and refresh JWTs; authorization is enforced with role guards and ownership checks in services. DTO validation, Helmet, CORS allowlist, body limits, throttling, structured request logging, and a global exception filter are enabled. Swagger is off in production unless `SWAGGER_ENABLED=true`. Health: `/health/live` (liveness) and `/health` (readiness: DB + Redis). The app enables shutdown hooks and runs behind `tini` as a non-root user; Postgres connectivity is retried at boot and migrations run before the API starts. Logs and monitoring should be reviewed for sensitive-data exposure before production use. Exercise the full workflow in staging with real PostgreSQL, Redis, Firebase, and Cloudinary services.
