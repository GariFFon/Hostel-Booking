import { randomUUID } from 'node:crypto';
import { Errors } from '@/core/errors/app-error';
import type { Actor } from '@/core/context/request-context';
import { requireRole } from '@/core/auth/rbac';
import { logger } from '@/core/logger/logger';
import { prisma } from '@/infra/db/prisma';
import { getPaymentProvider } from '@/infra/payments/provider';
import { recordAudit } from '@/modules/audit/audit.service';
import { fmtRupees } from '@/modules/bookings/booking-core';
import { notifyAdmins } from '@/modules/notifications/notifications.service';
import { invoiceInclude, refundableOf, toInvoiceDto } from './rent.mapper';
import { lockInvoice } from './rent.service';
import { notifyRent, runEffects, type Effect } from './rent-notify';

const GIVE_UP_AFTER_MS = 48 * 3600_000;

/**
 * Refunds of ONLINE rent payments, by the owner of the property or by support (admin). The tenant is paid back through the gateway;
 * the invoice owes that money again; the ledger reverses the original split (owner share and commission) in proportion.
 * Offline payments are never refunded here: the owner reverses a mistaken record instead.
 */
export const rentRefundsService = {
  /** Creates the refund (PENDING) under the invoice lock, then tries to pay it out at once. The gateway call is retried by the hourly job. */
  async create(actor: Actor, paymentId: string, input: { amountPaise: number; reason: string }, as: 'OWNER' | 'ADMIN') {
    requireRole(actor, as); // each endpoint demands its own role: an owner cannot use the admin route, nor the reverse
    const isAdmin = as === 'ADMIN';
    const refundId = await prisma.$transaction(async (tx) => {
      const found = await tx.rentPayment.findFirst({ where: { id: paymentId, ...(isAdmin ? {} : { invoice: { hostel: { ownerId: actor.id } } }) }, select: { invoiceId: true } });
      if (!found) throw Errors.notFound('Payment'); // someone else's payment looks exactly like a missing one
      await lockInvoice(tx, found.invoiceId);
      await tx.$queryRaw`SELECT id FROM rent_payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
      const p = await tx.rentPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { refunds: true, order: { select: { providerPaymentId: true } } } });
      if (p.method !== 'ONLINE') throw Errors.conflict('Only online payments are refunded. For cash, UPI or bank money you recorded, reverse the entry instead.');
      if (!p.order?.providerPaymentId) throw Errors.conflict('This payment cannot be refunded through the gateway');
      const refundable = refundableOf(p);
      if (input.amountPaise > refundable) throw Errors.conflict(refundable === 0 ? 'This payment has already been fully refunded' : `You can refund at most ${fmtRupees(refundable)} of this payment`);
      const created = await tx.rentRefund.create({
        data: { paymentId, invoiceId: p.invoiceId, hostelId: p.hostelId, tenantId: p.tenantId, amountPaise: input.amountPaise, reason: input.reason, idempotencyKey: `rentrefund_${randomUUID()}`, initiatedById: actor.id, initiatedByRole: isAdmin ? 'ADMIN' : 'OWNER' },
      });
      await recordAudit({ action: 'rent.refund.create', entityType: 'rent_invoice', entityId: p.invoiceId, after: { refundId: created.id, receiptNo: p.receiptNo, amountPaise: input.amountPaise, reason: input.reason }, metadata: { hostelId: p.hostelId, tenancyId: p.tenancyId, paymentId } }, tx);
      return created.id;
    });
    await rentRefundsService.process(refundId); // best effort: if the gateway is down it stays PENDING and the hourly job retries it
    const refund = await prisma.rentRefund.findUniqueOrThrow({ where: { id: refundId }, select: { invoiceId: true } });
    const inv = await prisma.rentInvoice.findUniqueOrThrow({ where: { id: refund.invoiceId }, include: invoiceInclude });
    return toInvoiceDto(inv, isAdmin ? 'ADMIN' : 'OWNER');
  },

  /** Pays a PENDING refund out. Safe to call any number of times: the gateway call carries the refund's idempotency key and the flip is atomic. */
  async process(refundId: string): Promise<'processed' | 'pending' | 'skipped'> {
    const refund = await prisma.rentRefund.findUnique({ where: { id: refundId }, include: { payment: { include: { order: { select: { providerPaymentId: true } } } } } });
    if (!refund || refund.status !== 'PENDING') return 'skipped';
    const providerPaymentId = refund.payment.order?.providerPaymentId;
    if (!providerPaymentId) {
      logger.error({ refundId }, 'rent refund for a payment without a provider payment id');
      return 'pending';
    }
    let providerRefundId: string;
    try {
      ({ providerRefundId } = await getPaymentProvider().refund({ providerPaymentId, amountPaise: refund.amountPaise, idempotencyKey: refund.idempotencyKey }));
    } catch (e) {
      logger.warn({ refundId, err: (e as Error).message }, 'gateway rent refund failed; will retry');
      return 'pending';
    }

    const effects: Effect[] = [];
    const done = await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, refund.invoiceId);
      const claimed = await tx.rentRefund.updateMany({ where: { id: refundId, status: 'PENDING' }, data: { status: 'PROCESSED', providerRefundId, processedAt: new Date() } });
      if (claimed.count === 0) return false; // someone else settled it
      await tx.$queryRaw`SELECT id FROM rent_payments WHERE id = ${refund.paymentId}::uuid FOR UPDATE`;
      const payment = await tx.rentPayment.findUniqueOrThrow({ where: { id: refund.paymentId } });
      await tx.rentPayment.update({ where: { id: payment.id }, data: { refundedPaise: payment.refundedPaise + refund.amountPaise } });
      const inv = await tx.rentInvoice.findUniqueOrThrow({ where: { id: refund.invoiceId }, include: { hostel: { select: { name: true, ownerId: true, owner: { select: { email: true } } } }, tenant: { select: { id: true, email: true } } } });

      // The invoice owes the money again (a cancelled invoice never counted this payment, so it is left alone).
      if (inv.status !== 'VOID') {
        const paid = Math.max(inv.paidPaise - refund.amountPaise, 0);
        await tx.rentInvoice.update({ where: { id: inv.id }, data: { paidPaise: paid, status: paid >= inv.totalPaise ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'DUE', paidAt: paid >= inv.totalPaise ? inv.paidAt : null, version: { increment: 1 } } });
      }

      // Reverse the original split in proportion: whatever share of this invoice's money went to the platform as commission goes back too.
      const captured = await tx.ledgerEntry.groupBy({ by: ['creditAccount'], where: { rentInvoiceId: inv.id, debitAccount: 'GUEST' }, _sum: { amountPaise: true } });
      const toPlatform = captured.find((c) => c.creditAccount === 'PLATFORM_REVENUE')?._sum.amountPaise ?? 0;
      const toOwner = captured.find((c) => c.creditAccount === 'OWNER_PAYABLE')?._sum.amountPaise ?? 0;
      const commission = toPlatform + toOwner > 0 ? Math.min(Math.round((refund.amountPaise * toPlatform) / (toPlatform + toOwner)), refund.amountPaise) : 0;
      const groupId = randomUUID();
      const entries = [
        { debitAccount: 'OWNER_PAYABLE' as const, creditAccount: 'GUEST' as const, amountPaise: refund.amountPaise - commission, memo: `Rent ${inv.number}: refund (owner share)` },
        { debitAccount: 'PLATFORM_REVENUE' as const, creditAccount: 'GUEST' as const, amountPaise: commission, memo: `Rent ${inv.number}: refund (commission returned)` },
      ].filter((e) => e.amountPaise > 0);
      if (entries.length) await tx.ledgerEntry.createMany({ data: entries.map((e) => ({ ...e, groupId, rentInvoiceId: inv.id, rentRefundId: refundId })) });

      await recordAudit({ action: 'rent.refund.processed', entityType: 'rent_invoice', entityId: inv.id, actorRole: 'SYSTEM', actorId: null, after: { refundId, receiptNo: payment.receiptNo, amountPaise: refund.amountPaise, providerRefundId, commissionReturnedPaise: commission }, metadata: { hostelId: inv.hostelId, tenancyId: inv.tenancyId, paymentId: payment.id } }, tx);
      const ctx = { property: inv.hostel.name, hostelId: inv.hostelId, tenancyId: inv.tenancyId, invoiceId: inv.id, number: inv.number, amount: fmtRupees(refund.amountPaise), reason: refund.reason };
      effects.push(...(await notifyRent(tx, 'refunded', { ...ctx, audience: 'TENANT', to: { userId: inv.tenant.id, email: inv.tenant.email } })));
      effects.push(...(await notifyRent(tx, 'refunded', { ...ctx, audience: 'OWNER', to: { userId: inv.hostel.ownerId, email: inv.hostel.owner.email } })));
      return true;
    });
    if (!done) return 'skipped';
    await runEffects(effects);
    return 'processed';
  },

  /** Hourly: anything still PENDING is attempted again; a refund stuck for 48 h is escalated to admins. */
  async retryPending(now = new Date()): Promise<{ processed: number; stuck: number }> {
    const pending = await prisma.rentRefund.findMany({ where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - 20_000) } }, orderBy: { createdAt: 'asc' }, take: 50 });
    let processed = 0, stuck = 0;
    for (const r of pending) {
      const result = await rentRefundsService.process(r.id);
      if (result === 'processed') processed++;
      else if (result === 'pending' && now.getTime() - r.createdAt.getTime() > GIVE_UP_AFTER_MS) {
        let escalated = false;
        await prisma.$transaction(async (tx) => {
          const flipped = await tx.rentRefund.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'FAILED' } });
          if (flipped.count === 0) return;
          escalated = true;
          await recordAudit({ action: 'rent.refund.failed', entityType: 'rent_invoice', entityId: r.invoiceId, outcome: 'FAILURE', actorRole: 'SYSTEM', actorId: null, after: { refundId: r.id }, metadata: { hostelId: r.hostelId } }, tx);
          await notifyAdmins({ type: 'SYSTEM', title: 'Rent refund needs manual attention', body: `Rent refund ${r.id} (${fmtRupees(r.amountPaise)}) could not be paid out after 48 hours.`, data: { rentRefundId: r.id } }, tx);
        });
        if (escalated) stuck++;
      }
    }
    return { processed, stuck };
  },
};
