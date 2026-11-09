-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_REPLIED';

-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "edited_at" TIMESTAMP(3),
ADD COLUMN     "moderated_at" TIMESTAMP(3),
ADD COLUMN     "moderated_by_id" UUID,
ADD COLUMN     "moderation_reason" TEXT;

-- CreateIndex
CREATE INDEX "reviews_status_created_at_idx" ON "reviews"("status", "created_at");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- ───────────── Hand-written invariants (not expressible in schema.prisma) ─────────────

-- A review can only exist for a COMPLETED booking, written by that booking's guest, for that booking's hostel.
-- The service checks this too; the trigger makes it impossible to bypass (admin scripts, future code paths).
CREATE FUNCTION reviews_check_booking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b RECORD;
BEGIN
  SELECT hostel_id, guest_id, status INTO b FROM bookings WHERE id = NEW.booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'review must reference an existing booking';
  END IF;
  IF b.hostel_id <> NEW.hostel_id OR b.guest_id <> NEW.guest_id THEN
    RAISE EXCEPTION 'review hostel/guest must match the booking';
  END IF;
  IF b.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'only a completed stay can be reviewed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviews_booking_guard BEFORE INSERT ON reviews FOR EACH ROW EXECUTE FUNCTION reviews_check_booking();

-- Coupon limits must be positive (a perUserLimit of 0 or a usageLimit of 0 would make the code unusable but "active").
ALTER TABLE coupons
  ADD CONSTRAINT coupons_limits_positive CHECK (per_user_limit >= 1 AND (usage_limit IS NULL OR usage_limit >= 1)),
  ADD CONSTRAINT coupons_max_discount_positive CHECK (max_discount_paise IS NULL OR max_discount_paise > 0),
  ADD CONSTRAINT coupons_min_booking_nonneg CHECK (min_booking_paise >= 0);
