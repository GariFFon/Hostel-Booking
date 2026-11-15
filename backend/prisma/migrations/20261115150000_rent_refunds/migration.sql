-- Refunds of online rent payments.
ALTER TABLE "rent_payments" ADD COLUMN "refunded_paise" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "rent_refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "provider_refund_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "initiated_by_id" UUID NOT NULL,
    "initiated_by_role" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rent_refunds_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ledger_entries" ADD COLUMN "rent_refund_id" UUID;

CREATE UNIQUE INDEX "rent_refunds_idempotency_key_key" ON "rent_refunds"("idempotency_key");
CREATE INDEX "rent_refunds_payment_id_status_idx" ON "rent_refunds"("payment_id", "status");
CREATE INDEX "rent_refunds_status_created_at_idx" ON "rent_refunds"("status", "created_at");
CREATE INDEX "rent_refunds_hostel_id_created_at_idx" ON "rent_refunds"("hostel_id", "created_at");
CREATE INDEX "ledger_entries_rent_refund_id_idx" ON "ledger_entries"("rent_refund_id");

ALTER TABLE "rent_refunds" ADD CONSTRAINT "rent_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "rent_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_rent_refund_id_fkey" FOREIGN KEY ("rent_refund_id") REFERENCES "rent_refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Money rules: a refund is positive; a payment never refunds more than it took, and only online payments are refunded.
ALTER TABLE "rent_refunds" ADD CONSTRAINT "rent_refunds_amount_positive" CHECK ("amount_paise" > 0);
ALTER TABLE "rent_payments"
  ADD CONSTRAINT "rent_payments_refund_range" CHECK ("refunded_paise" >= 0 AND "refunded_paise" <= "amount_paise"),
  ADD CONSTRAINT "rent_payments_refund_online_only" CHECK ("refunded_paise" = 0 OR "method" = 'ONLINE'::"RentPayMethod");
