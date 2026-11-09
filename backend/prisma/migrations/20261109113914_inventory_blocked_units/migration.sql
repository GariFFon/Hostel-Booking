-- AlterTable
ALTER TABLE "inventory_nights" ADD COLUMN     "blocked_units" INTEGER NOT NULL DEFAULT 0;

-- Blocked units must count toward capacity so a booking can never take a unit the owner removed from sale.
ALTER TABLE inventory_nights DROP CONSTRAINT inventory_nonneg;
ALTER TABLE inventory_nights DROP CONSTRAINT inventory_capacity;
ALTER TABLE inventory_nights
  ADD CONSTRAINT inventory_nonneg CHECK (held_units >= 0 AND booked_units >= 0 AND blocked_units >= 0 AND total_units >= 0),
  ADD CONSTRAINT inventory_capacity CHECK (held_units + booked_units + blocked_units <= total_units);
