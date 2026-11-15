import { Prisma, type RentInvoiceStatus } from '@/generated/prisma/client';
import { prisma } from '@/infra/db/prisma';
import { Errors } from '@/core/errors/app-error';
import type { Actor } from '@/core/context/request-context';
import { requireRole } from '@/core/auth/rbac';
import { addDays, parseDate, todayIn } from '@/core/dates';
import { cursorArgs, toPage } from '@/core/http/pagination';
import { recordAudit } from '@/modules/audit/audit.service';
import { fmtRupees } from '@/modules/bookings/booking-core';
import { invoiceInclude, toInvoiceDto, type InvoiceFull, type Viewer } from './rent.mapper';
import { ORDER_STALE_MS, balanceOf, newReceiptNumber } from './rent.rules';
import { recalculate } from './rent-invoicing';
import { notifyRent, runEffects, type Effect } from './rent-notify';
import type { AddLineInput, RecordPaymentInput, RentRollTotals } from './rent.schema';

type Tx = Prisma.TransactionClient;
type ListQ = { limit: number; cursor?: string; status?: RentInvoiceStatus; tenancyId?: string; hostelId?: string; overdue?: 'true' | 'false'; month?: string };

/** The platform is India-only, so "today" for list filters is IST; each invoice's own overdue flag uses its property's timezone. */
const PLATFORM_TZ = 'Asia/Kolkata';
const OPEN_STATUSES: RentInvoiceStatus[] = ['DUE', 'PARTIALLY_PAID'];

export const lockInvoice = (tx: Tx, id: string) => tx.$queryRawUnsafe(`SELECT id FROM rent_invoices WHERE id = $1::uuid FOR UPDATE`, id);

/**
 * Closes online orders that were abandoned (an open order older than the stale limit with no attempt still in flight), so one
 * forgotten payment screen can never freeze an invoice. Returns the order that is still genuinely open, if any.
 */
export async function liveOpenOrder(tx: Tx, invoiceId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - ORDER_STALE_MS);
  await tx.rentOrderAttempt.updateMany({
    where: { order: { invoiceId, status: { in: ['CREATED', 'PENDING'] } }, status: { in: ['INITIATED', 'PENDING'] }, createdAt: { lt: cutoff } },
    data: { status: 'FAILED', errorCode: 'TIMEOUT', errorMessage: 'The bank did not respond' },
  });
  await tx.rentOrder.updateMany({
    where: { invoiceId, status: { in: ['CREATED', 'PENDING'] }, createdAt: { lt: cutoff }, attempts: { none: { status: { in: ['INITIATED', 'PENDING'] } } } },
    data: { status: 'FAILED', failureCode: 'EXPIRED', failureReason: 'The payment was not completed in time', version: { increment: 1 } },
  });
  return tx.rentOrder.findFirst({ where: { invoiceId, status: { in: ['CREATED', 'PENDING'] } } });
}

async function load(db: Tx | typeof prisma, actor: Actor, id: string, viewer: Viewer): Promise<InvoiceFull> {
  let where: Prisma.RentInvoiceWhereInput;
  if (viewer === 'TENANT') where = { id, tenantId: actor.id };
  else if (viewer === 'OWNER') { requireRole(actor, 'OWNER'); where = { id, hostel: { ownerId: actor.id } }; }
  else { requireRole(actor, 'ADMIN'); where = { id }; }
  const i = await db.rentInvoice.findFirst({ where, include: invoiceInclude });
  if (!i) throw Errors.notFound('Invoice'); // someone else's invoice looks exactly like a missing one
  return i;
}

const reload = (tx: Tx, id: string) => tx.rentInvoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude });
const meta = (i: { hostelId: string; tenancyId: string; number: string }) => ({ hostelId: i.hostelId, tenancyId: i.tenancyId, number: i.number });

function listWhere(base: Prisma.RentInvoiceWhereInput, q: ListQ): Prisma.RentInvoiceWhereInput {
  const where: Prisma.RentInvoiceWhereInput = { ...base };
  if (q.status) where.status = q.status;
  if (q.tenancyId) where.tenancyId = q.tenancyId;
  if (q.hostelId) where.hostelId = q.hostelId;
  if (q.overdue === 'true') {
    where.status = { in: OPEN_STATUSES };
    where.overdueAfter = { lt: parseDate(todayIn(PLATFORM_TZ)) };
  }
  if (q.month) {
    const start = `${q.month}-01`;
    where.periodStart = { gte: parseDate(start), lt: parseDate(addDays(`${q.month}-28`, 4).slice(0, 7) + '-01') };
  }
  return where;
}

