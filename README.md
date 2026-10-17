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

## API reference (full list)

All versioned routes are prefixed with `/api/v1` (from `API_PREFIX`). Health: `/health` is unprefixed (excluded from global prefix), `/api/v1/health/live` is the versioned liveness probe. Auth is Bearer JWT unless marked Public. Swagger UI at `/api/docs` when enabled. Total: 123 routes (121 × `/api/v1/*` + `/health` + `/api/v1/health/live`).

### Health
- `GET /health` — Public, readiness (DB + Redis, 503 when degraded)
- `GET /api/v1/health/live` — Public, liveness (process up)

### Auth — `/api/v1/auth`
- `POST /api/v1/auth/register` — Public, register CUSTOMER only
- `POST /api/v1/auth/login` — Public, login all roles, returns user + tokens
- `POST /api/v1/auth/refresh` — Public (refreshToken in body), rotate token pair
- `POST /api/v1/auth/logout` — Public (refreshToken in body), revoke one token
- `POST /api/v1/auth/logout-all` — Bearer, revoke all own tokens
- `POST /api/v1/auth/forgot-password` — Public, request reset token
- `POST /api/v1/auth/reset-password` — Public (token in body), set new password
- `POST /api/v1/auth/change-password` — Bearer, change own password
- `GET /api/v1/auth/me` — Bearer, current profile (+ customer/employee/manager ids)

### Users — `/api/v1/users`
- `GET /api/v1/users/me` — Bearer any role, own profile
- `PATCH /api/v1/users/me` — Bearer any role, update own profile
- `GET /api/v1/users` — ADMIN, MANAGER, list users (search/filter/paginate)
- `GET /api/v1/users/:id` — ADMIN, SUPER_ADMIN, get one user (uuid)
- `PATCH /api/v1/users/:id/status` — ADMIN, SUPER_ADMIN, activate/deactivate

### Customers — `/api/v1/customers`
- `GET /api/v1/customers` — ADMIN, MANAGER, SUPER_ADMIN, list customers
- `POST /api/v1/customers` — ADMIN, SUPER_ADMIN, create customer account
- `GET /api/v1/customers/:id` — ADMIN, MANAGER, SUPER_ADMIN, get + locations
- `PATCH /api/v1/customers/:id` — ADMIN, SUPER_ADMIN, update customer
- `GET /api/v1/customers/me/profile` — CUSTOMER, own profile
- `PATCH /api/v1/customers/me/profile` — CUSTOMER, update own profile
- `GET /api/v1/customers/me/addresses` — CUSTOMER, own service locations
- `POST /api/v1/customers/me/addresses` — CUSTOMER, add location
- `PATCH /api/v1/customers/me/addresses/:addressId` — CUSTOMER, update location
- `DELETE /api/v1/customers/me/addresses/:addressId` — CUSTOMER, soft-delete location
- `GET /api/v1/customers/me/service-history` — CUSTOMER, bookings/reports/photos/maintenance

### Employees — `/api/v1/employees`
- `GET /api/v1/employees/me` — EMPLOYEE, own profile
- `GET /api/v1/employees` — ADMIN, MANAGER, SUPER_ADMIN, list employees
- `POST /api/v1/employees` — ADMIN, SUPER_ADMIN, create employee/field-staff
- `GET /api/v1/employees/:id` — ADMIN, MANAGER, SUPER_ADMIN, get employee
- `PATCH /api/v1/employees/:id` — ADMIN, SUPER_ADMIN, update employee
- `PATCH /api/v1/employees/:id/status` — ADMIN, SUPER_ADMIN, activate/deactivate
- `GET /api/v1/employees/:id/work-orders` — ADMIN, MANAGER, SUPER_ADMIN, assigned work
- `GET /api/v1/employees/:id/attendance` — ADMIN, MANAGER, SUPER_ADMIN, attendance
- `GET /api/v1/employees/:id/overtime` — ADMIN, MANAGER, SUPER_ADMIN, overtime
- `GET /api/v1/employees/:id/leave` — ADMIN, MANAGER, SUPER_ADMIN, leave
- `GET /api/v1/employees/:id/reports` — ADMIN, MANAGER, SUPER_ADMIN, reports
### Managers — `/api/v1/managers` (all ADMIN, SUPER_ADMIN)
- `GET /api/v1/managers` — list managers
- `POST /api/v1/managers` — create manager/supervisor
- `GET /api/v1/managers/:id` — get manager
- `PATCH /api/v1/managers/:id` — update manager
- `PATCH /api/v1/managers/:id/status` — activate/deactivate

### Service categories — `/api/v1/service-categories`
- `GET /api/v1/service-categories` — Public, browse active categories
- `POST /api/v1/service-categories` — ADMIN, SUPER_ADMIN, create category
- `GET /api/v1/service-categories/:id` — Bearer, get category
- `PATCH /api/v1/service-categories/:id` — ADMIN, SUPER_ADMIN, update
- `DELETE /api/v1/service-categories/:id` — ADMIN, SUPER_ADMIN, deactivate (soft delete)

