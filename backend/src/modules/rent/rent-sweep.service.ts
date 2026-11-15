import { prisma } from '@/infra/db/prisma';
import { parseDate, toDateString, todayIn } from '@/core/dates';
import { recordAudit } from '@/modules/audit/audit.service';
import { fmtDate, fmtRupees } from '@/modules/bookings/booking-core';
import { DUE_SOON_DAYS, OVERDUE_REMIND_DAYS, balanceOf } from './rent.rules';
import { issueDueInvoices, recalculate } from './rent-invoicing';
import { liveOpenOrder, lockInvoice } from './rent.service';
import { notifyRent, runEffects, type Effect } from './rent-notify';

const SYSTEM = { actorId: null, actorRole: 'SYSTEM' } as const;
const BATCH = 200;
const OPEN = ['DUE', 'PARTIALLY_PAID'] as const;
/** The platform is India-only (see rent.service): batch filters use IST; each message uses the property's own dates. */
const PLATFORM_TZ = 'Asia/Kolkata';

/**
 * Hourly rent housekeeping, safe to run any number of times:
 *  1. issue invoices that are due to be issued (and any that were missed),
 *  2. add the late fee, once, to invoices that went overdue,
 *  3. remind about rent due soon, and about rent overdue (at most weekly).
 */
export async function sweepRent(now = new Date()) {
  const today = todayIn(PLATFORM_TZ, now);
  const result = { issued: 0, lateFees: 0, dueSoon: 0, overdue: 0 };

  // 1. invoices
  const tenancies = await prisma.tenancy.findMany({ where: { status: { in: ['ACTIVE', 'NOTICE'] }, tenantId: { not: null }, activatedAt: { not: null } }, select: { id: true }, orderBy: { id: 'asc' } });
  for (const { id } of tenancies) {
    const effects: Effect[] = [];
    await prisma.$transaction(async (tx) => {
      const r = await issueDueInvoices(tx, id, now);
      result.issued += r.invoices.length;
      effects.push(...r.effects);
    });
    await runEffects(effects);
  }

  // 2. late fees
  const lateCandidates = await prisma.rentInvoice.findMany({
    where: { status: { in: [...OPEN] }, lateFeeAppliedAt: null, overdueAfter: { lt: parseDate(today) }, tenancy: { lateFeePaise: { gt: 0 } } },
    select: { id: true }, take: BATCH, orderBy: { overdueAfter: 'asc' },
  });
  for (const { id } of lateCandidates) {
    await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, id);
      const inv = await tx.rentInvoice.findUnique({ where: { id }, include: { tenancy: { select: { lateFeePaise: true } } } });
      if (!inv || inv.lateFeeAppliedAt || (inv.status !== 'DUE' && inv.status !== 'PARTIALLY_PAID') || inv.tenancy.lateFeePaise <= 0) return;
      if (await liveOpenOrder(tx, id, now)) return; // changing the amount mid-payment would break it: try again next run
      await tx.rentInvoiceLine.create({ data: { invoiceId: id, type: 'LATE_FEE', description: 'Late payment fee', amountPaise: inv.tenancy.lateFeePaise } });
      await tx.rentInvoice.update({ where: { id }, data: { lateFeeAppliedAt: now } });
      const after = await recalculate(tx, id);
      await recordAudit({ action: 'rent.late_fee.apply', entityType: 'rent_invoice', entityId: id, before: { totalPaise: inv.totalPaise }, after: { totalPaise: after.totalPaise, lateFeePaise: inv.tenancy.lateFeePaise }, metadata: { hostelId: inv.hostelId, tenancyId: inv.tenancyId, number: inv.number }, ...SYSTEM }, tx);
      result.lateFees++;
    });
  }

  // 3. reminders
  const withParties = { hostel: { select: { name: true, ownerId: true, owner: { select: { email: true } } } }, tenant: { select: { id: true, email: true } } } as const;
  const soon = await prisma.rentInvoice.findMany({
    where: { status: { in: [...OPEN] }, dueSoonNotifiedAt: null, dueDate: { gte: parseDate(today), lte: parseDate(addDaysStr(today, DUE_SOON_DAYS)) } },
    include: withParties, take: BATCH, orderBy: { dueDate: 'asc' },
  });
  for (const inv of soon) {
    if (balanceOf(inv) <= 0) continue;
    const effects: Effect[] = [];
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.rentInvoice.updateMany({ where: { id: inv.id, dueSoonNotifiedAt: null }, data: { dueSoonNotifiedAt: now } }); // claim it: a parallel run cannot double-send
      if (claimed.count === 0) return;
      effects.push(...(await notifyRent(tx, 'due_soon', { property: inv.hostel.name, hostelId: inv.hostelId, tenancyId: inv.tenancyId, invoiceId: inv.id, number: inv.number, amount: fmtRupees(balanceOf(inv)), due: fmtDate(toDateString(inv.dueDate)), audience: 'TENANT', to: { userId: inv.tenant.id, email: inv.tenant.email } })));
      result.dueSoon++;
    });
    await runEffects(effects);
  }

  const remindBefore = new Date(now.getTime() - OVERDUE_REMIND_DAYS * 86_400_000);
  const late = await prisma.rentInvoice.findMany({
    where: { status: { in: [...OPEN] }, overdueAfter: { lt: parseDate(today) }, OR: [{ overdueNotifiedAt: null }, { overdueNotifiedAt: { lt: remindBefore } }] },
    include: withParties, take: BATCH, orderBy: { overdueAfter: 'asc' },
  });
  for (const inv of late) {
    if (balanceOf(inv) <= 0) continue;
    const effects: Effect[] = [];
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.rentInvoice.updateMany({ where: { id: inv.id, OR: [{ overdueNotifiedAt: null }, { overdueNotifiedAt: { lt: remindBefore } }] }, data: { overdueNotifiedAt: now } });
      if (claimed.count === 0) return;
      const base = { property: inv.hostel.name, hostelId: inv.hostelId, tenancyId: inv.tenancyId, invoiceId: inv.id, number: inv.number, amount: fmtRupees(balanceOf(inv)), due: fmtDate(toDateString(inv.dueDate)) };
      effects.push(...(await notifyRent(tx, 'overdue', { ...base, audience: 'TENANT', to: { userId: inv.tenant.id, email: inv.tenant.email } })));
      effects.push(...(await notifyRent(tx, 'overdue', { ...base, audience: 'OWNER', to: { userId: inv.hostel.ownerId, email: inv.hostel.owner.email } })));
      result.overdue++;
    });
    await runEffects(effects);
  }
  return result;
}

const addDaysStr = (d: string, n: number) => toDateString(new Date(parseDate(d).getTime() + n * 86_400_000));
