# Spectra Water Service Backend

NestJS REST API for customer bookings and field service operations. PostgreSQL is accessed through Prisma; Redis/BullMQ is used for asynchronous delivery. API routes are versioned under `/api/v1` and OpenAPI is served at `/api/docs`.

## Included modules

The current codebase includes authentication and refresh token storage, role guards, customers and service locations, employees and managers, services and categories, enquiries, bookings, work orders and status history, assignments and transfer requests, service reports, work photos, attendance, overtime, leave, maintenance schedules, notifications/device tokens, dashboard summaries, audit records, health checks, Cloudinary integration, Firebase integration, and queue producers. Database models and the initial PostgreSQL migration are under `prisma/`.

## Account and staff workflows

- `POST /api/v1/auth/register` creates customer accounts only. The role is assigned by the server.
- Admins create employee/field staff through `POST /api/v1/employees` and manager/supervisor accounts through `POST /api/v1/managers`.
- Both mobile apps authenticate through `POST /api/v1/auth/login`; the returned role scopes API access. The field staff/supervisor app uses employee and manager roles, while the customer app uses the customer role.
- Employees and managers can use `POST /api/v1/attendance/check-in`, `POST /api/v1/attendance/check-out`, and `GET /api/v1/attendance/today`. Attendance is stored against the authenticated staff profile.
- Employees submit overtime through `POST /api/v1/overtime`; duration is calculated from completed attendance and configured work hours. Managers approve/reject it through `POST /api/v1/overtime/{id}/decision`.
- Admins record payment for approved overtime through `PATCH /api/v1/overtime/{id}/payment`, with `{ "amount": 1250.00, "paymentReference": "optional-reference" }`. Staff can see the payment amount, status, and date in their own `GET /api/v1/overtime` results. Amounts are recorded in INR; this endpoint records payment, it does not transfer money.

Some deployment and operational pieces are provided here, but this repository is not yet a complete implementation of every item in the original production brief. In particular, it has no checked-in test suite, no queue worker entrypoint/consumers, no export API, and no dedicated audit-log/settings API. Firebase and Cloudinary features require real credentials and external account configuration. Review these items before treating the service as production complete.

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

The API listens on `PORT` (default 3000). Health is available at `/health`; Swagger UI is at `/api/docs`. API routes default to `/api/v1`.

## Configuration

See [.env.example](.env.example). At minimum set `DATABASE_URL`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`. Use independently generated secrets of at least 32 random bytes in deployed environments. Optional integrations use:

- `REDIS_URL` for queues
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` for Firebase Cloud Messaging; encode newlines as `\\n` in environment stores
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` for image uploads
- `CORS_ORIGIN` as a comma-separated allowlist
- `APP_TIMEZONE=Asia/Kolkata` and attendance settings for India-local attendance rules

Do not commit `.env` or place credentials in an image. The Compose deployment also requires `POSTGRES_PASSWORD` and `REDIS_PASSWORD` in its environment.

## Database

Prisma schema: `prisma/schema.prisma`. Development migration commands:

```sh
npx prisma generate
npx prisma migrate dev
npx prisma studio
```

For a release, review and commit a migration, then run `npx prisma migrate deploy` against the target database. The container command applies committed migrations before starting the API. Never run `migrate dev` against production. There is currently no seed script in this checkout; do not rely on demo seed data.

## Commands

```sh
npm run start:dev
npm run build
npm run start:prod
npm test
npm run test:e2e
```

`npm test` and `npm run test:e2e` are configured, but no tests are currently checked in. Add and run the required unit and integration tests before release.

## Docker Compose

Set `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`, and provide a deployment `.env` containing the other application variables. Then:

```sh
docker compose up -d --build
docker compose logs -f api
```

PostgreSQL data and Redis persistence use named volumes. The API binds to loopback so Nginx can proxy it locally. The Compose file currently starts PostgreSQL, Redis, and the API. It does not start a queue worker because no worker implementation exists yet.

## Ubuntu VPS and Nginx

Install Docker Engine and the Compose plugin on Ubuntu 24.04, deploy this directory, configure secrets in a protected `.env`, and start the Compose services. Point `api.example.com` to the VPS and obtain a certificate with Certbot, for example:

```sh
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d api.example.com
```

Use [deploy/nginx.conf](deploy/nginx.conf) as the proxy template after replacing `api.example.com` and connecting the certificate paths. Validate with `sudo nginx -t`, then reload Nginx. Keep PostgreSQL and Redis private to the Docker network; expose only HTTPS through the firewall.

## Backups and restore

Store backups away from the VPS (object storage or a separate backup host), encrypt them, and monitor backup success. Example daily dump and restore:

```sh
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > spectra-$(date +%F).dump
cat spectra-YYYY-MM-DD.dump | docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists
```

Set retention to match business and legal requirements (for example, daily copies for 30 days plus monthly copies), and periodically test restore into a separate database. A backup on the same VPS is not a backup.

## API security and operations

Authentication uses access and refresh JWTs; authorization is enforced with role guards and ownership checks in services. DTO validation, Helmet, CORS configuration, throttling, structured request logging, and a global exception filter are enabled. Health checks report database and Redis connectivity. Logs and monitoring should be reviewed for sensitive-data exposure before production use.

Before release, complete and verify queue consumers and scheduled jobs, export endpoints, settings/audit APIs, seed tooling, and automated tests, then run migrations and exercise the full workflow in a staging environment with real PostgreSQL, Redis, Firebase, and Cloudinary services.
