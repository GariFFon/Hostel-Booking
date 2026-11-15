-- Phase 11: tenancy applications and tenancies for long-term (HOSTEL/PG) properties, plus per-property tenancy terms.

-- CreateEnum
CREATE TYPE "TenancyApplicationStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TenancyStatus" AS ENUM ('INVITED', 'PENDING_MOVE_IN', 'ACTIVE', 'NOTICE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RentPayMethod" AS ENUM ('CASH', 'UPI', 'BANK', 'ONLINE');

-- AlterTable
ALTER TABLE "hostels" ADD COLUMN     "deposit_months" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "notice_days" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "rent_due_day" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "rent_grace_days" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "tenancy_applications" (
    "id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "status" "TenancyApplicationStatus" NOT NULL DEFAULT 'REQUESTED',
    "move_in_date" DATE NOT NULL,
    "tenure_months" INTEGER,
    "gender" TEXT,
    "occupation" TEXT,
    "message" TEXT,
    "emergency_contact_name" TEXT NOT NULL,
    "emergency_contact_phone" TEXT NOT NULL,
    "decision_note" TEXT,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenancy_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenancies" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "hostel_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "tenant_id" UUID,
    "application_id" UUID,
    "status" "TenancyStatus" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "rent_paise" INTEGER NOT NULL,
    "deposit_paise" INTEGER NOT NULL,
    "due_day" INTEGER NOT NULL,
    "grace_days" INTEGER NOT NULL,
    "notice_days" INTEGER NOT NULL,
    "deposit_received_at" TIMESTAMP(3),
    "deposit_method" "RentPayMethod",
    "deposit_reference" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "invite_email" TEXT,
    "invite_token_hash" TEXT,
    "invite_expires_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenancies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenancy_applications_hostel_id_status_created_at_idx" ON "tenancy_applications"("hostel_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "tenancy_applications_applicant_id_created_at_idx" ON "tenancy_applications"("applicant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenancies_code_key" ON "tenancies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tenancies_application_id_key" ON "tenancies"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenancies_invite_token_hash_key" ON "tenancies"("invite_token_hash");

-- CreateIndex
CREATE INDEX "tenancies_hostel_id_status_idx" ON "tenancies"("hostel_id", "status");

-- CreateIndex
CREATE INDEX "tenancies_tenant_id_status_idx" ON "tenancies"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "tenancy_applications" ADD CONSTRAINT "tenancy_applications_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy_applications" ADD CONSTRAINT "tenancy_applications_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy_applications" ADD CONSTRAINT "tenancy_applications_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "room_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "tenancy_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Hand-written guarantees (Prisma cannot express these) ──

-- Per-property terms stay sane.
ALTER TABLE "hostels"
  ADD CONSTRAINT "hostels_deposit_months_range" CHECK ("deposit_months" BETWEEN 0 AND 12),
  ADD CONSTRAINT "hostels_notice_days_range" CHECK ("notice_days" BETWEEN 0 AND 180),
  ADD CONSTRAINT "hostels_rent_due_day_range" CHECK ("rent_due_day" BETWEEN 1 AND 28),
  ADD CONSTRAINT "hostels_rent_grace_days_range" CHECK ("rent_grace_days" BETWEEN 0 AND 30);

-- One open request per person and property.
CREATE UNIQUE INDEX "tenancy_applications_open_key" ON "tenancy_applications" ("applicant_id", "hostel_id") WHERE "status" = 'REQUESTED';

ALTER TABLE "tenancy_applications"
  ADD CONSTRAINT "tenancy_applications_tenure_range" CHECK ("tenure_months" IS NULL OR "tenure_months" BETWEEN 1 AND 60);

-- A unit holds at most one live tenancy, and a person lives in at most one place at a time.
CREATE UNIQUE INDEX "tenancies_unit_live_key" ON "tenancies" ("unit_id") WHERE "status" IN ('INVITED', 'PENDING_MOVE_IN', 'ACTIVE', 'NOTICE');
CREATE UNIQUE INDEX "tenancies_tenant_live_key" ON "tenancies" ("tenant_id") WHERE "tenant_id" IS NOT NULL AND "status" IN ('INVITED', 'PENDING_MOVE_IN', 'ACTIVE', 'NOTICE');

ALTER TABLE "tenancies"
  ADD CONSTRAINT "tenancies_rent_positive" CHECK ("rent_paise" > 0),
  ADD CONSTRAINT "tenancies_deposit_not_negative" CHECK ("deposit_paise" >= 0),
  ADD CONSTRAINT "tenancies_due_day_range" CHECK ("due_day" BETWEEN 1 AND 28),
  ADD CONSTRAINT "tenancies_grace_days_range" CHECK ("grace_days" BETWEEN 0 AND 30),
  ADD CONSTRAINT "tenancies_notice_days_range" CHECK ("notice_days" BETWEEN 0 AND 180),
  ADD CONSTRAINT "tenancies_has_tenant_or_invite" CHECK ("tenant_id" IS NOT NULL OR "invite_email" IS NOT NULL),
  ADD CONSTRAINT "tenancies_end_after_start" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
