# API conventions

Base path `/api/v1`. Spec: `GET /api/v1/openapi.json` (generated from the zod schemas; `pnpm openapi` writes `backend/openapi.json`).

**Envelope** — success `{ "data": ..., "meta": { "requestId", "nextCursor?", "total?" } }`; failure
`{ "error": { "code", "message", "details", "requestId" } }`. Every response carries `X-Request-Id` (send your own to correlate).

| code | HTTP | meaning |
|---|---|---|
| VALIDATION_FAILED | 422 | `details` = `[{path, message}]` |
| UNAUTHENTICATED | 401 | missing/invalid/expired/revoked token |
| FORBIDDEN | 403 | role or ownership check failed |
| NOT_FOUND / CONFLICT | 404 / 409 | |
| RATE_LIMITED | 429 | `Retry-After` header (seconds) |
| SOLD_OUT, INVALID_STATE_TRANSITION, IDEMPOTENCY_CONFLICT | 409 | booking domain |
| PAYMENT_FAILED | 402 | |
| DEPENDENCY_UNAVAILABLE | 503 | e.g. Redis down on an auth route, Google not configured |

## Authentication
- `Authorization: Bearer <accessToken>` (JWT HS256, 15 min). Refresh tokens are opaque, 30 days, **rotated on every use**.
- **Serialise refresh calls on the client (single-flight).** Replaying a used refresh token is treated as theft and
  revokes the whole session family, so two parallel refreshes would log the user out.
- Password reset/change, `logout-all` and role changes invalidate previously issued access tokens (checked in Redis by issue time).
  After `POST /me/become-owner` the client must call `/auth/refresh` to receive a token carrying the new role.
- Web: the Next.js frontend keeps tokens in httpOnly cookies via its own BFF routes. Flutter: `flutter_secure_storage`.
- `POST /auth/google` takes a Google **ID token** from either client; the server verifies it against `GOOGLE_CLIENT_IDS`.
- 5 failed logins lock an account for 15 minutes. Unknown email and wrong password return the same error.

## Rate limits (sliding window, Redis)
register 10/h/IP · login 30/15 min/IP + 10/15 min/email · refresh 120/min/IP · forgot-password 5/h/email · resend-verification 3/h/email.
Auth routes fail closed (503) if Redis is down; other routes fail open.
Behind a proxy set `TRUST_PROXY=true` so the real client IP is read from `X-Forwarded-For`.

## Conventions
Money in integer paise. Dates `YYYY-MM-DD` in the hostel's timezone. Mutations write an audit row in the same DB transaction.
`Idempotency-Key` header is required on booking/payment creation (Phase 5).

## Uploads (Cloudinary, direct from client)
1. `POST /uploads/signature {purpose, hostelId?}` → `{uploadUrl, fields, publicId, maxBytes, allowedFormats, expiresAt}`. The server generates the
   `public_id` (under an environment- and owner-scoped folder) and signs it together with `type`, `allowed_formats` and `overwrite=false`.
2. Client `POST`s `multipart/form-data` to `uploadUrl` with **exactly** `fields` plus `file`. Changing any signed field is rejected by Cloudinary.
   (With curl use `--form-string`: `-F` mangles `;` in data URIs.)
3. Client attaches the result: `POST /owner/hostels/{id}/media {publicId}`, `POST /owner/kyc/documents`, or `PUT /me/avatar`.
   The server **re-reads the asset from Cloudinary** and enforces folder ownership, format and size; violating uploads are deleted.
- KYC documents are `authenticated` (private): never reachable by URL. Admins get 10-minute signed links, and each view is audited.
- Photo DTOs carry `thumbUrl` / `cardUrl` / `fullUrl` (Cloudinary CDN transformations, auto format/quality). Deleted images can stay in CDN caches briefly.

## Listing lifecycle
`DRAFT → PENDING_REVIEW → APPROVED | REJECTED`; `APPROVED ⇄ SUSPENDED` (admin); owners can withdraw `PENDING_REVIEW`/`APPROVED` back to `DRAFT`
(an approved listing with live bookings must stay online). Submitting requires: owner KYC `APPROVED`, ≥3 listing photos, ≥1 active room type;
`422` lists exactly what is missing. Approved listings remain editable by their owner (every change is audited); pending ones must be withdrawn first.

