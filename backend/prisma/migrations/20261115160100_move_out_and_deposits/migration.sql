-- Move-out: notice and moved-out stamps on the tenancy.
ALTER TABLE "tenancies"
  ADD COLUMN "notice_given_at" TIMESTAMP(3),
  ADD COLUMN "notice_by" TEXT,
  ADD COLUMN "notice_reason" TEXT,
  ADD COLUMN "moved_out_at" TIMESTAMP(3);
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_notice_by_valid" CHECK ("notice_by" IS NULL OR "notice_by" IN ('TENANT', 'OWNER'));

-- The online payment pipeline also carries the security deposit: an order pays EITHER an invoice OR a tenancy's deposit.
ALTER TABLE "rent_orders" ALTER COLUMN "invoice_id" DROP NOT NULL;
ALTER TABLE "rent_orders" ADD COLUMN "tenancy_id" UUID;
ALTER TABLE "rent_orders" ADD CONSTRAINT "rent_orders_tenancy_id_fkey" FOREIGN KEY ("tenancy_id") REFERENCES "tenancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rent_orders" ADD CONSTRAINT "rent_orders_one_target" CHECK (("invoice_id" IS NULL) <> ("tenancy_id" IS NULL));
CREATE INDEX "rent_orders_tenancy_id_status_idx" ON "rent_orders"("tenancy_id", "status");
CREATE UNIQUE INDEX "rent_orders_one_open_deposit" ON "rent_orders"("tenancy_id") WHERE "tenancy_id" IS NOT NULL AND "status" IN ('CREATED', 'PENDING');

-- Deposit money on the ledger.
ALTER TABLE "ledger_entries" ADD COLUMN "tenancy_id" UUID;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenancy_id_fkey" FOREIGN KEY ("tenancy_id") REFERENCES "tenancies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ledger_entries_tenancy_id_idx" ON "ledger_entries"("tenancy_id");

-- Deposit settlement.
CREATE TYPE "DepositSettlementStatus" AS ENUM ('DRAFT', 'PROPOSED', 'DISPUTED', 'AGREED', 'COMPLETED');
CREATE TYPE "DeductionType" AS ENUM ('UNPAID_RENT', 'DAMAGE', 'CLEANING', 'UTILITIES', 'OTHER');

CREATE TABLE "deposit_settlements" (
    "id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "status" "DepositSettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "deposit_paise" INTEGER NOT NULL,
    "deductions_paise" INTEGER NOT NULL DEFAULT 0,
    "refund_paise" INTEGER NOT NULL,
    "note" TEXT,
    "proposed_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "dispute_note" TEXT,
    "agreed_at" TIMESTAMP(3),
    "auto_agreed" BOOLEAN NOT NULL DEFAULT false,
    "resolved_by_admin_id" UUID,
    "completed_at" TIMESTAMP(3),
    "payout_method" "RentPayMethod",
    "payout_reference" TEXT,
    "refund_idempotency_key" TEXT,
    "provider_refund_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposit_settlements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deposit_deductions" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "type" "DeductionType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "invoice_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_deductions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deposit_proofs" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_proofs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deposit_settlements_tenancy_id_key" ON "deposit_settlements"("tenancy_id");
CREATE UNIQUE INDEX "deposit_settlements_refund_idempotency_key_key" ON "deposit_settlements"("refund_idempotency_key");
CREATE INDEX "deposit_settlements_hostel_id_status_idx" ON "deposit_settlements"("hostel_id", "status");
CREATE INDEX "deposit_settlements_tenant_id_status_idx" ON "deposit_settlements"("tenant_id", "status");
CREATE INDEX "deposit_settlements_status_proposed_at_idx" ON "deposit_settlements"("status", "proposed_at");
CREATE INDEX "deposit_deductions_settlement_id_idx" ON "deposit_deductions"("settlement_id");
CREATE UNIQUE INDEX "deposit_proofs_public_id_key" ON "deposit_proofs"("public_id");
CREATE INDEX "deposit_proofs_settlement_id_idx" ON "deposit_proofs"("settlement_id");

ALTER TABLE "deposit_settlements" ADD CONSTRAINT "deposit_settlements_tenancy_id_fkey" FOREIGN KEY ("tenancy_id") REFERENCES "tenancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deposit_deductions" ADD CONSTRAINT "deposit_deductions_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "deposit_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deposit_proofs" ADD CONSTRAINT "deposit_proofs_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "deposit_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Money rules: nothing negative; deductions never exceed the deposit; the refund is exactly what is left; a completed settlement says how it was paid.
ALTER TABLE "deposit_settlements"
  ADD CONSTRAINT "deposit_settlements_amounts" CHECK ("deposit_paise" >= 0 AND "deductions_paise" >= 0 AND "deductions_paise" <= "deposit_paise" AND "refund_paise" = "deposit_paise" - "deductions_paise"),
  ADD CONSTRAINT "deposit_settlements_dispute_has_note" CHECK ("status" <> 'DISPUTED' OR "dispute_note" IS NOT NULL);
ALTER TABLE "deposit_deductions" ADD CONSTRAINT "deposit_deductions_amount_positive" CHECK ("amount_paise" > 0);

-- The owner-scoped audit viewer filters on the property id every property-scoped audit row carries.
CREATE INDEX "audit_logs_hostel_id_idx" ON "audit_logs" ((("metadata" ->> 'hostelId')), "id" DESC);
