# Data model (ERD)

Source of truth: `backend/prisma/schema.prisma` plus hand-written SQL in `prisma/migrations/*_db_extras`.
Money = integer paise. Stay dates = `date` in the hostel's timezone. Ids = UUIDv7.

```mermaid
erDiagram
  users ||--o{ user_roles : has
  users ||--o| profiles : has
  users ||--o| owner_profiles : "owners only"
  owner_profiles ||--o{ kyc_documents : uploads
  users ||--o{ refresh_tokens : sessions
  users ||--o{ hostels : owns
  hostels ||--o{ room_types : offers
  hostels ||--o{ media : has
  hostels }o--o{ amenities : hostel_amenities
  room_types ||--o{ price_rules : priced_by
  room_types ||--o{ inventory_nights : "one row per night"
  room_types ||--o{ blocked_dates : blocks
  users ||--o{ bookings : books
  hostels ||--o{ bookings : receives
  bookings ||--|{ booking_items : contains
  bookings ||--o{ booking_guests : lists
  bookings ||--o{ booking_status_history : "append-only"
  bookings ||--o{ payments : paid_by
  payments ||--o{ payment_attempts : tries
  payments ||--o{ refunds : refunded_by
  bookings ||--o{ ledger_entries : "append-only double entry"
  bookings ||--o| reviews : "one per completed stay"
  users ||--o{ wishlists : saves
  coupons ||--o{ coupon_redemptions : redeemed
  users ||--o{ notifications : receives
  audit_logs
```

## Database-enforced invariants (db_extras migration)
| Guarantee | Mechanism |
|---|---|
| No overbooking | `inventory_nights` CHECK `held_units + booked_units + blocked_units <= total_units`; holds use a conditional `UPDATE ... WHERE held+booked+blocked+n <= total` (`blocked_units` = owner calendar blocks) |
| Booking money adds up | CHECK `total = subtotal + tax + service_fee - discount`, `nights = check_out - check_in` |
| Audit tamper evidence | `audit_logs` BEFORE INSERT trigger computes `prev_hash`/`hash` (sha256 chain, advisory-lock serialised); `audit_verify_chain()` reports broken links |
| Append-only history | Triggers reject UPDATE/DELETE/TRUNCATE on `audit_logs`, `ledger_entries`, `booking_status_history` |
| Data hygiene | emails lower-case, coupon codes upper-case, rating ranges, lat/lng ranges, coupon discount shape |
| Reviews are verified | `reviews` BEFORE INSERT trigger: the booking must exist, be `COMPLETED`, and belong to the same guest and hostel; one review per booking (unique) |
| Coupons are sane | CHECK per-user limit >= 1, usage limit >= 1, max discount > 0, minimum >= 0, `used_count <= usage_limit` |
| Search | GiST `ll_to_earth(lat,lng)` for radius search; trigram GIN on name/city/locality |

Deviation from the original plan: `addresses` is embedded in `hostels` (one address per property).