### Services — `/api/v1/services`
- `GET /api/v1/services` — Public, browse active services
- `POST /api/v1/services` — ADMIN, SUPER_ADMIN, create service
- `GET /api/v1/services/:id` — Bearer, get service
- `PATCH /api/v1/services/:id` — ADMIN, SUPER_ADMIN, update service
- `PATCH /api/v1/services/:id/status` — ADMIN, SUPER_ADMIN, activate/deactivate
- `DELETE /api/v1/services/:id` — ADMIN, SUPER_ADMIN, delete when safe else deactivate

### Enquiries — `/api/v1/enquiries`
- `POST /api/v1/enquiries` — Public, submit enquiry
- `GET /api/v1/enquiries` — ADMIN, MANAGER, SUPER_ADMIN, list
- `GET /api/v1/enquiries/:id` — ADMIN, MANAGER, SUPER_ADMIN, get one
- `POST /api/v1/enquiries/:id/assign` — ADMIN, SUPER_ADMIN, assign to manager
- `PATCH /api/v1/enquiries/:id/status` — ADMIN, MANAGER, SUPER_ADMIN, update status
- `POST /api/v1/enquiries/:id/convert` — ADMIN, SUPER_ADMIN, convert to booking

### Bookings — `/api/v1/bookings`
- `POST /api/v1/bookings` — CUSTOMER, ADMIN, SUPER_ADMIN, create booking
- `GET /api/v1/bookings` — CUSTOMER, ADMIN, MANAGER, SUPER_ADMIN, list (customers own only)
- `GET /api/v1/bookings/:id` — CUSTOMER, ADMIN, MANAGER, SUPER_ADMIN, get (ownership enforced)
- `PATCH /api/v1/bookings/:id/status` — CUSTOMER, ADMIN, SUPER_ADMIN, confirm/schedule/cancel

### Work orders — `/api/v1/work-orders`
- `POST /api/v1/work-orders` — ADMIN, MANAGER, SUPER_ADMIN, create from confirmed/scheduled booking
- `GET /api/v1/work-orders` — Bearer role-scoped list (search/paginate)
- `GET /api/v1/work-orders/:id` — Bearer, get (ownership enforced)
- `GET /api/v1/work-orders/:id/status-history` — Bearer, transition history
- `PATCH /api/v1/work-orders/:id/status` — ADMIN, MANAGER, SUPER_ADMIN, validated transitions only
- `PATCH /api/v1/work-orders/:id/schedule` — ADMIN, MANAGER, SUPER_ADMIN, reschedule (notifies techs)
- `PATCH /api/v1/work-orders/:id/manager` — ADMIN, SUPER_ADMIN, assign manager
- `PATCH /api/v1/work-orders/:id/priority` — ADMIN, MANAGER, SUPER_ADMIN, update priority

### Work assignments — `/api/v1/work-assignments`
- `POST /api/v1/work-assignments` — ADMIN, MANAGER, SUPER_ADMIN, assign technicians
- `GET /api/v1/work-assignments` — EMPLOYEE, MANAGER, ADMIN, SUPER_ADMIN, list (employees own only)
- `POST /api/v1/work-assignments/:id/accept` — EMPLOYEE, accept work
- `POST /api/v1/work-assignments/:id/start` — EMPLOYEE, start work
- `POST /api/v1/work-assignments/:id/complete` — EMPLOYEE, complete field work
- `POST /api/v1/work-assignments/:id/cancel` — ADMIN, MANAGER, SUPER_ADMIN, cancel assignment

### Work transfers — `/api/v1/work-transfers`
- `POST /api/v1/work-transfers` — EMPLOYEE, request transfer (reason required)
- `GET /api/v1/work-transfers` — EMPLOYEE, MANAGER, ADMIN, SUPER_ADMIN, list (role scoped)
- `GET /api/v1/work-transfers/:id` — EMPLOYEE, MANAGER, ADMIN, SUPER_ADMIN, get one
- `PATCH /api/v1/work-transfers/:id/decision` — MANAGER, ADMIN, SUPER_ADMIN, approve/reject

### Service reports — `/api/v1/service-reports`
- `POST /api/v1/service-reports` — EMPLOYEE, create for assigned COMPLETED work
- `GET /api/v1/service-reports` — Bearer, list (customers approved-only)
- `GET /api/v1/service-reports/:id` — Bearer, get (ownership enforced)
- `PATCH /api/v1/service-reports/:id` — EMPLOYEE, edit DRAFT/CORRECTION_REQUIRED
- `POST /api/v1/service-reports/:id/submit` — EMPLOYEE, submit for review
- `POST /api/v1/service-reports/:id/approve` — MANAGER, ADMIN, SUPER_ADMIN, approve
- `POST /api/v1/service-reports/:id/request-correction` — MANAGER, ADMIN, SUPER_ADMIN, request fix

