# Hostel Booking: website

A standalone Next.js 16 app (App Router, React 19, Tailwind v4, shadcn-style components). It shares **nothing** with `backend/` but the
API contract: types are generated from the backend's OpenAPI spec.

## Run it

```bash
# 1. backend running (API on :4000 + worker), seeded:  see ../docs/runbook.md
cd backend && pnpm dev:all

# 2. website
cd frontend
cp .env.example .env.local        # API_URL=http://localhost:4000
pnpm install
pnpm gen:api                      # refresh src/lib/api/schema.d.ts from the running backend
pnpm dev                          # http://localhost:3000
```

Demo logins (password `Password@123`): `guest1..5@hostel.dev`, `owner1..3@hostel.dev`, `admin@hostel.dev`.

| Script | What it does |
|---|---|
| `pnpm dev` / `build` / `start` | development, production build, production server |
| `pnpm gen:api` | pull `openapi.json` from the backend and regenerate TypeScript types |
| `pnpm typecheck` / `lint` | `next typegen && tsc`, ESLint (React Compiler rules included) |
| `pnpm test` | unit tests (Vitest): formatting, search URL state, redirects, BFF + token refresh |
| `pnpm e2e` | Playwright against a running site + backend (see below) |

## How it is put together

```
src/
  app/
    (site)/        public site + signed-in guest area (header, footer, phone tab bar)
    (auth)/        sign in / up / recovery
    owner/         host console          admin/   admin console
    api/bff/       the ONLY door to the backend (cookie session, token refresh, CSRF)
    api/session/   "who am I" that never 401s
  features/        feature-first: discovery, hostel, booking, checkout, account, owner, admin, coupons, wishlist
  components/      ui/ (shadcn-style primitives), common/ (states, dialogs, forms), layout/
  lib/             api client + generated types, formatting, session, server-only BFF code
```

**Sessions.** The browser never sees a token. `/api/bff/*` forwards to the backend with the access token from an httpOnly cookie,
refreshes it transparently, and only accepts state-changing requests from its own origin. Refresh is **single-flight with a grace
period**, because the backend rotates refresh tokens and treats a replayed old one as theft (it would sign the user out everywhere).
In production cookies are `__Host-` prefixed and `Secure`. Run the backend with `TRUST_PROXY=true` behind the site so its per-IP rate limits see real client IPs.

**Rendering.** Cache Components is on. Public pages (home, hostel detail) stream live data behind `<Suspense>`; everything signed-in is
client-rendered behind `<AuthGate>` and opts out of instant-navigation validation (`export const instant = false`). Anything that depends on
client-fetched state (who is signed in, what is saved, unread counts) is gated by `useHydrated()`, because streamed sections can hydrate
after shared queries have resolved and would otherwise mismatch the server HTML.

**Data.** TanStack Query for everything; keyset pagination (`useInfiniteQuery` + `LoadMore`); money is integer paise formatted by `lib/format`;
stay dates are calendar dates (never shifted through the viewer's timezone); every booking request carries an `Idempotency-Key`.

**Design.** Tokens live in `../docs/design-tokens.md` and `app/globals.css`. Mobile baseline: `viewport-fit=cover`, safe areas, 16 px inputs,
`dvh`, no sticky hover, 44 px targets, translucent chrome, bottom sheets (vaul) on phones.

## Tests

- **Unit** (`pnpm test`): pure logic and the security-critical BFF rules.
- **End-to-end** (`pnpm e2e`): real browsers against the real stack, seeded demo data. Needs the backend API + worker, Redis and Postgres.
  Covers the full guest journey (search, book, demo-pay by webhook, cancel with refund, declined-payment retry), host onboarding with real
  Cloudinary uploads, admin approval, request-to-book across three accounts, coupons, moderation and audit-chain verification, an axe
  WCAG 2.1 A/AA scan of 19 screens, and phone layouts at 320 and 390 px. Sessions are created once per run (`e2e/global-setup.ts`) so the
  login rate limiter is never tripped. Use `E2E_BASE_URL` to point at a production build (`pnpm build && pnpm start`).
- `/dev/break` (development only) feeds worst-case data (very long names, unbroken URLs, emoji, zero and huge numbers) to the real components.

## Not done yet

Google sign-in (waiting for client IDs: the buttons are intentionally absent), push notifications, a Content-Security-Policy (Phase 9).
