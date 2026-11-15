-- Phase 12: rent invoices, payments (online and recorded), gateway orders, and per-property GST / late-fee terms.

-- CreateEnum
CREATE TYPE "RentInvoiceStatus" AS ENUM ('DUE', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "RentLineType" AS ENUM ('RENT', 'ELECTRICITY', 'MAINTENANCE', 'LATE_FEE', 'ADJUSTMENT', 'CREDIT');

-- AlterTable
ALTER TABLE "hostels" ADD COLUMN     "rent_gst_bps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rent_late_fee_paise" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "rent_invoice_id" UUID;

-- AlterTable
ALTER TABLE "tenancies" ADD COLUMN     "gst_rate_bps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "late_fee_paise" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "rent_invoices" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "overdue_after" DATE NOT NULL,
    "status" "RentInvoiceStatus" NOT NULL DEFAULT 'DUE',
    "subtotal_paise" INTEGER NOT NULL,
    "tax_paise" INTEGER NOT NULL DEFAULT 0,
    "total_paise" INTEGER NOT NULL,
    "paid_paise" INTEGER NOT NULL DEFAULT 0,
    "gst_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "late_fee_applied_at" TIMESTAMP(3),
    "due_soon_notified_at" TIMESTAMP(3),
    "overdue_notified_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rent_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "type" "RentLineType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rent_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_payments" (
    "id" UUID NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "invoice_id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "method" "RentPayMethod" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "received_on" DATE NOT NULL,
    "rent_order_id" UUID,
    "recorded_by_id" UUID,
    "reversed_at" TIMESTAMP(3),
    "reversed_by_id" UUID,
    "reverse_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rent_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_orders" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "amount_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "method" TEXT,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "captured_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rent_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_order_attempts" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'INITIATED',
    "instrument" TEXT NOT NULL,
    "method" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rent_order_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rent_invoices_number_key" ON "rent_invoices"("number");

-- CreateIndex
CREATE INDEX "rent_invoices_hostel_id_status_due_date_idx" ON "rent_invoices"("hostel_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "rent_invoices_hostel_id_status_overdue_after_idx" ON "rent_invoices"("hostel_id", "status", "overdue_after");

CREATE INDEX "rent_invoices_tenant_id_status_idx" ON "rent_invoices"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rent_invoices_tenancy_id_period_start_key" ON "rent_invoices"("tenancy_id", "period_start");

-- CreateIndex
CREATE INDEX "rent_invoice_lines_invoice_id_idx" ON "rent_invoice_lines"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "rent_payments_receipt_no_key" ON "rent_payments"("receipt_no");

-- CreateIndex
CREATE UNIQUE INDEX "rent_payments_rent_order_id_key" ON "rent_payments"("rent_order_id");

-- CreateIndex
CREATE INDEX "rent_payments_invoice_id_idx" ON "rent_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "rent_payments_hostel_id_created_at_idx" ON "rent_payments"("hostel_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "rent_orders_provider_order_id_key" ON "rent_orders"("provider_order_id");

-- CreateIndex
CREATE INDEX "rent_orders_invoice_id_status_idx" ON "rent_orders"("invoice_id", "status");

-- CreateIndex
CREATE INDEX "rent_order_attempts_order_id_status_idx" ON "rent_order_attempts"("order_id", "status");

-- CreateIndex
CREATE INDEX "ledger_entries_rent_invoice_id_idx" ON "ledger_entries"("rent_invoice_id");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_rent_invoice_id_fkey" FOREIGN KEY ("rent_invoice_id") REFERENCES "rent_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_invoices" ADD CONSTRAINT "rent_invoices_tenancy_id_fkey" FOREIGN KEY ("tenancy_id") REFERENCES "tenancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_invoices" ADD CONSTRAINT "rent_invoices_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_invoices" ADD CONSTRAINT "rent_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_invoice_lines" ADD CONSTRAINT "rent_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "rent_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_payments" ADD CONSTRAINT "rent_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "rent_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_payments" ADD CONSTRAINT "rent_payments_rent_order_id_fkey" FOREIGN KEY ("rent_order_id") REFERENCES "rent_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_orders" ADD CONSTRAINT "rent_orders_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "rent_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_order_attempts" ADD CONSTRAINT "rent_order_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "rent_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written guarantees (Prisma cannot express these) ──

ALTER TABLE "hostels"
  ADD CONSTRAINT "hostels_rent_gst_range" CHECK ("rent_gst_bps" BETWEEN 0 AND 2800),
  ADD CONSTRAINT "hostels_rent_late_fee_not_negative" CHECK ("rent_late_fee_paise" >= 0);

ALTER TABLE "tenancies"
  ADD CONSTRAINT "tenancies_gst_range" CHECK ("gst_rate_bps" BETWEEN 0 AND 2800),
  ADD CONSTRAINT "tenancies_late_fee_not_negative" CHECK ("late_fee_paise" >= 0);

-- An invoice's money adds up, its period makes sense, and nothing is negative.
ALTER TABLE "rent_invoices"
  ADD CONSTRAINT "rent_invoices_total_consistent" CHECK ("total_paise" = "subtotal_paise" + "tax_paise"),
  ADD CONSTRAINT "rent_invoices_total_not_negative" CHECK ("total_paise" >= 0 AND "subtotal_paise" >= 0 AND "tax_paise" >= 0),
  ADD CONSTRAINT "rent_invoices_paid_not_negative" CHECK ("paid_paise" >= 0),
  ADD CONSTRAINT "rent_invoices_period_order" CHECK ("period_end" >= "period_start"),
  ADD CONSTRAINT "rent_invoices_gst_range" CHECK ("gst_rate_bps" BETWEEN 0 AND 2800),
  ADD CONSTRAINT "rent_invoices_void_unpaid" CHECK ("status" <> 'VOID' OR "paid_paise" = 0);

-- Only a credit may be negative.
ALTER TABLE "rent_invoice_lines"
  ADD CONSTRAINT "rent_invoice_lines_sign" CHECK (("type" = 'CREDIT' AND "amount_paise" < 0) OR ("type" <> 'CREDIT' AND "amount_paise" > 0));

ALTER TABLE "rent_payments" ADD CONSTRAINT "rent_payments_amount_positive" CHECK ("amount_paise" > 0);
ALTER TABLE "rent_orders" ADD CONSTRAINT "rent_orders_amount_positive" CHECK ("amount_paise" > 0);

-- One open gateway order per invoice at a time: a second tap resumes it instead of piling up orders.
CREATE UNIQUE INDEX "rent_orders_open_key" ON "rent_orders" ("invoice_id") WHERE "status" IN ('CREATED', 'PENDING');
