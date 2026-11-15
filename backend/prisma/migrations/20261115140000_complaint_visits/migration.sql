-- Complaint visits: when the tenant is available, and the visit slot staff booked inside it.
ALTER TABLE "complaints"
  ADD COLUMN "available_from" TIMESTAMP(3),
  ADD COLUMN "available_to" TIMESTAMP(3),
  ADD COLUMN "allow_entry_if_away" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "visit_start" TIMESTAMP(3),
  ADD COLUMN "visit_end" TIMESTAMP(3),
  ADD COLUMN "visit_missed_notified_at" TIMESTAMP(3);

-- Both ends or neither, and a window/visit always has a positive length.
ALTER TABLE "complaints"
  ADD CONSTRAINT "complaints_availability_shape" CHECK (("available_from" IS NULL) = ("available_to" IS NULL) AND ("available_from" IS NULL OR "available_to" > "available_from")),
  ADD CONSTRAINT "complaints_visit_shape" CHECK (("visit_start" IS NULL) = ("visit_end" IS NULL) AND ("visit_start" IS NULL OR "visit_end" > "visit_start"));
