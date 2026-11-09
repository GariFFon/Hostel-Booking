# Architecture (summary)

Two independent Next.js projects in this repo (`backend/` API-only, `frontend/` website) plus a Flutter app in
`Hostel-Booking-App`. The only contract between them is the OpenAPI spec served at `/api/v1/openapi.json`.

Backend layering: `route.ts` (thin) -> `wrap()` -> `*.service.ts` (rules, transactions, audit) ->
`*.repository.ts` (only Prisma/SQL). Cross-cutting: `src/core`; external systems: `src/infra`; background work: `src/jobs` + `worker.ts`.

Full plan: see the project plan (domain model, state machines, audit design) in `docs/` as it is written.

## Website (frontend/)

Browser -> Next.js site -> `/api/bff/*` -> backend. The site is a backend-for-frontend: tokens live in httpOnly cookies and never reach
JavaScript, refresh is single-flight (the backend revokes a token family if an old refresh token is replayed), unsafe requests must be
same-origin, and only an allow-listed path shape is forwarded (server-to-server routes such as the payment webhook are blocked).
Public pages are server-rendered and streamed; signed-in areas are client-rendered behind an auth gate. Types are generated from the
OpenAPI contract (`pnpm gen:api`). See `frontend/README.md` and `docs/design-tokens.md`.