async function page(where: Prisma.RentInvoiceWhereInput, q: ListQ, viewer: Viewer) {
  const rows = await prisma.rentInvoice.findMany({ where, include: invoiceInclude, orderBy: [{ dueDate: 'desc' }, { id: 'desc' }], ...cursorArgs(q) });
  const { items, nextCursor } = toPage(rows, q.limit);
  const now = new Date();
  return { items: items.map((i) => toInvoiceDto(i, viewer, now)), nextCursor };
}

export const rentService = {
  // ── tenant ──
  listMine: (actor: Actor, q: ListQ) => page(listWhere({ tenantId: actor.id }, { ...q, hostelId: undefined, overdue: undefined, month: undefined }), q, 'TENANT'),
  getMine: async (actor: Actor, id: string) => toInvoiceDto(await load(prisma, actor, id, 'TENANT'), 'TENANT'),

  // ── owner ──
  ownerList(actor: Actor, q: ListQ) {
    requireRole(actor, 'OWNER');
    return page(listWhere({ hostel: { ownerId: actor.id } }, q), q, 'OWNER');
  },
  ownerGet: async (actor: Actor, id: string) => toInvoiceDto(await load(prisma, actor, id, 'OWNER'), 'OWNER'),

  adminGet: async (actor: Actor, id: string) => toInvoiceDto(await load(prisma, actor, id, 'ADMIN'), 'ADMIN'),

  adminList(actor: Actor, q: ListQ) {
    requireRole(actor, 'ADMIN');
    return page(listWhere({}, q), q, 'ADMIN');
  },

  /** The owner records money they received outside the app (cash, UPI, bank). */
  async recordPayment(actor: Actor, id: string, input: RecordPaymentInput, now = new Date()) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, id);
      const inv = await load(tx, actor, id, 'OWNER');
      if (inv.status !== 'DUE' && inv.status !== 'PARTIALLY_PAID') throw Errors.conflict(inv.status === 'PAID' ? 'This invoice is already paid' : 'This invoice was cancelled');
      if (await liveOpenOrder(tx, id, now)) throw Errors.conflict('The tenant is paying this invoice online right now. Try again in a few minutes.');
      const balance = balanceOf(inv);
      if (input.amountPaise > balance) throw Errors.validation([{ path: 'amountPaise', message: `That is more than the ${fmtRupees(balance)} still owed` }]);
      const today = todayIn(inv.hostel.timezone, now);
      const receivedOn = input.receivedOn ?? today;
      if (receivedOn > today || receivedOn < addDays(today, -365)) throw Errors.validation([{ path: 'receivedOn', message: 'The date must be within the last year and not in the future' }]);

      const payment = await tx.rentPayment.create({
        data: {
          receiptNo: newReceiptNumber(receivedOn), invoiceId: id, tenancyId: inv.tenancyId, hostelId: inv.hostelId, tenantId: inv.tenantId, amountPaise: input.amountPaise,
          method: input.method, reference: input.reference, note: input.note, receivedOn: parseDate(receivedOn), recordedById: actor.id,
        },
      });
      const paid = inv.paidPaise + input.amountPaise;
      const settled = paid >= inv.totalPaise;
      await tx.rentInvoice.update({ where: { id }, data: { paidPaise: paid, status: settled ? 'PAID' : 'PARTIALLY_PAID', paidAt: settled ? now : null, version: { increment: 1 } } });
      await recordAudit({ action: 'rent.payment.record', entityType: 'rent_invoice', entityId: id, before: { paidPaise: inv.paidPaise }, after: { paidPaise: paid, receiptNo: payment.receiptNo, method: input.method, amountPaise: input.amountPaise }, metadata: meta(inv) }, tx);
      effects.push(...(await notifyRent(tx, 'paid', {
        property: inv.hostel.name, hostelId: inv.hostelId, tenancyId: inv.tenancyId, invoiceId: id, number: inv.number, amount: fmtRupees(input.amountPaise), audience: 'TENANT', to: { userId: inv.tenant.id, email: inv.tenant.email },
      })));
      return toInvoiceDto(await reload(tx, id), 'OWNER', now);
    });
    await runEffects(effects);
    return dto;
  },

  /** Extra charges (electricity, maintenance, adjustments) or a credit, while the invoice is still open. */
  async addLine(actor: Actor, id: string, input: AddLineInput, now = new Date()) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, id);
      const inv = await load(tx, actor, id, 'OWNER');
      if (inv.status !== 'DUE' && inv.status !== 'PARTIALLY_PAID') throw Errors.conflict('Only an open invoice can be changed. Put the charge on the next invoice instead.');
      if (await liveOpenOrder(tx, id, now)) throw Errors.conflict('The tenant is paying this invoice online right now. Try again in a few minutes.');
      const amountPaise = input.type === 'CREDIT' ? -input.amountPaise : input.amountPaise;
      await tx.rentInvoiceLine.create({ data: { invoiceId: id, type: input.type, description: input.description, amountPaise, createdById: actor.id } });
      const after = await recalculate(tx, id);
      await recordAudit({ action: 'rent.line.add', entityType: 'rent_invoice', entityId: id, before: { totalPaise: inv.totalPaise }, after: { totalPaise: after.totalPaise, type: input.type, description: input.description, amountPaise }, metadata: meta(inv) }, tx);
      effects.push(...(await notifyRent(tx, 'invoice_updated', {
        property: inv.hostel.name, hostelId: inv.hostelId, tenancyId: inv.tenancyId, invoiceId: id, number: inv.number, amount: fmtRupees(after.totalPaise), reason: input.description, audience: 'TENANT', to: { userId: inv.tenant.id, email: inv.tenant.email },
      })));
      return toInvoiceDto(await reload(tx, id), 'OWNER', now);
    });
    await runEffects(effects);
    return dto;
  },

  /** Cancels an invoice nobody has paid. Rent for that period is not re-billed. */
  async voidInvoice(actor: Actor, id: string, reason: string, now = new Date()) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, id);
      const inv = await load(tx, actor, id, 'OWNER');
      if (inv.status === 'VOID') throw Errors.conflict('This invoice is already cancelled');
      if (inv.paidPaise > 0) throw Errors.conflict('This invoice has payments on it. Reverse them first, or add a credit instead.');
      if (await liveOpenOrder(tx, id, now)) throw Errors.conflict('The tenant is paying this invoice online right now. Try again in a few minutes.');
      await tx.rentInvoice.update({ where: { id }, data: { status: 'VOID', voidedAt: now, voidReason: reason, version: { increment: 1 } } });
      await recordAudit({ action: 'rent.invoice.void', entityType: 'rent_invoice', entityId: id, before: { status: inv.status }, after: { status: 'VOID', reason }, metadata: meta(inv) }, tx);
      effects.push(...(await notifyRent(tx, 'invoice_voided', { property: inv.hostel.name, hostelId: inv.hostelId, tenancyId: inv.tenancyId, invoiceId: id, number: inv.number, reason, audience: 'TENANT', to: { userId: inv.tenant.id, email: inv.tenant.email } })));
      return toInvoiceDto(await reload(tx, id), 'OWNER', now);
    });
    await runEffects(effects);
    return dto;
  },

  /** Undoes a payment the owner recorded by mistake. Online payments cannot be reversed here (that is a refund). */
  async reversePayment(actor: Actor, paymentId: string, reason: string, now = new Date()) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      const found = await tx.rentPayment.findFirst({ where: { id: paymentId, invoice: { hostel: { ownerId: actor.id } } }, select: { invoiceId: true } });
      if (!found) throw Errors.notFound('Payment');
      await lockInvoice(tx, found.invoiceId);
      const p = await tx.rentPayment.findUniqueOrThrow({ where: { id: paymentId } });
      if (p.method === 'DEPOSIT') throw Errors.conflict('This amount was settled from the tenant\'s deposit when they moved out, so it cannot be reversed here.');
      if (p.method === 'ONLINE') throw Errors.conflict('An online payment cannot be reversed here. Refunds for rent are handled by support.');
      if (p.reversedAt) throw Errors.conflict('This payment was already reversed');
      const inv = await load(tx, actor, p.invoiceId, 'OWNER');
      if (inv.status === 'VOID') throw Errors.conflict('This invoice was cancelled');
      if (await liveOpenOrder(tx, inv.id, now)) throw Errors.conflict('The tenant is paying this invoice online right now. Try again in a few minutes.');
      await tx.rentPayment.update({ where: { id: paymentId }, data: { reversedAt: now, reversedById: actor.id, reverseReason: reason } });
      const paid = Math.max(inv.paidPaise - p.amountPaise, 0);
      await tx.rentInvoice.update({ where: { id: inv.id }, data: { paidPaise: paid, status: paid >= inv.totalPaise ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'DUE', paidAt: paid >= inv.totalPaise ? inv.paidAt : null, version: { increment: 1 } } });
      await recordAudit({ action: 'rent.payment.reverse', entityType: 'rent_invoice', entityId: inv.id, before: { paidPaise: inv.paidPaise }, after: { paidPaise: paid, receiptNo: p.receiptNo, reason }, metadata: meta(inv) }, tx);
      effects.push(...(await notifyRent(tx, 'payment_reversed', {
        property: inv.hostel.name, hostelId: inv.hostelId, tenancyId: inv.tenancyId, invoiceId: inv.id, number: inv.number, amount: fmtRupees(p.amountPaise), reason, audience: 'TENANT', to: { userId: inv.tenant.id, email: inv.tenant.email },
      })));
      return toInvoiceDto(await reload(tx, inv.id), 'OWNER', now);
    });
    await runEffects(effects);
    return dto;
  },

  /** What is billed, collected and still owed for a month, per property. */
  async rentRoll(actor: Actor, q: { month?: string; hostelId?: string }) {
    requireRole(actor, 'OWNER');
    return rollFor(actor.id, q);
  },

  /** The same roll-up across every property on the platform (for support and oversight). */
  async adminRentRoll(actor: Actor, q: { month?: string; hostelId?: string }) {
    requireRole(actor, 'ADMIN');
    return rollFor(null, q);
  },
};

