import { z } from 'zod';
import { isDateString } from '@/core/dates';
import { paginationSchema } from '@/core/http/pagination';
import { DEMO_INSTRUMENTS } from '@/infra/payments/demo.provider';

const date = z.string().refine(isDateString, 'Use a date like 2027-01-15');
const ts = z.iso.datetime();
const reason = z.string().trim().min(3, 'Give a short reason').max(500);

export const invoiceStatusSchema = z.enum(['DUE', 'PARTIALLY_PAID', 'PAID', 'VOID']);
const payMethod = z.enum(['CASH', 'UPI', 'BANK']);

// ── requests ──
export const listInvoicesQuerySchema = paginationSchema.extend({ status: invoiceStatusSchema.optional(), tenancyId: z.uuid().optional() });
export const ownerListInvoicesQuerySchema = listInvoicesQuerySchema.extend({
  hostelId: z.uuid().optional(),
  /** `true` = only invoices past their due date plus grace that still owe money. */
  overdue: z.enum(['true', 'false']).optional(),
  /** Rent period, e.g. 2027-04. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2027-04').optional(),
});

export const recordPaymentSchema = z.strictObject({
  amountPaise: z.number().int().min(100, 'Minimum is ₹1').max(100_000_000),
  method: payMethod,
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(300).optional(),
  /** The day the money was received. Defaults to today. */
  receivedOn: date.optional(),
});

export const addLineSchema = z.strictObject({
  type: z.enum(['ELECTRICITY', 'MAINTENANCE', 'ADJUSTMENT', 'CREDIT']),
  description: z.string().trim().min(2, 'Describe the charge').max(120),
  /** Always positive: a CREDIT is subtracted automatically. */
  amountPaise: z.number().int().min(1).max(100_000_000),
});
export const voidInvoiceSchema = z.strictObject({ reason });
export const reversePaymentSchema = z.strictObject({ reason });
export const demoCheckoutRentSchema = z.object({ instrument: z.enum(DEMO_INSTRUMENTS), method: z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET']).default('UPI') });
export const refundPaymentSchema = z.strictObject({ amountPaise: z.number().int().positive().max(100_000_000), reason: z.string().trim().min(3, 'Give a reason').max(300) });
export const receiptLinkDtoSchema = z.strictObject({ url: z.string(), expiresAt: z.iso.datetime() });

export const rentRollQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), hostelId: z.uuid().optional() });

// ── responses ──
const person = z.strictObject({ id: z.uuid(), name: z.string().nullable(), email: z.string(), phone: z.string().nullable() });

export const invoiceDtoSchema = z.strictObject({
  id: z.uuid(), number: z.string(), status: invoiceStatusSchema,
  hostel: z.strictObject({ id: z.uuid(), name: z.string(), city: z.string() }),
  tenancy: z.strictObject({ id: z.uuid(), code: z.string(), unitLabel: z.string() }),
  tenant: person,
  periodStart: date, periodEnd: date, dueDate: date,
  lines: z.array(z.strictObject({ id: z.uuid(), type: z.enum(['RENT', 'ELECTRICITY', 'MAINTENANCE', 'LATE_FEE', 'ADJUSTMENT', 'CREDIT']), description: z.string(), amountPaise: z.number().int() })),
  subtotalPaise: z.number().int(), taxPaise: z.number().int(), gstRateBps: z.number().int(), totalPaise: z.number().int(), paidPaise: z.number().int(), balancePaise: z.number().int(),
  overdue: z.strictObject({ isOverdue: z.boolean(), days: z.number().int() }),
  payments: z.array(z.strictObject({
    id: z.uuid(), receiptNo: z.string(), amountPaise: z.number().int(), method: z.enum(['CASH', 'UPI', 'BANK', 'ONLINE', 'DEPOSIT']), reference: z.string().nullable(), receivedOn: date,
    reversed: z.boolean(), reverseReason: z.string().nullable(), createdAt: ts, canReverse: z.boolean(),
    /** Online payments only: money already returned, what can still be returned, and whether this caller may refund it. */
    refundedPaise: z.number().int(), refundablePaise: z.number().int(), canRefund: z.boolean(),
    refunds: z.array(z.strictObject({ id: z.uuid(), amountPaise: z.number().int(), status: z.enum(['PENDING', 'PROCESSED', 'FAILED']), reason: z.string(), byRole: z.string(), createdAt: ts, processedAt: ts.nullable() })),
  })),
  /** An online payment that is still open: new payments, charges and voiding wait until it settles or goes stale. */
  openOrder: z.strictObject({ id: z.uuid(), status: z.enum(['CREATED', 'PENDING']), amountPaise: z.number().int() }).nullable(),
  issuedAt: ts, paidAt: ts.nullable(), voidReason: z.string().nullable(), version: z.number().int(),
  actions: z.array(z.enum(['pay', 'record_payment', 'add_line', 'void'])),
});

export const rentOrderDtoSchema = z.strictObject({
  id: z.uuid(), kind: z.enum(['RENT', 'DEPOSIT']), invoiceId: z.uuid().nullable(), tenancyId: z.uuid().nullable(), provider: z.string(), amountPaise: z.number().int(), currency: z.string(),
  status: z.enum(['CREATED', 'PENDING', 'CAPTURED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED']),
  method: z.string().nullable(), failureCode: z.string().nullable(), failureReason: z.string().nullable(), capturedAt: ts.nullable(),
  attempts: z.array(z.strictObject({ id: z.uuid(), status: z.enum(['INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED']), instrument: z.string(), method: z.string().nullable(), createdAt: ts })),
  checkout: z.strictObject({ type: z.literal('demo'), instruments: z.array(z.enum(DEMO_INSTRUMENTS)) }).nullable(),
});

const rollTotals = z.strictObject({
  invoices: z.number().int(), invoicedPaise: z.number().int(), collectedPaise: z.number().int(), collectedOnlinePaise: z.number().int(), collectedOfflinePaise: z.number().int(),
  outstandingPaise: z.number().int(), overdueCount: z.number().int(), overduePaise: z.number().int(),
});
export const rentRollDtoSchema = z.strictObject({
  month: z.string(), activeTenants: z.number().int(), totals: rollTotals,
  byHostel: z.array(rollTotals.extend({ hostelId: z.uuid(), name: z.string() })),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type AddLineInput = z.infer<typeof addLineSchema>;
export type RentRollTotals = z.infer<typeof rollTotals>;
