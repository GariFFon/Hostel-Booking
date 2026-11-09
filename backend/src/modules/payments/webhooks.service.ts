import { Prisma } from '@/generated/prisma/client';
import { AppError, Errors } from '@/core/errors/app-error';
import { prisma } from '@/infra/db/prisma';
import { getPaymentProvider } from '@/infra/payments/provider';
import { enqueue } from '@/infra/queue/queue';
import { recordAudit } from '@/modules/audit/audit.service';
import { captureEntries, fullRefundEntries } from '@/modules/bookings/booking-ledger';
import { capturedPayment, failOpenPayments, holdItems, inventoryEffect, lockBooking, runEffects, stayDates, transition, writeLedger, type Effect, type Tx } from '@/modules/bookings/booking-core';
import { notifyBooking } from '@/modules/bookings/booking-notify';
import { confirmHold } from '@/modules/availability/holds';
import { demoWebhookEventSchema, type DemoWebhookEvent } from './payments.schema';
import { refundsService } from './refunds.service';

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored';
const PAID = ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;
const isPaid = (s: string) => (PAID as readonly string[]).includes(s);

/**
 * Entry point for gateway callbacks. Order of defence: verify the signature on the raw bytes -> validate the shape ->
 * record the event id (replays are no-ops) -> apply it under booking then payment row locks. A failure while applying is
 * recorded and surfaced as 5xx so the gateway redelivers.
 */
export async function processDemoWebhook(rawBody: string, signature: string | null, now = new Date()): Promise<WebhookOutcome> {
  if (!getPaymentProvider().verifyWebhook(rawBody, signature, now)) throw Errors.unauthenticated('Invalid webhook signature');

  let event: DemoWebhookEvent;
  try {
    event = demoWebhookEventSchema.parse(JSON.parse(rawBody));
  } catch {
    throw Errors.validation(null, 'Malformed webhook payload');
  }

  let eventRowId: string;
  try {
    eventRowId = (await prisma.webhookEvent.create({ data: { provider: 'demo', eventId: event.id, type: event.type, payload: event as unknown as Prisma.InputJsonValue, signatureValid: true } })).id;
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    const existing = await prisma.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: 'demo', eventId: event.id } } });
    if (existing.status === 'PROCESSED' || existing.status === 'IGNORED') return 'duplicate';
    eventRowId = existing.id; // an earlier delivery crashed mid-way: apply it now
  }

  try {
    return await applyEvent(event, eventRowId, now);
  } catch (e) {
    await prisma.webhookEvent.update({ where: { id: eventRowId }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 500) } }).catch(() => undefined);
    throw e instanceof AppError ? e : new AppError('INTERNAL', 'Could not process the webhook');
  }
}