async function rollFor(ownerId: string | null, q: { month?: string; hostelId?: string }) {
  {
    const today = todayIn(PLATFORM_TZ);
    const month = q.month ?? today.slice(0, 7);
    const from = `${month}-01`;
    const to = `${addDays(`${month}-28`, 4).slice(0, 7)}-01`; // first day of the next month
    const hostelFilter = q.hostelId ? Prisma.sql`AND i.hostel_id = ${q.hostelId}::uuid` : Prisma.empty;
    const ownerFilter = ownerId ? Prisma.sql`h.owner_id = ${ownerId}::uuid AND ` : Prisma.empty;
    const scope = Prisma.sql`${ownerFilter}i.status <> 'VOID'::"RentInvoiceStatus" AND i.period_start >= ${from}::date AND i.period_start < ${to}::date ${hostelFilter}`;

    const totals = await prisma.$queryRaw<{ hostel_id: string; name: string; invoices: number; invoiced: number; collected: number; outstanding: number; overdue_count: number; overdue: number }[]>(Prisma.sql`
      SELECT i.hostel_id::text AS hostel_id, h.name, count(*)::int AS invoices, COALESCE(sum(i.total_paise), 0)::int AS invoiced, COALESCE(sum(i.paid_paise), 0)::int AS collected,
        COALESCE(sum(CASE WHEN i.status IN ('DUE'::"RentInvoiceStatus", 'PARTIALLY_PAID'::"RentInvoiceStatus") THEN i.total_paise - i.paid_paise ELSE 0 END), 0)::int AS outstanding,
        (count(*) FILTER (WHERE i.status IN ('DUE'::"RentInvoiceStatus", 'PARTIALLY_PAID'::"RentInvoiceStatus") AND i.overdue_after < ${today}::date))::int AS overdue_count,
        COALESCE(sum(CASE WHEN i.status IN ('DUE'::"RentInvoiceStatus", 'PARTIALLY_PAID'::"RentInvoiceStatus") AND i.overdue_after < ${today}::date THEN i.total_paise - i.paid_paise ELSE 0 END), 0)::int AS overdue
      FROM rent_invoices i JOIN hostels h ON h.id = i.hostel_id WHERE ${scope} GROUP BY i.hostel_id, h.name ORDER BY h.name`);
    const byMethod = await prisma.$queryRaw<{ hostel_id: string; online: number; offline: number }[]>(Prisma.sql`
      SELECT i.hostel_id::text AS hostel_id,
        COALESCE(sum(p.amount_paise) FILTER (WHERE p.method = 'ONLINE'::"RentPayMethod"), 0)::int AS online,
        COALESCE(sum(p.amount_paise) FILTER (WHERE p.method <> 'ONLINE'::"RentPayMethod"), 0)::int AS offline
      FROM rent_payments p JOIN rent_invoices i ON i.id = p.invoice_id JOIN hostels h ON h.id = i.hostel_id WHERE ${scope} AND p.reversed_at IS NULL GROUP BY i.hostel_id`);
    const active = await prisma.tenancy.count({ where: { status: { in: ['ACTIVE', 'NOTICE'] }, hostel: { ...(ownerId ? { ownerId } : {}) }, ...(q.hostelId ? { hostelId: q.hostelId } : {}) } });

    const methodOf = new Map(byMethod.map((m) => [m.hostel_id, m]));
    const rows = totals.map((r): RentRollTotals & { hostelId: string; name: string } => ({
      hostelId: r.hostel_id, name: r.name, invoices: r.invoices, invoicedPaise: r.invoiced, collectedPaise: r.collected, collectedOnlinePaise: methodOf.get(r.hostel_id)?.online ?? 0,
      collectedOfflinePaise: methodOf.get(r.hostel_id)?.offline ?? 0, outstandingPaise: r.outstanding, overdueCount: r.overdue_count, overduePaise: r.overdue,
    }));
    const sum = (k: keyof RentRollTotals) => rows.reduce((n, r) => n + r[k], 0);
    return {
      month, activeTenants: active, byHostel: rows,
      totals: { invoices: sum('invoices'), invoicedPaise: sum('invoicedPaise'), collectedPaise: sum('collectedPaise'), collectedOnlinePaise: sum('collectedOnlinePaise'), collectedOfflinePaise: sum('collectedOfflinePaise'), outstandingPaise: sum('outstandingPaise'), overdueCount: sum('overdueCount'), overduePaise: sum('overduePaise') },
    };
  }
}

