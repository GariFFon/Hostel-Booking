-- Hand-written extras that Prisma's schema language cannot express.
-- Extensions are normally pre-installed in template1 (see docs/runbook.md); IF NOT EXISTS keeps this idempotent.
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────── CHECK constraints (defence in depth; services validate first) ─────────────
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));
ALTER TABLE coupons ADD CONSTRAINT coupons_code_uppercase CHECK (code = upper(code));

ALTER TABLE hostels
  ADD CONSTRAINT hostels_lat_range CHECK (latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT hostels_lng_range CHECK (longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT hostels_rating_range CHECK (avg_rating BETWEEN 0 AND 5),
  ADD CONSTRAINT hostels_min_price_nonneg CHECK (min_price_paise IS NULL OR min_price_paise >= 0);

ALTER TABLE room_types
  ADD CONSTRAINT room_types_units_positive CHECK (total_units > 0),
  ADD CONSTRAINT room_types_price_nonneg CHECK (base_price_paise >= 0),
  ADD CONSTRAINT room_types_occupancy_positive CHECK (max_occupancy_per_unit >= 1),
  ADD CONSTRAINT room_types_stay_range CHECK (min_stay_nights >= 1 AND max_stay_nights >= min_stay_nights);

ALTER TABLE price_rules
  ADD CONSTRAINT price_rules_value_present CHECK (price_paise IS NOT NULL OR adjustment_bps IS NOT NULL),
  ADD CONSTRAINT price_rules_price_nonneg CHECK (price_paise IS NULL OR price_paise >= 0),
  ADD CONSTRAINT price_rules_range_order CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);

ALTER TABLE blocked_dates ADD CONSTRAINT blocked_dates_units_positive CHECK (units_blocked > 0);

-- The no-double-booking invariant: held + booked can never exceed total, per room type per night.
ALTER TABLE inventory_nights
  ADD CONSTRAINT inventory_nonneg CHECK (held_units >= 0 AND booked_units >= 0 AND total_units >= 0),
  ADD CONSTRAINT inventory_capacity CHECK (held_units + booked_units <= total_units);

ALTER TABLE bookings
  ADD CONSTRAINT bookings_dates_order CHECK (check_out > check_in),
  ADD CONSTRAINT bookings_nights_match CHECK (nights = (check_out - check_in)),
  ADD CONSTRAINT bookings_guests_positive CHECK (guests_count > 0),
  ADD CONSTRAINT bookings_amounts_nonneg CHECK (
    subtotal_paise >= 0 AND tax_paise >= 0 AND service_fee_paise >= 0 AND discount_paise >= 0 AND total_paise >= 0),
  ADD CONSTRAINT bookings_total_consistent CHECK (
    total_paise = subtotal_paise + tax_paise + service_fee_paise - discount_paise);

ALTER TABLE booking_items
  ADD CONSTRAINT booking_items_units_positive CHECK (units > 0),
  ADD CONSTRAINT booking_items_total_nonneg CHECK (line_total_paise >= 0);

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount_paise > 0),
  ADD CONSTRAINT payments_refund_bounds CHECK (refunded_paise >= 0 AND refunded_paise <= amount_paise);

ALTER TABLE refunds ADD CONSTRAINT refunds_amount_positive CHECK (amount_paise > 0);

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_amount_positive CHECK (amount_paise > 0),
  ADD CONSTRAINT ledger_distinct_accounts CHECK (debit_account <> credit_account);

ALTER TABLE reviews
  ADD CONSTRAINT reviews_overall_range CHECK (overall BETWEEN 1 AND 5),
  ADD CONSTRAINT reviews_cleanliness_range CHECK (cleanliness IS NULL OR cleanliness BETWEEN 1 AND 5),
  ADD CONSTRAINT reviews_location_range CHECK (location IS NULL OR location BETWEEN 1 AND 5),
  ADD CONSTRAINT reviews_staff_range CHECK (staff IS NULL OR staff BETWEEN 1 AND 5),
  ADD CONSTRAINT reviews_value_range CHECK (value_for_money IS NULL OR value_for_money BETWEEN 1 AND 5);