### Work photos — `/api/v1/work-photos` (multipart `photo`, JPEG/PNG/WEBP)
- `POST /api/v1/work-photos` — Bearer, upload (photo + workOrderId uuid, optional serviceReportId/caption)
- `GET /api/v1/work-photos` — Bearer, list role-scoped
- `DELETE /api/v1/work-photos/:id` — Bearer, delete photo

### Attendance — `/api/v1/attendance`
- `POST /api/v1/attendance/check-in` — EMPLOYEE, MANAGER, server timestamp + GPS when enabled
- `POST /api/v1/attendance/check-out` — EMPLOYEE, MANAGER, server-side duration
- `GET /api/v1/attendance/today` — EMPLOYEE, MANAGER, today's record
- `GET /api/v1/attendance` — EMPLOYEE, MANAGER, ADMIN, SUPER_ADMIN, list (employees own only)
- `GET /api/v1/attendance/:id` — EMPLOYEE, MANAGER, ADMIN, SUPER_ADMIN, get one

### Overtime — `/api/v1/overtime` (INR, records payment only)
- `POST /api/v1/overtime` — EMPLOYEE, ADMIN, SUPER_ADMIN, request (duration from attendance)
- `GET /api/v1/overtime` — EMPLOYEE, MANAGER, ADMIN, SUPER_ADMIN, list (employees own only)
- `GET /api/v1/overtime/:id` — EMPLOYEE, MANAGER, ADMIN, SUPER_ADMIN, get one
- `POST /api/v1/overtime/:id/decision` — MANAGER, ADMIN, SUPER_ADMIN, approve/reject
- `PATCH /api/v1/overtime/:id/payment` — ADMIN, SUPER_ADMIN, record payment `{ amount, paymentReference? }`

### Leave — `/api/v1/leave`
- `POST /api/v1/leave` — EMPLOYEE, ADMIN, SUPER_ADMIN, apply
- `GET /api/v1/leave` — EMPLOYEE, MANAGER, ADMIN, SUPER_ADMIN, list (employees own only)
- `GET /api/v1/leave/:id` — EMPLOYEE, MANAGER, ADMIN, SUPER_ADMIN, get one
- `POST /api/v1/leave/:id/decision` — MANAGER, ADMIN, SUPER_ADMIN, approve/reject

### Maintenance — `/api/v1/maintenance`
- `POST /api/v1/maintenance` — ADMIN, MANAGER, SUPER_ADMIN, CUSTOMER, create schedule
- `GET /api/v1/maintenance` — Bearer, list (customers own only)
- `GET /api/v1/maintenance/upcoming?days=30` — Bearer, due in next N days
- `GET /api/v1/maintenance/:id` — Bearer, get one
- `PATCH /api/v1/maintenance/:id` — ADMIN, MANAGER, SUPER_ADMIN, update
- `POST /api/v1/maintenance/:id/complete` — ADMIN, MANAGER, SUPER_ADMIN, complete + roll to next date

### Notifications — `/api/v1/notifications` (all Bearer, own data)
- `GET /api/v1/notifications` — list own
- `GET /api/v1/notifications/unread-count` — unread count
- `PATCH /api/v1/notifications/read-all` — mark all read
- `PATCH /api/v1/notifications/:id/read` — mark one read
- `GET /api/v1/notifications/devices` — list device tokens
- `PATCH /api/v1/notifications/devices` — register/refresh token
- `DELETE /api/v1/notifications/devices/:token` — remove token

### Dashboards — `/api/v1/dashboard`
- `GET /api/v1/dashboard/admin` — ADMIN, SUPER_ADMIN, customers/bookings/orders/maintenance/workforce
- `GET /api/v1/dashboard/manager` — MANAGER, ADMIN, SUPER_ADMIN, assigned-work scope
- `GET /api/v1/dashboard/employee` — EMPLOYEE, today attendance + assigned work
- `GET /api/v1/dashboard/customer` — CUSTOMER, bookings/history/upcoming maintenance

> Seed first admin: `SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD='...' npm run seed` (upsert by email, argon2id, forces ADMIN + active + verified). Register always creates CUSTOMER; staff via `POST /api/v1/employees` and `POST /api/v1/managers`; login via `POST /api/v1/auth/login`.





## API security and operations

Authentication uses access and refresh JWTs; authorization is enforced with role guards and ownership checks in services. DTO validation, Helmet, CORS allowlist, body limits, throttling, structured request logging, and a global exception filter are enabled. Swagger is off in production unless `SWAGGER_ENABLED=true`. Health: `/health/live` (liveness) and `/health` (readiness: DB + Redis). The app enables shutdown hooks and runs behind `tini` as a non-root user; Postgres connectivity is retried at boot and migrations run before the API starts. Logs and monitoring should be reviewed for sensitive-data exposure before production use. Exercise the full workflow in staging with real PostgreSQL, Redis, Firebase, and Cloudinary services.
