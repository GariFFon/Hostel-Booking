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

## Tenancy application (phase 11)

`REQUESTED` -> `APPROVED` (owner; creates a tenancy) | `REJECTED` (owner, with a reason) | `WITHDRAWN` (applicant) | `EXPIRED` (system, after 14 days of silence). All other states are terminal.

## Tenancy (phase 11; notice and move-out in phase 14)

```
INVITED --accept--> PENDING_MOVE_IN --activate (deposit recorded or none)--> ACTIVE --give notice--> NOTICE --move-out / notice over--> ENDED
   |                       |
   +-- decline / cancel / invite expires --> CANCELLED <--+
```

- An approved application creates the tenancy directly in `PENDING_MOVE_IN`; an owner-added tenant starts `INVITED` until they accept (by id if they have an account, by emailed token if not; tokens expire after 7 days).
- Terms (rent, deposit, due day, grace, notice, start date) are snapshotted onto the tenancy and editable only before move-in; the deposit is locked once received.
- Every transition runs under a row lock, bumps `version`, writes an audit row with `metadata.hostelId`, and notifies the other party after commit.
- The `tenancy-sweep` job (hourly, idempotent) expires stale requests and invitations.

## Rent invoice (phase 12)

```
DUE --partial payment--> PARTIALLY_PAID --rest--> PAID
 |                            |
 +--- (no payments) ---> VOID  (payments must be reversed first)
```

