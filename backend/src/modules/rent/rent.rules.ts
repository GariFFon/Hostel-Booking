import { randomInt } from 'node:crypto';
import { addDays, diffDays } from '@/core/dates';

/** Pure rules for rent: periods, proration, due dates, tax and "overdue". No database in here, so every edge is unit-testable. */

/** An invoice is issued this many days before it is due (the first one is due the day billing starts, so it is issued at once). */
export const INVOICE_LEAD_DAYS = 7;
/** A "due soon" reminder goes out this many days before the due date. */
export const DUE_SOON_DAYS = 3;
/** An overdue reminder repeats at most this often. */
export const OVERDUE_REMIND_DAYS = 7;
/** An online order untouched for this long is treated as abandoned, so it cannot block the invoice forever. */
export const ORDER_STALE_MS = 30 * 60_000;
/** Never create more than this many invoices for one tenancy in one run (a safety net against runaway catch-up). */
export const MAX_CATCH_UP = 24;

const pad = (n: number) => String(n).padStart(2, '0');

export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export const daysInMonth = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
export const monthEnd = (d: string) => `${d.slice(0, 7)}-${pad(daysInMonth(d))}`;
export const nextMonthStart = (d: string) => addDays(monthEnd(d), 1);
/** The due date of a calendar-month period. Due days run 1-28 so every month has one. */
export const dueDateFor = (periodStart: string, dueDay: number) => `${periodStart.slice(0, 7)}-${pad(Math.min(Math.max(dueDay, 1), 28))}`;

export interface BillingTerms {
  /** The first day rent is billed from: the later of the start date and the move-in day. */
  billingFrom: string;
  rentPaise: number;
  dueDay: number;
  /** Last day of the stay, if known. Billing stops there. */
  endDate: string | null;
}

export interface PeriodPlan {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  /** Rent for this period, prorated by days when it is not a whole calendar month. */
  rentPaise: number;
  prorated: boolean;
}

export const prorate = (rentPaise: number, from: string, to: string) => Math.round((rentPaise * (diffDays(from, to) + 1)) / daysInMonth(from));

/**
 * The next period to bill after `lastPeriodStart` (null = nothing billed yet). Periods are calendar months. The first one is
 * prorated when billing starts mid-month and is due at once; later ones are due on the tenancy's due day.
 */
export function nextPeriod(t: BillingTerms, lastPeriodStart: string | null): PeriodPlan | null {
  const first = lastPeriodStart === null;
  const periodStart = first ? t.billingFrom : nextMonthStart(lastPeriodStart);
  if (t.endDate && periodStart > t.endDate) return null;
  let periodEnd = monthEnd(periodStart);
  if (t.endDate && t.endDate < periodEnd) periodEnd = t.endDate;
  const whole = periodStart === monthStart(periodStart) && periodEnd === monthEnd(periodStart);
  return {
    periodStart,
    periodEnd,
    dueDate: first && !whole ? periodStart : dueDateFor(periodStart, t.dueDay),
    rentPaise: whole ? t.rentPaise : prorate(t.rentPaise, periodStart, periodEnd),
    prorated: !whole,
  };
}

/** Should this period be invoiced yet? */
export const invoiceableOn = (plan: PeriodPlan, today: string, leadDays = INVOICE_LEAD_DAYS) => today >= addDays(plan.dueDate, -leadDays);

export interface LineInput { type: 'RENT' | 'ELECTRICITY' | 'MAINTENANCE' | 'LATE_FEE' | 'ADJUSTMENT' | 'CREDIT'; amountPaise: number }

/** Subtotal, tax and total from lines. GST applies to RENT lines only (a credit or a fee is not rent). */
export function invoiceAmounts(lines: LineInput[], gstBps: number) {
  const subtotalPaise = lines.reduce((n, l) => n + l.amountPaise, 0);
  const rent = lines.filter((l) => l.type === 'RENT').reduce((n, l) => n + l.amountPaise, 0);
  const taxPaise = Math.round((rent * gstBps) / 10_000);
  return { subtotalPaise, taxPaise, totalPaise: subtotalPaise + taxPaise };
}

export const balanceOf = (inv: { totalPaise: number; paidPaise: number }) => Math.max(inv.totalPaise - inv.paidPaise, 0);

/** Overdue = still owing after the due date plus the grace days. Derived, so it is never stale. */
export function overdueDays(inv: { status: string; dueDate: string; totalPaise: number; paidPaise: number }, graceDays: number, today: string): number {
  if (inv.status !== 'DUE' && inv.status !== 'PARTIALLY_PAID') return 0;
  if (balanceOf(inv) <= 0) return 0;
  return Math.max(diffDays(addDays(inv.dueDate, graceDays), today), 0);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const yymm = (d: string) => `${d.slice(2, 4)}${d.slice(5, 7)}`;
export const newInvoiceNumber = (periodStart: string) => `INV-${yymm(periodStart)}-${code()}`;
export const newReceiptNumber = (receivedOn: string) => `RCPT-${yymm(receivedOn)}-${code()}`;

export const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