PATCH endpoints are true partial updates, and accept `expectedVersion` for optimistic locking (`409` + `currentVersion` on mismatch).
Owner calendar: `PUT /owner/room-types/{id}/blocks` sets blocked units per night (all-or-nothing, never over booked units);
capacity changes can't drop below booked + held + blocked on any future night.

## Discovery (public, no token)
`GET /hostels` filters: `q`, `city`, `lat`+`lng`+`radiusKm` (default 25), `bbox` (minLng,minLat,maxLng,maxLat), `checkIn`+`checkOut`+`guests`,
`minPrice`/`maxPrice` (paise per night), `amenities` (comma list, ALL must match), `propertyType`, `roomKind`, `gender`, `minRating`, `instantBook`.
`sort`: `recommended` (default), `relevance` (default when `q` is set), `distance` (default when `lat` is set), `price_asc`, `price_desc`, `rating`, `newest`.
Pagination is keyset: pass `meta.nextCursor` back as `cursor` with the **same filters and sort** (a cursor from another sort is a 422).
`meta.total` is returned on the first page only. With dates, a listing is returned only if its matching rooms have enough free beds/rooms for **every** night
and for the party size, respecting min/max stay; results then carry `stayFromPricePaise` (real average nightly price incl. price rules).
`GET /hostels/map` (bbox required) returns lightweight markers; `GET /hostels/{idOrSlug}` is the detail page; `/availability` and `/calendar` serve date pickers.
`GET /search/suggest`, `GET /cities`, `GET /geo/search`, `GET /geo/reverse` (OpenStreetMap, cached 24 h, 1 upstream request/second, 30/min/IP).