- **Overdue is derived, not a status:** an open invoice is overdue once `overdue_after` (due date + the tenancy's grace days) has passed.
- Invoices are calendar-month periods, issued by the hourly `rent-sweep` job a week before they are due (the first, possibly part-month, one is issued at move-in and billing starts then, never at an old start date). Missed months are caught up in order.
- Lines (rent, electricity, maintenance, adjustment, credit, late fee) add up to the totals; GST applies to rent lines only. The late fee is added once, after the grace period.
- Money in: the owner **records** cash/UPI/bank (`rent_payments`, reversible if mistaken), or the tenant pays **online** through a gateway order (`rent_orders`); a successful online payment creates the same `rent_payments` row (`method = ONLINE`) and ledger entries (`GUEST -> OWNER_PAYABLE`, plus `GUEST -> PLATFORM_REVENUE` when `RENT_COMMISSION_BPS` > 0).
- While an online order is open the owner cannot record a payment, add a line or void; an order untouched for 30 minutes (and with no attempt in flight) is closed automatically.
- Money that arrives for an invoice that was settled or cancelled in the meantime is recorded and flagged (`rent.payment.needs_review` in the audit log) for a manual refund.

## Design note: why rent has its own order tables

The plan was to generalise `payments` so rent could reuse it. Rent instead has `rent_orders` / `rent_order_attempts`, reusing the same gateway provider, test instruments, webhook signature and endpoint (the shared handler falls back to rent when the order is not a booking payment). Bookings' hold, expiry and refund logic is tightly tied to `payments.booking_id`, and changing it would have put a well-tested money path at risk for no benefit.


## Complaint (phase 13)

```
OPEN --acknowledge--> ACKNOWLEDGED --assign--> ASSIGNED --start--> IN_PROGRESS --resolve--> RESOLVED --close/auto (7 days)--> CLOSED
  |  \--assign (owner, or system auto-assign by trade)--^   ^  \--hold--> ON_HOLD --start--^          \--reopen (tenant, <= 7 days, <= 3 times)--> REOPENED --> (assigned again)
  +--reject (owner/admin)--> REJECTED        unassign / person removed or paused --> back to OPEN        tenant may close from any open state (withdraw)
```

The single source of truth is `TRANSITIONS` in `complaints.status.ts` (who may make each move); `moveComplaint` in `complaints.core.ts` is the only place status changes.

- **Who:** the tenant files, comments, closes, reopens and rates; the owner acknowledges, assigns, reprioritises, resolves or rejects; staff start, hold and resolve their own jobs; admins can read but not act; the system auto-assigns, hands jobs back and auto-closes.
- **Auto-assign:** on filing, an active staff member of the matching trade at that property with the fewest open jobs (a platform vendor engaged there counts). `OTHER` and trade-less categories wait for the owner.
- **SLA clock** runs while OPEN, ACKNOWLEDGED, ASSIGNED, IN_PROGRESS or REOPENED (not ON_HOLD). The hourly `complaint-sweep` job notifies once when it is breached and closes RESOLVED complaints after 7 days of silence.
- **Free time and visits (no status change):** the tenant must give a free-time window when filing (1 hour to 7 days long, starting within 30 days, in the future) and may change it while the complaint is open. Staff (or the owner) book a visit slot of up to 8 hours inside that window; the tenant is told, and is asked to be home unless they allowed entry while away. Changing the window drops a booked visit that no longer fits and asks staff to book again; reassigning, taking back, handing back, or reopening clears the visit (a reopen needs a fresh window once the old one has passed). The hourly sweep flags once a booked visit that has passed while the job is still open.
- **Limits:** 10 unresolved complaints per tenant, 6 photos per complaint, 3 reopens, rating once (1-5).
- **Hand-back:** pausing a staff member, or removing them from a property, returns their open jobs there to OPEN (system actor) and tells the owner.
- Every transition runs under a row lock, bumps `version`, appends history and audits against the property.

## Rent refund (online rent only)

```
(owner or admin asks) --> PENDING --gateway pays out--> PROCESSED
                             |--gateway down: stays PENDING, hourly retry (same idempotency key)
                             +--48 h without success--> FAILED (admins told; the payment can be refunded again)
```

- Only an `ONLINE` payment is refunded, by the property's owner or by an admin (each through its own route). A refund is limited to what the payment took, less what was already refunded and what is still pending; creation runs under the invoice lock and the payment lock, so two refunds at once cannot exceed it.
- While `PENDING` the money still counts as paid and as spoken for. On `PROCESSED` (one atomic flip): the payment's `refunded_paise` grows, the invoice owes the money again (`paid` shrinks and the status moves back to PART PAID or DUE; a cancelled invoice is left alone), and the ledger reverses the original split in proportion (owner share and platform commission both return to the guest account). The tenant and the owner are told.
- Offline payments (cash, UPI, bank) are never refunded: the owner **reverses** the mistaken entry instead.

## PDF receipts

A receipt link is a five-minute HMAC-signed token for one payment, handed out to the tenant, the property's owner or an admin (`.../receipt-link`, audited). `GET /receipts/{token}` is public on purpose: the token is the credential, so a phone can pass it to its PDF viewer. A forged, expired or reversed-payment link is a plain 404. The PDF is generated from the data when opened (so it shows later refunds) by a small dependency-free writer; the rupee sign is written as "Rs".

## Notice and move-out (phase 14)

```
ACTIVE --notice (tenant or owner; move-out day >= today + notice days)--> NOTICE --withdraw (only by who gave it)--> ACTIVE
ACTIVE|NOTICE --owner records move-out (any day up to today)--> ENDED        NOTICE --sweep, the day after the move-out day--> ENDED
```

- Giving notice sets `end_date`; billing stops there. Unpaid invoices for periods that start after it are cancelled (`Stay ending (notice given)`), and are brought back if the notice is withdrawn. The final month's invoice is recalculated to the move-out day (`rent.invoice.prorate`, tenant notified) when it is unpaid, has no open online order and still has a single rent line; withdrawing the notice restores the full month. Paid, part-paid or hand-edited invoices are left for the owner to credit by hand.
- Ending a stay (by the owner or the hourly sweep) frees the bed, cancels later unpaid invoices (`Stay ended`), stamps `moved_out_at`, notifies both sides and, if a deposit was held, drafts the settlement with unpaid rent pre-filled (never more than the deposit).

## Deposit settlement (phase 14)

```
DRAFT --owner sends--> PROPOSED --tenant accepts, or 7 days of silence--> AGREED --payout--> COMPLETED
   ^   <--owner takes back--+          \--tenant disputes--> DISPUTED --owner revises and resends--> PROPOSED
   +------------------------------------------------------------\--admin resolves--> AGREED
```

- Only the owner sees a DRAFT. Deductions are itemised (unpaid rent linked to an invoice, damage, cleaning, utilities, other) with optional evidence photos, and can never exceed the deposit; the refund is exactly what is left.
- AGREED with nothing to refund completes at once. A deposit paid **online** is refunded through the gateway the moment it is agreed (stable idempotency key; a gateway outage leaves it AGREED and the hourly job retries; after 48 hours admins are told once). A cash/UPI/bank deposit waits for the owner to record how they paid the refund.
- Completing it, under the stay lock: each unpaid-rent deduction becomes a rent payment by `DEPOSIT` on its invoice, and for an online deposit the ledger moves the held money to the owner and back to the tenant. If rent changed after the proposal (an invoice was paid or cancelled), accepting is refused until the owner updates it.
