-- restrict_violation (23001) is reported by Prisma as a foreign-key error and hides the message.
-- Use the default raise_exception code so callers see "<table> is append-only: <OP> is not allowed".
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END $$;