## Quotes and money
`POST /quotes` is read-only (holds nothing). Rules: the nightly unit price is the highest-priority price rule that applies (rules never stack), else the base price.
Coupons discount the subtotal **before** tax. GST is chosen **per room-night** by its declared tariff: 5% up to ₹7,500, 18% above
(`GST_LOW_BPS`, `GST_HIGH_BPS`, `GST_THRESHOLD_PAISE`; confirm the current slabs with your accountant). `total = subtotal - discount + tax` in integer paise
(there is no guest service fee in v1; commission is taken from the owner's share). A coupon that does not apply returns `coupon.valid=false` with a reason and a full-price quote;
per-user limits are applied when a bearer token is sent and enforced again at booking. Monthly (PG) rents are prorated per night (rent / 30).
Cancellation terms in the quote: FLEXIBLE full refund until 24 h before check-in; MODERATE 100% until 5 days, 50% until 24 h; STRICT 50% until 7 days. Check-in time is in the hostel's timezone.

## Caching
Public reads are cached in Redis with version-based invalidation (`X-Cache: HIT|MISS` on responses). Any listing, room, price-rule, photo, status or amenity change
invalidates the affected entries immediately (after the DB commit). Searches with dates also depend on live inventory, so every hold, booking, cancellation, calendar
block or capacity change invalidates them. Redis being down only turns hits into misses.

## Bookings and payments
- `POST /bookings` **requires an `Idempotency-Key`** (8-80 chars). Generate one per user action and reuse it on every retry: the response is replayed (`Idempotent-Replayed: true`); the same key with a different body is `409 IDEMPOTENCY_CONFLICT`; a concurrent duplicate gets `409` with `details.inProgress` (retry shortly). Other mutating calls accept the header optionally.
- Send `expectedTotalPaise` (the total you showed the user). If the live price differs you get `409 PRICE_CHANGED` with the new total instead of a surprise charge.
- Overbooking is impossible: `409 SOLD_OUT` is the normal answer when someone else got the last beds first.
- Paying: `POST /bookings/{id}/payments` → open order (resumed if one exists) → client pays → **poll `GET /payments/{id}` or `GET /bookings/{id}` until `CAPTURED` / `CONFIRMED`**; confirmation arrives asynchronously by webhook, typically within seconds. Show the `holdExpiresAt` countdown.
- `GET /bookings/{id}` returns `actions` (what the viewer may do now: `pay`, `cancel`, `approve`, `reject`, `check_in`, `complete`, `no_show`, and for guests `review`), the `timeline`, the payment/refund state and, for guests, `cancellation.refundPaiseNow`. Drive buttons from `actions`, not from status guesses.
- The property's phone and the guest's contact details are revealed only once a booking is confirmed.
- Webhook: `POST /payments/webhooks/demo` with `X-Demo-Signature: t=<unix>,v1=<hex hmac-sha256("t.rawBody", DEMO_WEBHOOK_SECRET)>`. Idempotent by event `id`.
- Admin: `GET /admin/audit-logs` (filters: entityType, entityId, actorId, action prefix, outcome, from/to; newest first) and `GET /admin/audit-logs/verify` (recomputes the tamper-evident hash chain).

## Reviews and ratings
- A guest can review a **completed** stay once, within **60 days of check-out**. The booking tells you when: `GET /bookings/{id}` lists the `review` action and carries `reviewId` afterwards. `POST /bookings/{id}/review` takes `overall` (1-5, required), optional `cleanliness`, `location`, `staff`, `valueForMoney` (1-5), `title` (<=100) and `comment` (<=2000). Control characters are rejected; tabs, newlines, emoji and any script are fine.
- Edit (`PATCH /reviews/{id}`, `null` clears an optional field) and delete (`DELETE /reviews/{id}`) work for **14 days after posting and only until the host replies**; a review hidden by moderators cannot be changed or deleted. `GET /me/reviews` returns `editable` / `editableUntil`, and `status` + `moderationReason` for hidden reviews.
- Public: `GET /hostels/{idOrSlug}/reviews` (`sort=recent|highest|lowest`, `rating=1..5`, keyset pagination; reviewer shown as "Asha R.", stay as month + nights) and `/reviews/summary` (distribution + category averages). `avgRating` / `reviewCount` on listings and search come from the same rows and are recomputed inside every review write (the hostel row is locked, so concurrent writes cannot lose an update); a nightly job repairs any drift.
- Hosts: `GET /owner/reviews`, `PUT|DELETE /owner/reviews/{id}/reply` (one public reply; the guest is told about the first), `POST /owner/reviews/{id}/report` (once per review; hosts cannot hide reviews). Admins: `GET /admin/reviews`, `POST /admin/reviews/{id}/hide|restore`.
- Review text is user content: **render it as text, never as HTML**. The audit log records ratings and text lengths only, never the text.

## Wishlist
`PUT|DELETE /me/wishlist/{hostelId}` are idempotent (a listing must be live to be saved; max 500). `GET /me/wishlist` returns cards, newest first; listings that go offline are hidden and reappear if reinstated. Search results are public and cached, so clients draw the heart from `GET /me/wishlist/ids` (one call, then keep it in sync locally).

## Coupons and offers
- Hosts: `/owner/coupons` (CRUD) for their own properties, **funded by the host** (the discount reduces the payout). Admins: `/admin/coupons`, **platform-wide only**, funded by the platform; for a host's code an admin may only switch it off or unlist it (`isActive`, `isPublic`).
- Codes are 4-20 characters (`A-Z 0-9 - _`), stored upper-case, globally unique, case-insensitive at checkout. The code, discount type and property never change after creation. `PERCENT`: 1%-100% (`percentBps` 100-10000) with optional `maxDiscountPaise`; `FLAT`: Rs 1 to Rs 50,000. A coupon that covers everything makes the stay **free: it confirms immediately and there is nothing to pay**.
- A coupon that has ever been used cannot be deleted (bookings and the ledger point at it): `DELETE` answers `409`, deactivate it instead. The usage limit can never be set below what is in use. A host can have at most 200 coupons.
- `GET /hostels/{idOrSlug}/offers` lists public, currently valid, not fully redeemed codes (the property's own and platform-wide) with a ready-made `headline`. Private codes are simply not listed. The terms are always re-checked by `/quotes` and at booking time.

## Notifications
- `GET /me/notifications` (newest first; `unread=true`, `type=`; keyset), `GET /me/notifications/unread-count` (poll this for the badge), `POST /me/notifications/{id}/read`, `POST /me/notifications/read-all`, `DELETE /me/notifications/{id}`. Each item has `type`, `title`, `body` and `data` (deep-link ids such as `{bookingId}` or `{hostelId}`). Read items are deleted after 90 days, everything after a year.
- `GET|PATCH /me/notification-preferences`: `inAppBookings` (booking, payment and refund items), `inAppReviews`, `emailBookings`, `emailMarketing` (nothing is sent yet). Account, listing-moderation, KYC and system notices cannot be muted. Confirmation, cancellation, payment and refund **emails** are transactional and always sent; `emailBookings` only controls the pre-stay reminder email.
- `POST /me/devices` registers an FCM/APNs token (idempotent; a token follows the signed-in account; the 10 most recent installs are kept) and `DELETE /me/devices/{id}` unregisters it on sign-out. Push delivery itself is not switched on yet.

