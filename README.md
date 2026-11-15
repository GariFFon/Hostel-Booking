# Hostel Booking

> **Live website: https://hostel-booking-web.onrender.com**
> API: https://hostel-booking-api-u2po.onrender.com/api/v1 · OpenAPI: `/api/v1/openapi.json`
> Mobile app: the sibling repo [`Hostel-Booking-App`](../Hostel-Booking-App) (Flutter, Android + iOS).
>
> The site runs on Render's free tier, so the first request after a quiet period can take 30 to 60 seconds while the service wakes up.

A marketplace for **hostels, PGs and hotels** with two ways to stay:

- **Nightly stays (hotels):** search, quote, hold, pay, check in, check out, review.
- **Long-term stays (hostels and PGs):** apply for a bed or be invited by the owner, move in, pay **monthly rent**, raise **complaints** to staff, give notice, and settle the **security deposit** at move-out.

The property type alone decides the mode (`HOTEL` = nightly; `HOSTEL` and `PG` = tenancy). See [ADR 0001](docs/adr/0001-property-types-and-stay-modes.md).

## Contents

1. [What is in this repository](#what-is-in-this-repository)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Tech stack](#tech-stack)
5. [Quick start (local)](#quick-start-local)
6. [Demo accounts](#demo-accounts)
7. [Configuration](#configuration)
8. [Everyday commands](#everyday-commands)
9. [Testing](#testing)
10. [Background jobs](#background-jobs)
11. [Phone push notifications](#phone-push-notifications)
12. [Deployment (Render)](#deployment-render)
13. [Project layout](#project-layout)
14. [Documentation](#documentation)
15. [Conventions and gotchas](#conventions-and-gotchas)

## What is in this repository

| Folder | What it is |
|---|---|
| [`backend/`](backend) | API-only Next.js service on `:4000`, the PostgreSQL schema (Prisma), and the BullMQ worker |
| [`frontend/`](frontend) | The website on `:3000`. It talks to the API only through its own `/api/bff/*` proxy |
| [`docs/`](docs) | Architecture, API conventions, ERD, state machines, security, runbook, design tokens, ADRs |
| [`loadtest/`](loadtest) | Load-test scripts |
| `render.yaml` | Render Blueprint (API + worker in one instance, website, Postgres, Redis) |
| `Makefile` | Shortcuts for the commands below |

The only contract between the backend, the website and the mobile app is the **OpenAPI spec** at `/api/v1/openapi.json`.

## Features

**Guests and tenants**
- Search with filters, map and sorting; property pages with gallery, rooms, reviews and price breakdown (GST itemised).
- Nightly booking: quote, idempotent reserve, hold timer, demo payment, cancel with refund preview, review.
- Long-term: ask for a bed (marketplace application) or accept an owner's invitation; My stay, monthly rent invoices, online or offline payment, PDF invoices and receipts, complaints with photos, move-out notice, deposit settlement (accept or dispute).
- Wishlist, notifications (in-app, email, phone push) with per-category switches (bookings, reviews, rent, complaints).
- Email and password sign-in, Google sign-in.

**Owners (hosts)**
- Create and edit listings, room types, **beds (room units)**, photos (Cloudinary), pricing, coupons, calendar.
- Booking inbox (accept, decline, check in, complete, no-show), earnings, reviews with replies.
- Tenants: approve or decline applications, invite a tenant by email, move in, record the deposit and offline rent (cash, UPI, bank), issue refunds, end a stay with a deposit settlement and evidence photos.
- Rent roll, dues and occupancy reports, complaints, staff management, an owner-scoped activity log, host verification (KYC).

**Staff** (electrician, plumber and other trades): see only the complaints assigned to them, update status, comment. Staff never see tenant contact details. Platform vendors can be engaged by several owners.

**Admins**: hosts and listings review, KYC, reviews moderation, coupons, amenities, rent and tenancy oversight, complaints (read-only), global audit log, deposit dispute resolution.

## Architecture

```
Browser ──► Next.js website ──► /api/bff/* ──► Backend API (/api/v1) ──► PostgreSQL
                                                  │                  └─► Redis (queues, rate limits)
Flutter app ──────────────────────────────────────┤                  └─► Cloudinary (images)
                                                  └─► BullMQ worker ──► mail (SMTP/Resend), FCM push
```

- **Backend layering:** `route.ts` (thin) → `wrap()` → `*.service.ts` (rules, transactions, audit) → `*.repository.ts` (Prisma and SQL only). Cross-cutting code is in `src/core`, external systems in `src/infra`, background work in `src/jobs` and `src/worker.ts`.
- **Website is a backend-for-frontend:** tokens live in httpOnly cookies and never reach JavaScript; refresh is single-flight; unsafe requests must be same-origin; only allow-listed paths are forwarded.
- **State machines** (bookings, tenancies, complaints, deposit settlements) each live in one file and are the single source of truth. See [docs/state-machines.md](docs/state-machines.md).
- **Money is integer paise**, everywhere. Stay dates are calendar dates, never UTC instants.
- **Every mutation is audited** in the same transaction (hash-chained audit log). Effects such as email and push run after commit.

## Tech stack

| Layer | Technology |
|---|---|
| API | Next.js (route handlers), TypeScript, Zod, Prisma 7, PostgreSQL 16, Redis, BullMQ |
| Website | Next.js 16 (App Router), React, Tailwind, TanStack Query, generated OpenAPI types |
| Mobile | Flutter, Riverpod 3, go_router, dio (separate repo) |
| Media | Cloudinary (signed uploads, private evidence files) |
| Mail | SMTP (Mailpit locally) or Resend |
| Push | Firebase Cloud Messaging HTTP v1 (no SDK on the server) |
| Payments | Demo gateway behind a provider interface (Razorpay-ready) |
| Tests | Vitest, Playwright, flutter_test |

## Quick start (local)

Prerequisites: macOS or Linux, Node 20+, pnpm, PostgreSQL 16 (port **5433**), Redis. Details in [docs/runbook.md](docs/runbook.md).

```bash
# 1. Services (macOS / Homebrew)
make services

# 2. Backend
cd backend
cp .env.example .env            # then replace the two change-me secrets (see Configuration)
pnpm install
pnpm db:deploy                  # apply migrations
pnpm db:seed                    # demo data
pnpm dev:all                    # API on :4000 and the worker together

# 3. Website (new terminal)
cd frontend
pnpm install
pnpm dev                        # http://localhost:3000
```

Check the API: `http://localhost:4000/api/v1/health` and `/api/v1/health/ready` (Postgres and Redis).

PostgreSQL needs the extensions `cube`, `earthdistance`, `pg_trgm`, `btree_gist` and `pgcrypto`; the runbook shows the one-off command.

## Demo accounts

Created by `pnpm db:seed`. Password for all: `Password@123`. **Local and demo only; never seeded in production.**

| Role | Email |
|---|---|
| Admin | `admin@hostel.dev` |
| Owners | `owner1@hostel.dev`, `owner2@hostel.dev`, `owner3@hostel.dev` (owner3 runs the PG used for tenancy demos) |
| Guests | `guest1@hostel.dev` to `guest5@hostel.dev` |

Seeded beds exist for every long-term room type. If you add tenants to an older dev database, create beds first under **Owner → Properties → Rooms**.

## Configuration

All settings are environment variables in `backend/.env` (see [`backend/.env.example`](backend/.env.example), the full list). The ones you will touch:

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Postgres and Redis |
| `JWT_ACCESS_SECRET`, `DEMO_WEBHOOK_SECRET` | Generate your own: `openssl rand -base64 48` and `openssl rand -hex 32`. Staging and production refuse the placeholders |
| `APP_URL`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS` | Public addresses and CORS |
| `CLOUDINARY_*` | Image uploads |
| `MAIL_DRIVER` (`smtp`, `resend`, `log`), `MAIL_FROM`, `RESEND_API_KEY` | Email |
| `GOOGLE_CLIENT_IDS` | Comma-separated web, Android, iOS client IDs |
| `PUSH_DRIVER` (`off`, `log`, `fcm`), `FCM_SERVICE_ACCOUNT_FILE` or `_JSON` | Phone push |
| `PAYMENT_PROVIDER`, `ALLOW_DEMO_PAYMENTS` | Demo gateway (refused in production unless allowed) |
| `PLATFORM_COMMISSION_BPS`, `RENT_COMMISSION_BPS`, `GST_*` | Business rules (basis points; rent commission defaults to 0%) |
| `QUEUE_MODE` | `bullmq` (needs the worker) or `inline` |

Never commit `.env`, service-account keys or `google-services` secrets.

## Everyday commands

| Command | Where | What |
|---|---|---|
| `pnpm dev` / `pnpm worker` / `pnpm dev:all` | backend | API, worker, or both |
| `pnpm db:migrate` | backend | Create and apply a migration (dev) |
| `pnpm db:deploy` | backend | Apply pending migrations |
| `pnpm db:seed` | backend | Load demo data |
| `make db-reset` | repo root | Drop, migrate, seed. Run it yourself in a terminal |
| `pnpm openapi` | backend | Regenerate `openapi.json` |
| `pnpm gen:api` | frontend | Regenerate API types (reads the running API; copy `backend/openapi.json` if it is stale) |
| `pnpm typecheck`, `pnpm lint` | both | Static checks |

Never edit a migration that has been applied anywhere; add a new one.

## Testing

```bash
cd backend  && pnpm test        # Vitest against the separate hostel_test database (migrated automatically)
cd frontend && pnpm test        # unit tests
cd frontend && pnpm e2e         # Playwright browser journeys (needs a seeded stack)
cd frontend && pnpm perf:budget # bundle budget
```

Current suite sizes: about **985** backend tests, **128** website unit tests and **106** Playwright tests, plus the Flutter suite in the app repo. The backend suite covers state machines, database guarantees (checks, triggers), cross-user access, the worker with a capture queue, the OpenAPI contract and a guard that every route authenticates.

Run end-to-end tests on a throwaway stack (own ports and database), never against your dev servers.

## Background jobs

Run by the worker (`src/worker.ts`) on fixed intervals; all jobs are idempotent.

| Job | Purpose |
|---|---|
| Hold and approval expiry | Release unpaid holds and unanswered requests |
| `rent-sweep` (hourly) | Issue invoices 7 days ahead, reminders, overdue, late fee, activate and end tenancies |
| `complaint-sweep` (hourly) | SLA escalation |
| Deposit sweep | Auto-agree proposals after 7 days; retry online refunds |
| `push-dispatch` (30 s) | Send phone notifications, once each |
| Mail and notification fan-out | Email and in-app delivery |

## Phone push notifications

The worker sends push through FCM HTTP v1 using a service-account key (no Firebase SDK). Each notification is claimed once through `notifications.pushed_at`, so nothing is sent twice, and notifications older than an hour are skipped. Dead device tokens are removed automatically. Set `PUSH_DRIVER=fcm` and one of `FCM_SERVICE_ACCOUNT_FILE` or `FCM_SERVICE_ACCOUNT_JSON`. The Firebase project for the app is separate from any Google Cloud project used for sign-in.

## Deployment (Render)

[`render.yaml`](render.yaml) is a Blueprint for the free tier: API and worker in one instance, the website, Postgres and Redis (Singapore). Migrations run at boot. An uptime pinger on `/api/v1/health/ready` keeps the API awake.

Free-tier limits to plan for: services sleep, and **the free Postgres expires 30 days after creation (around 15 Dec 2026)**. Export or move it before then. On Render set the real secrets, `PUSH_DRIVER=fcm` and `FCM_SERVICE_ACCOUNT_JSON`.

## Project layout

```
backend/
  prisma/            schema, hand-written migrations, seed
  src/app/api/v1/    route handlers (thin)
  src/modules/       auth, hostels, rooms, units, bookings, payments, pricing, tenancies, rent,
                     complaints, staff, notifications, reviews, reports, audit, kyc, media, ...
  src/core/          config, auth, errors, http helpers, request context
  src/infra/         db, queue, mail, push, payments gateway, cloudinary
  src/jobs/          job handlers          src/worker.ts   schedules
  tests/             vitest suites
frontend/
  src/app/           (site) public + account, owner/, admin/, staff/, (auth)/, api/bff
  src/features/      one folder per feature (owner, admin, account, rent, ...)
  e2e/               Playwright specs
docs/                see below
```

## Documentation

| Doc | Topic |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Layers and the website BFF |
| [docs/api-conventions.md](docs/api-conventions.md) | Errors, pagination, idempotency, versioning |
| [docs/erd.md](docs/erd.md) | Data model |
| [docs/state-machines.md](docs/state-machines.md) | Booking, tenancy, complaint and deposit transitions |
| [docs/security.md](docs/security.md) | Auth, signed links, audit, threat notes |
| [docs/runbook.md](docs/runbook.md) | Running and operating locally |
| [docs/design-tokens.md](docs/design-tokens.md) | Shared design tokens (change here first) |
| [docs/adr/](docs/adr) | Architecture decisions |

## Conventions and gotchas

- Idempotency: unsafe requests accept an `Idempotency-Key`; retries reuse it.
- Document links (receipts, invoices, deposit receipts) are signed and expire after 5 minutes.
- Tenant is not a role: it is derived from an active tenancy, so one person can be guest and tenant.
- GST on long-stay rent, the deposit cap (2 months), the notice period (30 days) and the late fee are **per-property settings with defaults**. They need an accountant or lawyer's sign-off before real use; this is not legal advice.
- Local Postgres runs on **5433**, not 5432.
