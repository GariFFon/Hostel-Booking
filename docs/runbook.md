# Local runbook

## Services (macOS, Homebrew)
| Service | Port | Notes |
|---|---|---|
| PostgreSQL 16 (`postgresql@16`) | **5433** | Moved off 5432 because a separate PostgreSQL 18 owns that port. Role `hostel`, DBs `hostel_dev`, `hostel_test`. |
| Redis 8 | 6379 | DB 0 dev, DB 1 tests |
| Mailpit (later) | SMTP 1025, UI 8025 | `brew install mailpit` |

Required Postgres extensions: `cube`, `earthdistance`, `pg_trgm`, `btree_gist`, `pgcrypto`. `earthdistance` is not a
"trusted" extension, so a superuser must install them once in `template1` (so Prisma's shadow DB inherits them) and in
each database:
```bash
psql -p 5433 -d template1 -c "CREATE EXTENSION IF NOT EXISTS cube; CREATE EXTENSION IF NOT EXISTS earthdistance; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS btree_gist; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
```

## First run
```bash
cd backend && cp .env.example .env && pnpm install
# then edit .env: replace the two `change-me-...` secrets (openssl rand -base64 48 / openssl rand -hex 32); staging and production refuse the placeholders
pnpm dev            # API http://localhost:4000/api/v1/health
```

## Database workflow
```bash
cd backend
pnpm db:migrate          # create/apply a migration in dev
pnpm db:seed             # demo data (admin@hostel.dev, owner1..3@hostel.dev, guest1..5@hostel.dev / Password@123)
make db-reset            # run YOURSELF in a terminal: Prisma blocks `migrate reset` when invoked by AI agents
```
Never edit an applied migration; add a new one. Tests use the separate `hostel_test` DB (migrated automatically by
`tests/global-setup.ts`). Readiness probe: `GET /api/v1/health/ready` (Postgres + Redis).

## Database workflow
```bash
cd backend
pnpm db:migrate          # create/apply a migration in dev
pnpm db:seed             # demo data (admin@hostel.dev, owner1..3@hostel.dev, guest1..5@hostel.dev / Password@123)
make db-reset            # run YOURSELF in a terminal: Prisma blocks `migrate reset` when invoked by AI agents
```
Never edit an applied migration; add a new one. Tests use the separate `hostel_test` DB (migrated automatically by
`tests/global-setup.ts`). Readiness probe: `GET /api/v1/health/ready` (Postgres + Redis).

## Verifying Cloudinary
`cd backend && pnpm check:cloudinary` uploads a 1×1 PNG (public and private) to the account in `.env`, exercises signing, server-side verification,
CDN variants, tamper rejection and private-link access, then deletes everything. Tests never call Cloudinary (they use an in-memory fake).

## Verifying the geocoder
`cd backend && pnpm check:geocode` makes two real requests to OpenStreetMap Nominatim. Before deploying, set `GEOCODER_USER_AGENT` to include a real contact (their usage policy).

## Background worker
Payments, refunds, mail and the recurring sweeps (expiry every 30 s, refund retries, reminders, auto-complete/no-show, inventory horizon, and nightly: audit-chain check, notification retention, hostel-rating reconcile) run in a separate process:
```bash
cd backend && pnpm dev:all        # API + worker together
# or in two terminals:  pnpm dev   and   pnpm worker
```
`QUEUE_MODE=bullmq` (default) needs the worker: without it demo payments stay `CREATED`. `QUEUE_MODE=inline` runs jobs inside the API process (used by tests).
The demo gateway's webhook is delivered by the worker over HTTP to `APP_URL`, so `APP_URL` must be reachable from the worker. Production: run one or more worker processes (`pnpm worker:start`); schedules are idempotent.

## Website
```bash
cd frontend && cp .env.example .env.local && pnpm install && pnpm gen:api && pnpm dev     # http://localhost:3000
```
The site needs the API **and the worker** running (`cd backend && pnpm dev:all`): demo payments are confirmed by a webhook the worker delivers.
Production: `pnpm build && pnpm start`; set `API_URL`, `NEXT_PUBLIC_SITE_URL`; run the backend with `TRUST_PROXY=true` (the site is its only caller,
so rate limits must see the real client IP, which the site forwards in `X-Forwarded-For`). `pnpm e2e` needs a seeded database (`make db-reset` once).

