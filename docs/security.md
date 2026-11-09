# Security review (Phase 9)

Scope: backend API + worker, the Next.js website, the Flutter app. Method: read the code for each control, then back every claim with an
automated test so it cannot regress. Deployment hardening (containers, CI, prod environment) is deliberately out of scope for now.

## Controls and the tests that enforce them

| Area | Control | Enforced by |
|---|---|---|
| Authentication | argon2id passwords; access JWT 15 min (HS256, pinned `alg`, issuer + audience checked); opaque refresh tokens stored as sha256, rotated, reuse revokes the whole family; per-user revocation by issue time; 5 failed logins lock the account | `tests/auth`, `tests/unit` |
| Authorisation | RBAC on every route, plus ownership checks in the repositories. Someone else's object answers **404** (no existence leak); the wrong role answers **403** | `tests/security/route-guard.test.ts` (every route file refuses anonymous callers unless on an explicit public allowlist), `tests/security/cross-user-access.test.ts` |
| Privilege escalation | request bodies are strict objects; roles, verification and status cannot be set through `PATCH /me` or registration | `cross-user-access.test.ts` |
| Rate limiting | route-specific limits on auth, search, quotes, geo, uploads, payments, coupons, reviews; booking creation 10/min/user; **default per-user ceiling on all authenticated traffic: 600 reads and 120 writes per minute** (`core/auth/authenticate.ts`) | `tests/security/user-rate-limit.test.ts` |
| Injection | Prisma parameterised queries; no `$queryRawUnsafe` / `Prisma.raw` in `src`; zod validation on every input | grep audit (zero unsafe raw SQL) |
| Payments | webhook authenticated by timing-safe HMAC over the raw body, per-event idempotency, amount verification, booking-then-payment lock order | `tests/bookings/payments.test.ts` |
| Overbooking | conditional inventory updates in one transaction; idempotency keys per user | `tests/bookings/booking-create.test.ts` (40 guests racing for 4 beds), `loadtest/booking-race.js` (same, over real HTTP) |
| Uploads | backend signs; clients upload directly; folder prefix, type and size policy per kind; the attached `publicId` must live under the caller's own prefix and is verified with Cloudinary; KYC documents are private (`authenticated`) | `tests/listings` |
| Audit | append-only `audit_logs` (DB trigger blocks UPDATE/DELETE), hash-chained, verified by a scheduled job | `tests/db/db-guarantees.test.ts` |
| Logging | pino redaction of authorisation, cookies, passwords and tokens; caller-supplied `X-Request-Id` accepted only as a plain token | `user-rate-limit.test.ts` |
| Browser (website) | CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`, `form-action`, connect limited to self + Cloudinary, images limited to self + Cloudinary + OSM tiles), `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP; HSTS + `upgrade-insecure-requests` only when the site URL is https; BFF keeps tokens in httpOnly cookies | `frontend/e2e/csp.spec.ts` (headers, and no violation or failed request on key pages) |
| Mobile | tokens in Keychain/Keystore-backed storage (`first_unlock_this_device`), cleared on a fresh install; no request/response logging; no custom URL schemes or deep links; Android backup off; cleartext HTTP allowed **only in the debug build** (local backend) | code review; `flutter build apk --debug` |
| Dependencies | `pnpm audit --prod`: backend and website clean (2026-11-10) | re-run `pnpm audit --prod` |

## OWASP Top 10 (2021) mapping

| | Status |
|---|---|
| A01 Broken access control | Covered: route guard + cross-user tests, 404-not-403 convention. |
| A02 Cryptographic failures | Covered: argon2id, hashed tokens, pinned JWT algorithm, secrets only via validated env. TLS is a hosting concern. |
| A03 Injection | Covered: parameterised queries, zod, CSP against script injection. |
| A04 Insecure design | Covered: holds, idempotency, ledger, state machine, default rate ceiling. |
| A05 Security misconfiguration | Covered for code and headers; see "Assumptions" for the proxy setting. |
| A06 Vulnerable components | Clean at review time; needs a recurring check (CI is on hold). |
| A07 Identification and authentication failures | Covered: lockout, per-email and per-IP login limits, rotation with reuse detection. |
| A08 Software and data integrity failures | Covered: webhook HMAC, hash-chained audit log. |
| A09 Logging and monitoring failures | Logging and audit covered; alerting and crash reporting are on hold with deployment. |
| A10 SSRF | No user-supplied URL is ever fetched; the geocoder calls a fixed host. |

## Findings from this review

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | About 70 authenticated routes had no rate limit of their own (some are covered by service-level limits, e.g. booking creation) | Medium | **Fixed**: default per-user ceiling, tested |
| 2 | `X-Request-Id` from the caller was echoed and logged unvalidated | Low | **Fixed**: plain-token check, else a fresh id |
| 3 | No Content-Security-Policy on the website | Medium | **Fixed**: policy above, verified in a real browser |
| 4 | Mobile sign-in screens relied on the router redirect to leave; a pushed login stayed on screen after success | Functional | **Fixed**: explicit `leaveAuth` |
| 5 | Mobile `needsSignIn` matched `/host` as a prefix, so public `/hostel/...` pages demanded sign-in | Functional | **Fixed**, unit-tested |
| 6 | Android debug build did not compile (flavors use `resValue`, disabled by default in AGP 8+) | Build | **Fixed** |

No authorisation, injection or payment-integrity defects were found: every route refuses anonymous callers outside the public list,
and every cross-user access attempt tested (bookings, payments, notifications, listings, rooms, host and admin areas) is refused.

## Assumptions and accepted risks

- **Client IP.** `TRUST_PROXY=false` makes every caller `127.0.0.1`, so per-IP limits (login, search, quotes, geo) become one shared
  bucket; `TRUST_PROXY=true` trusts `X-Forwarded-For`, which is spoofable unless the app is only reachable through a proxy that
  overwrites it. Pick the setting that matches the network the API is exposed on. The new per-user ceiling does not depend on IPs.
- **Redis down.** Rate limits fail open except on auth routes (fail closed); idempotency and caching degrade gracefully.
- **CSP `'unsafe-inline'` for scripts.** A nonce-based policy would force every page to render dynamically and undo partial
  prerendering. The rest of the policy still blocks plugins, framing, foreign form targets and foreign connections. Revisit if the
  site starts rendering any user-supplied HTML (it does not today).
- **Demo payment gateway.** `/payments/webhooks/demo` and the demo checkout exist for this build; a real gateway replaces the provider
  without changing the webhook discipline (signature over raw body, event idempotency, amount check).
- **Metadata streaming.** Next streams `<meta>` into the body on dynamic pages, so Lighthouse reports no meta description on
  property pages. Crawlers receive blocking metadata, so search listings are unaffected.
