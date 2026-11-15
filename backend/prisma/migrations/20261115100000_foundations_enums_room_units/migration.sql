-- Phase 10 (foundations): HOTEL property type, STAFF role, long-term notification types, rent/complaint notification
-- preferences, and RoomUnit (physical beds/rooms for long-term properties). Enum values are added here and only *used* in the
-- next migration, because PostgreSQL cannot use a freshly added enum value in the same transaction.

-- CreateEnum
CREATE TYPE "RoomUnitStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'RETIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TENANCY_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'TENANCY_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'TENANCY_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'TENANCY_INVITED';
ALTER TYPE "NotificationType" ADD VALUE 'TENANCY_STARTED';
ALTER TYPE "NotificationType" ADD VALUE 'TENANCY_NOTICE';
ALTER TYPE "NotificationType" ADD VALUE 'TENANCY_ENDED';
ALTER TYPE "NotificationType" ADD VALUE 'RENT_INVOICE_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE 'RENT_DUE_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'RENT_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'RENT_PAID';
ALTER TYPE "NotificationType" ADD VALUE 'DEPOSIT_SETTLED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLAINT_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLAINT_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLAINT_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLAINT_RESOLVED';
ALTER TYPE "NotificationType" ADD VALUE 'STAFF_INVITED';

-- AlterEnum
ALTER TYPE "PropertyType" ADD VALUE 'HOTEL';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'STAFF';

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "email_rent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "in_app_complaints" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "in_app_rent" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "room_units" (
    "id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "floor" INTEGER,
    "status" "RoomUnitStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "room_units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_units_room_type_id_status_idx" ON "room_units"("room_type_id", "status");

-- AddForeignKey
ALTER TABLE "room_units" ADD CONSTRAINT "room_units_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A label is unique within a room type among live units (case-insensitive); retired/deleted units free the label.
CREATE UNIQUE INDEX "room_units_label_live_key" ON "room_units" ("room_type_id", lower("label")) WHERE "deleted_at" IS NULL;
