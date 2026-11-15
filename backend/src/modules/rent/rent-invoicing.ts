import type { Prisma, RentInvoice } from '@/generated/prisma/client';
import { Errors } from '@/core/errors/app-error';
import { addDays, parseDate, toDateString, todayIn } from '@/core/dates';
import { recordAudit } from '@/modules/audit/audit.service';
import { fmtDate, fmtRupees } from '@/modules/bookings/booking-core';
import { MAX_CATCH_UP, invoiceAmounts, invoiceableOn, monthEnd, monthStart, newInvoiceNumber, nextPeriod, prorate, ORDER_STALE_MS, type BillingTerms, type PeriodPlan } from './rent.rules';
import { notifyRent, type Effect } from './rent-notify';

type Tx = Prisma.TransactionClient;

const SYSTEM = { actorId: null, actorRole: 'SYSTEM' } as const;
const monthLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const lineText = (plan: PeriodPlan) => plan.prorated
  ? `Rent for ${fmtDate(plan.periodStart)} to ${fmtDate(plan.periodEnd)} (part of ${monthLabel(plan.periodStart)})`
  : `Rent for ${monthLabel(plan.periodStart)}`;

const rentLineText = (periodStart: string, periodEnd: string) =>
  periodStart === monthStart(periodStart) && periodEnd === monthEnd(periodStart) ? `Rent for ${monthLabel(periodStart)}` : `Rent for ${fmtDate(periodStart)} to ${fmtDate(periodEnd)} (part of ${monthLabel(periodStart)})`;

/**
 * Makes the unpaid rent invoices match how long the tenant actually stays. With a last day, an invoice whose month contains it is
 * charged only up to that day (prorated by days, like a first part-month); with `null` (notice withdrawn) any such invoice goes back
 * to its full month. Only an invoice nobody has paid anything on, and that is not being paid online right now, is changed: money
 * already received is never second-guessed (the owner credits that by hand). Safe to repeat: the result depends only on the dates.
 */
export async function fitInvoicesToStay(tx: Tx, tenancyId: string, lastDay: string | null, now: Date, effects: Effect[]) {
  const t = await tx.tenancy.findUniqueOrThrow({ where: { id: tenancyId }, include: { hostel: { select: { id: true, name: true } }, tenant: { select: { id: true, email: true } } } });
  const invoices = await tx.rentInvoice.findMany({ where: { tenancyId, status: 'DUE', paidPaise: 0 }, include: { lines: true }, orderBy: { periodStart: 'asc' } });
  const staleBefore = new Date(now.getTime() - ORDER_STALE_MS);
  let changed = 0;
  for (const inv of invoices) {
    const start = toDateString(inv.periodStart);
    const fullEnd = monthEnd(start);
    const wantEnd = lastDay && lastDay >= start && lastDay < fullEnd ? lastDay : fullEnd;
    const wantRent = wantEnd === fullEnd && start === monthStart(start) ? t.rentPaise : prorate(t.rentPaise, start, wantEnd);
    const rentLines = inv.lines.filter((l) => l.type === 'RENT');
    if (rentLines.length !== 1) continue; // a hand-edited invoice is the owner's to fix
    if (toDateString(inv.periodEnd) === wantEnd && rentLines[0]!.amountPaise === Math.max(wantRent, 1)) continue; // already right
    if (await tx.rentOrder.count({ where: { invoiceId: inv.id, status: { in: ['CREATED', 'PENDING'] }, OR: [{ createdAt: { gte: staleBefore } }, { attempts: { some: { status: { in: ['INITIATED', 'PENDING'] } } } }] } })) continue; // being paid right now
    await lockInvoiceRow(tx, inv.id);
    await tx.rentInvoice.update({ where: { id: inv.id }, data: { periodEnd: parseDate(wantEnd) } });
    await tx.rentInvoiceLine.update({ where: { id: rentLines[0]!.id }, data: { amountPaise: Math.max(wantRent, 1), description: rentLineText(start, wantEnd) } });
    const after = await recalculate(tx, inv.id);
    await recordAudit({ action: 'rent.invoice.prorate', entityType: 'rent_invoice', entityId: inv.id, before: { totalPaise: inv.totalPaise, periodEnd: toDateString(inv.periodEnd) }, after: { totalPaise: after.totalPaise, periodEnd: wantEnd, reason: lastDay ? 'stay ends' : 'notice withdrawn' }, metadata: { hostelId: t.hostelId, tenancyId, number: inv.number } }, tx);
    if (t.tenant) effects.push(...(await notifyRent(tx, 'invoice_updated', { property: t.hostel.name, hostelId: t.hostelId, tenancyId, invoiceId: inv.id, number: inv.number, amount: fmtRupees(after.totalPaise), reason: lastDay ? `The stay ends on ${fmtDate(lastDay)}, so rent is charged only up to that day.` : 'The notice was withdrawn, so the invoice is back to the full month.', audience: 'TENANT', to: { userId: t.tenant.id, email: t.tenant.email } })));
    changed++;
  }
  return changed;
}

