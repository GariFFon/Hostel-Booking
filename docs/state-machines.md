# State machines and money flow

## Booking
```
Instant-book:      PENDING_PAYMENT ──pay──▶ CONFIRMED ─check-in─▶ CHECKED_IN ─complete─▶ COMPLETED
Request-to-book:   PENDING_APPROVAL ─owner approves─▶ PENDING_PAYMENT ─pay─▶ CONFIRMED ...
                   PENDING_APPROVAL ─owner rejects─▶ REJECTED
Any waiting state ─deadline passes─▶ EXPIRED          (system)
PENDING_* / CONFIRMED ─cancel─▶ CANCELLED_BY_GUEST | CANCELLED_BY_OWNER (owner/admin)
CONFIRMED ─guest never arrives─▶ NO_SHOW
```
The table lives in `bookings.status.ts` (`TRANSITIONS`: who may do what) and is the only thing `transition()` consults; every change writes `booking_status_history` and an audit row in the same transaction.
Only the **system** can confirm a booking, and only after a captured payment (or a total of ₹0).

| State | Inventory | Deadline |
|---|---|---|
| PENDING_PAYMENT | `held_units` | `BOOKING_HOLD_MINUTES` (15) from creation; `APPROVAL_PAYMENT_WINDOW_MINUTES` (180) from approval |
| PENDING_APPROVAL | `held_units` | `APPROVAL_WINDOW_HOURS` (24) to answer |
| CONFIRMED / CHECKED_IN | `booked_units` | |
| terminal states | released (a past night is not resold) | |

Hold deadlines are enforced two ways, so correctness never depends on the worker being up: the worker's 30 s sweep, and an on-demand sweep for the hostel on every booking attempt and payment start.
A payment that arrives for a booking still in PENDING_PAYMENT is honoured even if the deadline just passed (the beds are still ours until released).

**Stay rules** (hostel's local date): check-in from the check-in date; complete from the check-out date; a no-show can be recorded from the check-in date; the system auto-completes the day after check-out and auto-records a no-show two days after the check-in date.

## Payment
`CREATED → PENDING → CAPTURED → PARTIALLY_REFUNDED | REFUNDED`, or `FAILED` (declined, expired, cancelled). Confirmation is **only** by signed webhook, never by the browser/app calling us.
Webhook handling: verify HMAC on the raw body (±5 min) → record the event id (replays are no-ops) → apply under **booking lock, then payment lock** (the one global lock order) → mark processed. A "captured" event is the truth about money: it is honoured even after a "failed", but a stale "failed" after "captured" is ignored.
Money that arrives for a booking that cannot use it (expired, cancelled, already paid) is refunded in full automatically.
Retries: after a failed payment the guest starts a new order while the hold lasts. Demo instruments: `DEMO_SUCCESS`, `DEMO_FAIL`, `DEMO_PENDING` (captured later, like UPI), `DEMO_TIMEOUT` (nothing ever arrives).

## Cancellation refunds (on the amount paid, incl. GST)
| Policy | Refund |
|---|---|
| FLEXIBLE | 100% until 24 h before check-in |
| MODERATE | 100% until 5 days, 50% until 24 h |
| STRICT | 50% until 7 days |
After the last window: 0%. Owner or admin cancellations always refund 100%. The retained part is split into GST, commission and owner share.
Refund = DB record created in the cancellation transaction, paid by the gateway **outside** it with an idempotency key; failures leave it `PENDING` and the worker retries every minute (escalated to admins after 48 h).

## Ledger (append-only, double entry, every entry is "from → to")
```
capture       GUEST         → PLATFORM_ESCROW   total paid
settlement    PLATFORM_ESCROW → OWNER_PAYABLE   room revenue (after discount) less commission
              PLATFORM_ESCROW → PLATFORM_REVENUE commission (PLATFORM_COMMISSION_BPS, snapshotted per booking)
              PLATFORM_ESCROW → TAX_PAYABLE     GST collected
cancellation  PLATFORM_ESCROW → REFUND_PAYABLE  refund; remainder settled as above
refund paid   REFUND_PAYABLE  → GUEST
```
Settlement happens on completion or no-show. A platform-wide (admin) coupon is funded by the platform: the owner earns on the full subtotal and `PLATFORM_REVENUE → PLATFORM_ESCROW` covers the discount; hostel coupons reduce the owner's share.
Invariant (tested for 500 random bookings and in every scenario): **escrow returns to exactly 0** once a booking is settled or fully refunded.

## Review
`PUBLISHED ⇄ HIDDEN`. Created `PUBLISHED` for a `COMPLETED` booking (guest, within 60 days of check-out; enforced in the service and again by a database trigger).
- Guest edit/delete: only while `PUBLISHED`, within 14 days of posting, and only until the host has replied (so a rating cannot be changed under an answer that was written for the old one). Deleting frees the booking for a new review inside the same limits.
- Host: reply (set/replace/remove) on `PUBLISHED` reviews; report (once) to the moderators. Hosts cannot change status.
- Admin: `hide` (reason required; shown to the guest) and `restore`. Both recompute the hostel rating and notify the guest.
Every transition recomputes `hostels.avg_rating` / `review_count` from the `PUBLISHED` rows under a row lock on the hostel, then invalidates the hostel/search caches after commit.

