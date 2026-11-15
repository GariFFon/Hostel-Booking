-- Phase 13: staff (profiles, assignments, invitations) and complaints (with comments, photos and an append-only status history).

-- CreateEnum
CREATE TYPE "StaffTrade" AS ENUM ('ELECTRICIAN', 'PLUMBER', 'CARPENTER', 'CLEANER', 'COOK', 'SECURITY', 'WARDEN', 'NETWORK', 'OTHER');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ComplaintCategory" AS ENUM ('ELECTRICAL', 'PLUMBING', 'CARPENTRY', 'CLEANING', 'FOOD', 'WIFI', 'SECURITY', 'BEHAVIOUR', 'OTHER');

-- CreateEnum
CREATE TYPE "ComplaintPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'REOPENED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CommentRole" AS ENUM ('TENANT', 'OWNER', 'STAFF', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "staff_profiles" (
    "user_id" UUID NOT NULL,
    "trade" "StaffTrade" NOT NULL,
    "owner_id" UUID,
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "staff_assignments" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_invites" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "trade" "StaffTrade" NOT NULL,
    "owner_id" UUID,
    "hostel_ids" UUID[],
    "invited_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_id" UUID,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "hostel_id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "unit_id" UUID,
    "raised_by_id" UUID NOT NULL,
    "category" "ComplaintCategory" NOT NULL,
    "priority" "ComplaintPriority" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_staff_id" UUID,
    "sla_due_at" TIMESTAMP(3) NOT NULL,
    "sla_breach_notified_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "closed_at" TIMESTAMP(3),
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "rating" INTEGER,
    "feedback" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_media" (
    "id" UUID NOT NULL,
    "complaint_id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploaded_by_id" UUID NOT NULL,
    "uploader_role" "CommentRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_comments" (
    "id" UUID NOT NULL,
    "complaint_id" UUID NOT NULL,
    "author_id" UUID,
    "author_role" "CommentRole" NOT NULL,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_status_history" (
    "id" UUID NOT NULL,
    "complaint_id" UUID NOT NULL,
    "from_status" "ComplaintStatus",
    "to_status" "ComplaintStatus" NOT NULL,
    "actor_id" UUID,
    "actor_role" "CommentRole" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_profiles_owner_id_status_idx" ON "staff_profiles"("owner_id", "status");

-- CreateIndex
CREATE INDEX "staff_profiles_trade_status_idx" ON "staff_profiles"("trade", "status");

-- CreateIndex
CREATE INDEX "staff_assignments_hostel_id_active_idx" ON "staff_assignments"("hostel_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "staff_assignments_staff_user_id_hostel_id_key" ON "staff_assignments"("staff_user_id", "hostel_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_invites_token_hash_key" ON "staff_invites"("token_hash");

-- CreateIndex
CREATE INDEX "staff_invites_owner_id_accepted_at_idx" ON "staff_invites"("owner_id", "accepted_at");

-- CreateIndex
CREATE INDEX "staff_invites_email_idx" ON "staff_invites"("email");

-- CreateIndex
CREATE UNIQUE INDEX "complaints_code_key" ON "complaints"("code");

-- CreateIndex
CREATE INDEX "complaints_hostel_id_status_created_at_idx" ON "complaints"("hostel_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "complaints_raised_by_id_created_at_idx" ON "complaints"("raised_by_id", "created_at");

-- CreateIndex
CREATE INDEX "complaints_assigned_staff_id_status_idx" ON "complaints"("assigned_staff_id", "status");

-- CreateIndex
CREATE INDEX "complaints_status_sla_due_at_idx" ON "complaints"("status", "sla_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "complaint_media_public_id_key" ON "complaint_media"("public_id");

-- CreateIndex
CREATE INDEX "complaint_media_complaint_id_idx" ON "complaint_media"("complaint_id");

-- CreateIndex
CREATE INDEX "complaint_comments_complaint_id_created_at_idx" ON "complaint_comments"("complaint_id", "created_at");

-- CreateIndex
CREATE INDEX "complaint_status_history_complaint_id_created_at_idx" ON "complaint_status_history"("complaint_id", "created_at");

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_tenancy_id_fkey" FOREIGN KEY ("tenancy_id") REFERENCES "tenancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_raised_by_id_fkey" FOREIGN KEY ("raised_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_assigned_staff_id_fkey" FOREIGN KEY ("assigned_staff_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_media" ADD CONSTRAINT "complaint_media_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_comments" ADD CONSTRAINT "complaint_comments_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_status_history" ADD CONSTRAINT "complaint_status_history_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written guarantees (Prisma cannot express these) ──

ALTER TABLE "complaints"
  ADD CONSTRAINT "complaints_rating_range" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "complaints_reopen_not_negative" CHECK ("reopen_count" >= 0);

-- The complaints a staff member is currently working on (their queue and the auto-assignment load count).
CREATE INDEX "complaints_assignee_open_idx" ON "complaints" ("assigned_staff_id") WHERE "status" IN ('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED');

-- History is evidence: it can be added to, never edited or removed.
CREATE TRIGGER complaint_status_history_append_only BEFORE UPDATE OR DELETE ON complaint_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
