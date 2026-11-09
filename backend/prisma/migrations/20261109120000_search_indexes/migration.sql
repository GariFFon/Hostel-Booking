-- Equality (city filter) and prefix (autocomplete) lookups on published listings.
-- text_pattern_ops makes the btree usable for LIKE 'abc%' regardless of database collation.
CREATE INDEX hostels_city_lower_idx ON hostels (lower(city) text_pattern_ops)
  WHERE status = 'APPROVED' AND deleted_at IS NULL;