ALTER TABLE coupons
  ADD CONSTRAINT coupons_discount_shape CHECK (
    (discount_type = 'PERCENT' AND percent_bps BETWEEN 1 AND 10000 AND flat_paise IS NULL) OR
    (discount_type = 'FLAT' AND flat_paise > 0 AND percent_bps IS NULL)),
  ADD CONSTRAINT coupons_validity_order CHECK (valid_to > valid_from),
  ADD CONSTRAINT coupons_used_bounds CHECK (used_count >= 0 AND (usage_limit IS NULL OR used_count <= usage_limit));

-- ───────────── Indexes Prisma cannot declare ─────────────
CREATE INDEX hostels_geo_idx ON hostels USING gist (ll_to_earth(latitude, longitude)) WHERE deleted_at IS NULL;
CREATE INDEX hostels_name_trgm_idx ON hostels USING gin (lower(name) gin_trgm_ops);
CREATE INDEX hostels_city_trgm_idx ON hostels USING gin (lower(city) gin_trgm_ops);
CREATE INDEX hostels_locality_trgm_idx ON hostels USING gin (lower(locality) gin_trgm_ops);
CREATE INDEX bookings_open_holds_idx ON bookings (hold_expires_at) WHERE status IN ('HOLD', 'PENDING_PAYMENT');
CREATE INDEX bookings_pending_approval_idx ON bookings (approval_deadline) WHERE status = 'PENDING_APPROVAL';

-- ───────────── Append-only enforcement ─────────────
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER booking_status_history_append_only BEFORE UPDATE OR DELETE ON booking_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ───────────── Tamper-evident audit hash chain (computed in the DB, not the app) ─────────────
-- hash = sha256(prev_hash | id | actor | action | entity | before | after | outcome | request | created_at)
CREATE FUNCTION audit_compute_hash(prev text, r audit_logs) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(digest(concat_ws('|',
    coalesce(prev, 'GENESIS'), r.id::text, coalesce(r.actor_id::text, ''), coalesce(r.actor_role, ''),
    r.action, r.entity_type, coalesce(r.entity_id, ''), coalesce(r.before::text, ''), coalesce(r.after::text, ''),
    r.outcome::text, coalesce(r.request_id, ''),
    to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'sha256'), 'hex')
$$;

CREATE FUNCTION audit_chain_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev text;
BEGIN
  -- Serialise chain growth; the lock is released at commit so the chain order == id order.
  PERFORM pg_advisory_xact_lock(hashtext('audit_logs_chain'));
  NEW.id := nextval(pg_get_serial_sequence('audit_logs', 'id'));
  SELECT hash INTO prev FROM audit_logs ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.hash := audit_compute_hash(prev, NEW);
  RETURN NEW;
END $$;

CREATE TRIGGER audit_logs_chain BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_chain_before_insert();

-- Returns one row per broken link; an empty result means the chain is intact.
CREATE FUNCTION audit_verify_chain(from_id bigint DEFAULT 0)
RETURNS TABLE (bad_id bigint, reason text) LANGUAGE sql STABLE AS $$
  WITH linked AS (
    SELECT a, lag(a.hash) OVER (ORDER BY a.id) AS expected_prev FROM audit_logs a
  )
  SELECT (a).id,
    CASE WHEN (a).prev_hash IS DISTINCT FROM expected_prev THEN 'prev_hash mismatch (row removed or reordered)'
         WHEN (a).hash IS DISTINCT FROM audit_compute_hash((a).prev_hash, (a)) THEN 'hash mismatch (row altered)'
    END
  FROM linked
  WHERE (a).id >= from_id AND (
    (a).prev_hash IS DISTINCT FROM expected_prev OR (a).hash IS DISTINCT FROM audit_compute_hash((a).prev_hash, (a)))
  ORDER BY (a).id
$$;
