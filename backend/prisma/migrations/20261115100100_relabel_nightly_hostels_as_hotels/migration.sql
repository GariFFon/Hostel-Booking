-- Phase 10: HOSTEL and PG are now long-term (tenancy + monthly rent); HOTEL is the short-term nightly type.
-- Every existing HOSTEL row was created under the old model (nightly stays, MONTH pricing was PG-only), so it becomes HOTEL
-- and keeps working unchanged. PG rows stay PG. Existing bookings are untouched.
--
-- Rollback (valid only until a HOTEL is created after this migration):
--   UPDATE "hostels" SET "property_type" = 'HOSTEL' WHERE "property_type" = 'HOTEL';
UPDATE "hostels" SET "property_type" = 'HOTEL' WHERE "property_type" = 'HOSTEL';
