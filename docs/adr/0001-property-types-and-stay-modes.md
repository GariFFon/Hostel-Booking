# ADR 0001: Property types decide the stay mode (hotel = nightly, hostel/PG = long-term)

**Status:** accepted (phase 10)

## Context
The platform started as a nightly-booking marketplace (check-in/check-out, hold timer, per-night inventory), but the target users are students and long-term residents who need tenancies, monthly rent, complaints and staff. A single property type that supports both nightly and monthly stays would need a combined availability engine, because a long-term tenant would have to block nightly beds.

## Decision
- Add a `HOTEL` property type for short-term nightly stays. The existing nightly flow is unchanged and now applies to `HOTEL` only.
- `HOSTEL` and `PG` are long-term: they use tenancies and monthly rent (phase 11+), assigned to physical `room_units`.
- The property type alone decides the stay mode (`stayModeOf`). A property cannot switch between the two once it has rooms or bookings.
- One migration relabels existing `HOSTEL` rows as `HOTEL`, since they were all nightly.

## Consequences
- No combined availability engine: nightly inventory and tenancy occupancy never compete for the same bed.
- Until phase 11 ships, `HOSTEL` and `PG` listings cannot be booked: nightly quotes and bookings are refused on them, and the tenancy flow does not exist yet.
- Existing bookings, payments and the ledger are unaffected.
- A backpacker-style hostel that wants nightly guests must list as `HOTEL`. If that proves wrong, a per-property opt-in to monthly stays can be added later without schema changes to the nightly flow.