const lockInvoiceRow = (tx: Tx, id: string) => tx.$queryRawUnsafe(`SELECT id FROM rent_invoices WHERE id = $1::uuid FOR UPDATE`, id);

/** Row lock: only one run at a time may issue invoices for a tenancy, so periods can never be billed twice. */
export const lockTenancy = (tx: Tx, id: string) => tx.$queryRawUnsafe(`SELECT id FROM tenancies WHERE id = $1::uuid FOR UPDATE`, id);

/**
 * Issues every invoice that is due to be issued for a tenancy (catching up if several are missing) and returns them with the
 * emails to send after commit. Safe to call repeatedly: it continues from the last period already billed, whatever its status.
 * Billing starts on the later of the start date and the day of move-in, so adding a long-time resident never back-bills history.
 */
export async function issueDueInvoices(tx: Tx, tenancyId: string, now: Date, actor?: { id: string; role: string }): Promise<{ invoices: RentInvoice[]; effects: Effect[] }> {
  await lockTenancy(tx, tenancyId);
  const t = await tx.tenancy.findUnique({ where: { id: tenancyId }, include: { hostel: { select: { id: true, name: true, timezone: true } }, tenant: { select: { id: true, email: true } } } });
  const none = { invoices: [], effects: [] };
  if (!t || !t.tenant || !t.activatedAt || (t.status !== 'ACTIVE' && t.status !== 'NOTICE')) return none;

  const today = todayIn(t.hostel.timezone, now);
  const activatedOn = todayIn(t.hostel.timezone, t.activatedAt);
  const startDate = toDateString(t.startDate);
  const terms: BillingTerms = { billingFrom: startDate > activatedOn ? startDate : activatedOn, rentPaise: t.rentPaise, dueDay: t.dueDay, endDate: t.endDate ? toDateString(t.endDate) : null };
  const last = await tx.rentInvoice.findFirst({ where: { tenancyId }, orderBy: { periodStart: 'desc' }, select: { periodStart: true } });
  let lastStart = last ? toDateString(last.periodStart) : null;

  const invoices: RentInvoice[] = [];
  const effects: Effect[] = [];
  for (let i = 0; i < MAX_CATCH_UP; i++) {
    const plan = nextPeriod(terms, lastStart);
    if (!plan || !invoiceableOn(plan, today)) break;
    const rentPaise = Math.max(plan.rentPaise, 1);
    const amounts = invoiceAmounts([{ type: 'RENT', amountPaise: rentPaise }], t.gstRateBps);
    const invoice = await tx.rentInvoice.create({
      data: {
        number: newInvoiceNumber(plan.periodStart), tenancyId, hostelId: t.hostelId, tenantId: t.tenant.id,
        periodStart: parseDate(plan.periodStart), periodEnd: parseDate(plan.periodEnd), dueDate: parseDate(plan.dueDate), overdueAfter: parseDate(addDays(plan.dueDate, t.graceDays)),
        ...amounts, gstRateBps: t.gstRateBps,
        lines: { create: [{ type: 'RENT', description: lineText(plan), amountPaise: rentPaise }] },
      },
    });
    await recordAudit({
      action: 'rent.invoice.issue', entityType: 'rent_invoice', entityId: invoice.id, after: { number: invoice.number, period: [plan.periodStart, plan.periodEnd], totalPaise: invoice.totalPaise, prorated: plan.prorated },
      metadata: { hostelId: t.hostelId, tenancyId }, ...(actor ? { actorId: actor.id, actorRole: actor.role } : SYSTEM),
    }, tx);
    effects.push(...(await notifyRent(tx, 'invoice_issued', {
      property: t.hostel.name, hostelId: t.hostelId, tenancyId, invoiceId: invoice.id, number: invoice.number, amount: fmtRupees(invoice.totalPaise), due: fmtDate(plan.dueDate),
      audience: 'TENANT', to: { userId: t.tenant.id, email: t.tenant.email },
    })));
    invoices.push(invoice);
    lastStart = plan.periodStart;
  }
  return { invoices, effects };
}

/** Rebuilds an invoice's totals from its lines (tax applies to rent lines only) and keeps its status in step with what was paid. */
export async function recalculate(tx: Tx, invoiceId: string) {
  const inv = await tx.rentInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } });
  const amounts = invoiceAmounts(inv.lines, inv.gstRateBps);
  if (amounts.totalPaise < 0) throw Errors.validation([{ path: 'amountPaise', message: 'The credit is larger than the invoice' }]);
  if (amounts.totalPaise < inv.paidPaise && inv.status !== 'PAID') throw Errors.conflict('The credit would be more than what is still owed. Reverse a payment first.');
  // Fully credited (nothing left to pay) counts as settled.
  const settled = inv.paidPaise >= amounts.totalPaise;
  const status = inv.status === 'VOID' ? 'VOID' : settled ? 'PAID' : inv.paidPaise > 0 ? 'PARTIALLY_PAID' : 'DUE';
  return tx.rentInvoice.update({
    where: { id: invoiceId },
    data: { ...amounts, status, paidAt: status === 'PAID' ? (inv.paidAt ?? new Date()) : null, version: { increment: 1 } },
  });
}