async function applyEvent(event: DemoWebhookEvent, eventRowId: string, now: Date): Promise<WebhookOutcome> {
  const payment = await prisma.payment.findUnique({ where: { providerOrderId: event.data.orderId }, select: { id: true, bookingId: true, amountPaise: true } });
  const finish = (tx: Tx | typeof prisma, status: 'PROCESSED' | 'IGNORED', error?: string) =>
    tx.webhookEvent.update({ where: { id: eventRowId }, data: { status, processedAt: now, error: error ?? null } });

  if (!payment) {
    await finish(prisma, 'IGNORED', 'unknown order');
    return 'ignored';
  }
  if (event.type === 'payment.captured' && event.data.amountPaise !== payment.amountPaise) {
    await prisma.webhookEvent.update({ where: { id: eventRowId }, data: { status: 'FAILED', error: 'amount mismatch' } });
    await recordAudit({ action: 'payment.amount_mismatch', entityType: 'booking', entityId: payment.bookingId, outcome: 'DENIED', actorRole: 'SYSTEM', actorId: null, metadata: { expected: payment.amountPaise, got: event.data.amountPaise } });
    throw Errors.validation(null, 'Payment amount does not match the order');
  }

  const result = await prisma.$transaction(async (tx) => {
    const booking = await lockBooking(tx, payment.bookingId); // lock order: booking, then payment
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const effects: Effect[] = [];

    if (event.type === 'payment.captured') {
      if (isPaid(p.status)) { await finish(tx, 'IGNORED', 'already captured'); return { outcome: 'ignored' as const, effects }; }
      await tx.payment.update({ where: { id: p.id }, data: { status: 'CAPTURED', providerPaymentId: event.data.paymentId, method: event.data.method ?? p.method, capturedAt: now, failureCode: null, failureReason: null, version: { increment: 1 } } });
      await tx.paymentAttempt.updateMany({ where: { paymentId: p.id, status: { in: ['INITIATED', 'PENDING'] } }, data: { status: 'SUCCEEDED' } });
      await writeLedger(tx, captureEntries(p.amountPaise), { bookingId: booking.id, paymentId: p.id });
      await recordAudit({ action: 'payment.captured', entityType: 'booking', entityId: booking.id, actorRole: 'SYSTEM', actorId: null, after: { paymentId: p.id, amountPaise: p.amountPaise, method: event.data.method ?? null } }, tx);

      const alreadyPaidElsewhere = isPaid(capturedPayment(booking)?.status ?? '') && capturedPayment(booking)!.id !== p.id;
      if (booking.status === 'PENDING_PAYMENT' && !alreadyPaidElsewhere) {
        // Even if the hold deadline just passed, the inventory is still ours until the sweeper releases it: honour the payment.
        const { checkIn, checkOut } = stayDates(booking);
        await confirmHold(tx, holdItems(booking), checkIn, checkOut);
        await failOpenPayments(tx, booking.id, 'CANCELLED', 'The booking was paid with another payment'); // no stale, still-payable orders
        const confirmed = await transition(tx, booking, 'CONFIRMED', { actor: 'SYSTEM', reason: 'Payment captured', data: { confirmedAt: now, holdExpiresAt: null }, metadata: { paymentId: p.id } });
        effects.push(inventoryEffect, ...(await notifyBooking(tx, 'confirmed', confirmed)));
      } else {
        // Money arrived for a booking that cannot use it (expired, cancelled, or already paid): give it straight back.
        const refund = await refundsService.create(tx, { paymentId: p.id, bookingId: booking.id, amountPaise: p.amountPaise, reason: alreadyPaidElsewhere ? 'Duplicate payment' : `Payment received after the booking ${booking.status.toLowerCase().replace(/_/g, ' ')}`, idempotencyKey: `auto:${p.id}` });
        await writeLedger(tx, fullRefundEntries(p.amountPaise), { bookingId: booking.id, paymentId: p.id, refundId: refund.id });
        await recordAudit({ action: 'payment.auto_refund', entityType: 'booking', entityId: booking.id, actorRole: 'SYSTEM', actorId: null, after: { paymentId: p.id, refundId: refund.id, reason: refund.reason } }, tx);
        effects.push(() => enqueue('process-refund', { refundId: refund.id }));
      }
    } else {
      if (p.status !== 'CREATED' && p.status !== 'PENDING') { await finish(tx, 'IGNORED', `payment already ${p.status}`); return { outcome: 'ignored' as const, effects }; } // e.g. a stale "failed" after "captured"
      await tx.payment.update({ where: { id: p.id }, data: { status: 'FAILED', failureCode: event.data.failureCode ?? 'DECLINED', failureReason: event.data.failureReason ?? 'The payment was declined', version: { increment: 1 } } });
      await tx.paymentAttempt.updateMany({ where: { paymentId: p.id, status: { in: ['INITIATED', 'PENDING'] } }, data: { status: 'FAILED', errorCode: event.data.failureCode ?? 'DECLINED', errorMessage: event.data.failureReason ?? 'The payment was declined' } });
      await recordAudit({ action: 'payment.failed', entityType: 'booking', entityId: booking.id, outcome: 'FAILURE', actorRole: 'SYSTEM', actorId: null, after: { paymentId: p.id, code: event.data.failureCode ?? 'DECLINED' } }, tx);
      if (booking.status === 'PENDING_PAYMENT') effects.push(...(await notifyBooking(tx, 'payment_failed', booking, { reason: event.data.failureReason ?? null })));
    }
    await finish(tx, 'PROCESSED');
    return { outcome: 'processed' as const, effects };
  });

  await runEffects(result.effects);
  return result.outcome;
}
