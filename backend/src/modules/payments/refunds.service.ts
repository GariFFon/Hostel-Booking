import { Errors } from '@/core/errors/app-error';
import { logger } from '@/core/logger/logger';
import { prisma } from '@/infra/db/prisma';
import { getPaymentProvider } from '@/infra/payments/provider';
import { recordAudit } from '@/modules/audit/audit.service';
import { refundPaidEntries } from '@/modules/bookings/booking-ledger';
import { bookingInclude, runEffects, writeLedger, type Tx } from '@/modules/bookings/booking-core';
import { notifyBooking } from '@/modules/bookings/booking-notify';
import { notifyAdmins } from '@/modules/notifications/notifications.service';

const GIVE_UP_AFTER_MS = 48 * 3600_000;

export const refundsService = {
  /**
   * Creates the refund record inside the caller's transaction. The ledger movement ESCROW -> REFUND_PAYABLE is the caller's
   * job (cancellation settlement differs from a late-payment refund); this only guarantees one refund per idempotency key.
   */
  async create(tx: Tx, input: { paymentId: string; bookingId: string; amountPaise: number; reason: string; idempotencyKey: string; initiatedById?: string | null }) {
    if (input.amountPaise <= 0) throw Errors.validation(null, 'Refund amount must be positive');
    // Under the payment row lock, count refunds still waiting to be paid out as well as those already paid: two refunds created before
    // either is processed (a cancellation and an admin refund) must not together exceed what was captured.
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${input.paymentId}::uuid FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentId } });
    const pending = await tx.refund.aggregate({ where: { paymentId: input.paymentId, status: 'PENDING' }, _sum: { amountPaise: true } });
    if (payment.refundedPaise + (pending._sum.amountPaise ?? 0) + input.amountPaise > payment.amountPaise) throw Errors.conflict('Refund exceeds the amount paid');
    return tx.refund.create({ data: { paymentId: input.paymentId, bookingId: input.bookingId, amountPaise: input.amountPaise, reason: input.reason, idempotencyKey: input.idempotencyKey, initiatedById: input.initiatedById ?? null } });
  },

  /**
   * Pays a PENDING refund out through the gateway. Safe to call any number of times: the gateway call carries the refund's
   * idempotency key and the PENDING -> PROCESSED flip is atomic, so the guest is refunded exactly once.
   */
  async process(refundId: string): Promise<'processed' | 'pending' | 'skipped'> {
    const refund = await prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
    if (!refund || refund.status !== 'PENDING') return 'skipped';
    if (!refund.payment.providerPaymentId) {
      logger.error({ refundId }, 'refund for a payment without a provider payment id');
      return 'pending';
    }

    let providerRefundId: string;
    try {
      ({ providerRefundId } = await getPaymentProvider().refund({ providerPaymentId: refund.payment.providerPaymentId, amountPaise: refund.amountPaise, idempotencyKey: refund.idempotencyKey }));
    } catch (e) {
      logger.warn({ refundId, err: (e as Error).message }, 'gateway refund failed; will retry');
      return 'pending';
    }

    const effects = await prisma.$transaction(async (tx) => {
      // Atomic claim: only one concurrent caller can flip PENDING -> PROCESSED.
      const claimed = await tx.refund.updateMany({ where: { id: refundId, status: 'PENDING' }, data: { status: 'PROCESSED', providerRefundId, processedAt: new Date() } });
      if (claimed.count === 0) return null;
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${refund.paymentId}::uuid FOR UPDATE`;
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
      const refunded = payment.refundedPaise + refund.amountPaise;
      await tx.payment.update({ where: { id: payment.id }, data: { refundedPaise: refunded, status: refunded >= payment.amountPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED', version: { increment: 1 } } });
      await writeLedger(tx, refundPaidEntries(refund.amountPaise), { bookingId: refund.bookingId, paymentId: payment.id, refundId });
      await recordAudit({ action: 'refund.processed', entityType: 'booking', entityId: refund.bookingId, actorRole: 'SYSTEM', actorId: null, after: { refundId, amountPaise: refund.amountPaise, providerRefundId } }, tx);
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: refund.bookingId }, include: bookingInclude });
      return notifyBooking(tx, 'refund_processed', booking, { refundPaise: refund.amountPaise });
    });
    if (!effects) return 'skipped';
    await runEffects(effects);
    return 'processed';
  },

  /** Retry job: anything still PENDING is attempted again; refunds stuck for 48 h are escalated to admins. */
  async retryPending(now = new Date()): Promise<{ processed: number; stuck: number }> {
    const pending = await prisma.refund.findMany({ where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - 20_000) } }, orderBy: { createdAt: 'asc' }, take: 50 });
    let processed = 0, stuck = 0;
    for (const r of pending) {
      const result = await refundsService.process(r.id);
      if (result === 'processed') processed++;
      // Only a refund that is still genuinely unpaid is escalated: 'skipped' means someone else already settled it.
      else if (result === 'pending' && now.getTime() - r.createdAt.getTime() > GIVE_UP_AFTER_MS) {
        let escalated = false;
        await prisma.$transaction(async (tx) => {
          const flipped = await tx.refund.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'FAILED' } });
          if (flipped.count === 0) return; // settled in the meantime: no failure to record
          escalated = true;
          await recordAudit({ action: 'refund.failed', entityType: 'booking', entityId: r.bookingId, outcome: 'FAILURE', actorRole: 'SYSTEM', actorId: null, after: { refundId: r.id } }, tx);
          await notifyAdmins({ type: 'SYSTEM', title: 'Refund needs manual attention', body: `Refund ${r.id} (₹${r.amountPaise / 100}) could not be paid out after 48 hours.`, data: { refundId: r.id, bookingId: r.bookingId } }, tx);
        });
        if (escalated) stuck++;
      }
    }
    return { processed, stuck };
  },
};
