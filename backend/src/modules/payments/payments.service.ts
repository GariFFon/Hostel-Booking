import type { Payment, PaymentAttempt } from '@/generated/prisma/client';
import type { Actor } from '@/core/context/request-context';
import { requireVerifiedEmail } from '@/core/auth/rbac';
import { env } from '@/core/config/env';
import { Errors } from '@/core/errors/app-error';
import { prisma } from '@/infra/db/prisma';
import { DEMO_INSTRUMENTS, demoPaymentsAllowed } from '@/infra/payments/demo.provider';
import { getPaymentProvider } from '@/infra/payments/provider';
import { enqueue } from '@/infra/queue/queue';
import { recordAudit } from '@/modules/audit/audit.service';
import { lockBooking } from '@/modules/bookings/booking-core';
import { expireDueBookings } from '@/modules/bookings/booking-expiry';
import type { PaymentDto } from './payments.schema';

type PaymentWithAttempts = Payment & { attempts: PaymentAttempt[] };

export function toPaymentDto(p: PaymentWithAttempts, holdExpiresAt: Date | null): PaymentDto {
  const open = p.status === 'CREATED' || p.status === 'PENDING';
  return {
    id: p.id, bookingId: p.bookingId, provider: p.provider, providerOrderId: p.providerOrderId, amountPaise: p.amountPaise, refundedPaise: p.refundedPaise, currency: p.currency, status: p.status,
    method: p.method, failureCode: p.failureCode, failureReason: p.failureReason, capturedAt: p.capturedAt?.toISOString() ?? null, expiresAt: open ? (holdExpiresAt?.toISOString() ?? null) : null,
    attempts: [...p.attempts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((a) => ({ id: a.id, status: a.status, instrument: a.instrument, method: a.method, createdAt: a.createdAt.toISOString() })),
    checkout: open && p.provider === 'demo' ? { type: 'demo', instruments: [...DEMO_INSTRUMENTS] } : null,
  };
}

async function loadOwnedPayment(actor: Actor, paymentId: string, opts: { admin?: boolean } = {}) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { attempts: true, booking: { select: { guestId: true, holdExpiresAt: true, status: true } } } });
  if (!payment || (payment.booking.guestId !== actor.id && !(opts.admin && actor.roles.includes('ADMIN')))) throw Errors.notFound('Payment');
  return payment;
}

/** An attempt still INITIATED/PENDING after this long is treated as abandoned. */
const STALE_ATTEMPT_MS = 2 * 60_000;

export const paymentsService = {
  /**
   * Starts (or resumes) payment for a booking that is waiting for it. At most one order is open at a time; after a
   * failure a new order is created, so the guest can retry until the hold expires.
   */
  async initiate(actor: Actor, bookingId: string, now = new Date()): Promise<PaymentDto> {
    requireVerifiedEmail(actor);
    const pre = await prisma.booking.findFirst({ where: { id: bookingId, guestId: actor.id }, select: { id: true, code: true, totalPaise: true, currency: true, status: true, holdExpiresAt: true, hostelId: true } });
    if (!pre) throw Errors.notFound('Booking');
    if (pre.status === 'PENDING_PAYMENT' && pre.holdExpiresAt && pre.holdExpiresAt <= now) await expireDueBookings({ now, hostelId: pre.hostelId, limit: 10 });
    const assertPayable = (b: { status: string; holdExpiresAt: Date | null; totalPaise: number }) => {
      if (b.status === 'PENDING_APPROVAL') throw Errors.conflict('The property has not accepted this request yet. You will be asked to pay once it does.');
      if (b.status !== 'PENDING_PAYMENT') throw Errors.invalidTransition(b.status, 'PAID');
      if (b.holdExpiresAt && b.holdExpiresAt <= now) throw Errors.conflict('This booking has expired. Please search again.');
      if (b.totalPaise <= 0) throw Errors.conflict('Nothing to pay for this booking');
    };
    assertPayable(pre);

    // The gateway call happens outside any transaction; an orphaned order at the gateway is harmless.
    const { providerOrderId } = await getPaymentProvider().createOrder({ amountPaise: pre.totalPaise, currency: pre.currency, receipt: pre.code });

    return prisma.$transaction(async (tx) => {
      const booking = await lockBooking(tx, bookingId);
      assertPayable(booking);
      const open = await tx.payment.findFirst({ where: { bookingId, status: { in: ['CREATED', 'PENDING'] } }, include: { attempts: true }, orderBy: { createdAt: 'desc' } });
      if (open) return toPaymentDto(open, booking.holdExpiresAt); // resume instead of piling up orders
      const payment = await tx.payment.create({
        data: { bookingId, provider: getPaymentProvider().name, providerOrderId, amountPaise: booking.totalPaise, currency: booking.currency },
        include: { attempts: true },
      });
      await recordAudit({ action: 'payment.initiated', entityType: 'booking', entityId: bookingId, after: { paymentId: payment.id, amountPaise: payment.amountPaise } }, tx);
      return toPaymentDto(payment, booking.holdExpiresAt);
    });
  },

  /**
   * Demo gateway: stands in for the guest completing payment on the gateway's page. It records the attempt and schedules
   * the signed webhook the gateway would send, so the asynchronous confirmation path is exercised for real.
   */
  async demoCheckout(actor: Actor, paymentId: string, input: { instrument: (typeof DEMO_INSTRUMENTS)[number]; method: string }, now = new Date()): Promise<PaymentDto> {
    if (!demoPaymentsAllowed()) throw Errors.notFound(); // behave as if the endpoint does not exist
    const payment = await loadOwnedPayment(actor, paymentId);
    if (payment.provider !== 'demo') throw Errors.validation(null, 'This payment does not use the demo gateway');
    if (payment.status !== 'CREATED' && payment.status !== 'PENDING') throw Errors.conflict(`This payment is already ${payment.status.toLowerCase()}`);
    if (payment.booking.status !== 'PENDING_PAYMENT') throw Errors.conflict('This booking is no longer waiting for payment');
    if (payment.booking.holdExpiresAt && payment.booking.holdExpiresAt <= now) throw Errors.conflict('This booking has expired. Please search again.');

    const attempt = await prisma.$transaction(async (tx) => {
      // The "is one already running?" check must be made under the booking lock, or two taps can both pass it and start two attempts.
      await lockBooking(tx, payment.bookingId);
      // An attempt that never reported back (a gateway page abandoned, DEMO_TIMEOUT) is closed after a while, so it cannot block every retry.
      await tx.paymentAttempt.updateMany({
        where: { paymentId, status: { in: ['INITIATED', 'PENDING'] }, createdAt: { lt: new Date(now.getTime() - STALE_ATTEMPT_MS) } },
        data: { status: 'FAILED', errorCode: 'TIMEOUT', errorMessage: 'The bank did not respond' },
      });
      if ((await tx.paymentAttempt.count({ where: { paymentId, status: { in: ['INITIATED', 'PENDING'] } } })) > 0) throw Errors.conflict('A payment attempt is already in progress');
      const a = await tx.paymentAttempt.create({ data: { paymentId, status: input.instrument === 'DEMO_PENDING' ? 'PENDING' : 'INITIATED', instrument: input.instrument, method: input.method } });
      if (input.instrument === 'DEMO_PENDING') await tx.payment.update({ where: { id: paymentId }, data: { status: 'PENDING', method: input.method, version: { increment: 1 } } });
      await recordAudit({ action: 'payment.attempt', entityType: 'booking', entityId: payment.bookingId, after: { paymentId, attemptId: a.id, instrument: input.instrument, method: input.method } }, tx);
      return a;
    });
    await enqueue('demo-webhook', { paymentId, attemptId: attempt.id, instrument: input.instrument, stage: 'primary' }, { delayMs: env().DEMO_WEBHOOK_DELAY_MS });
    return this.get(actor, paymentId);
  },

  async get(actor: Actor, paymentId: string, opts: { admin?: boolean } = {}): Promise<PaymentDto> {
    const p = await loadOwnedPayment(actor, paymentId, opts);
    const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: p.id }, include: { attempts: true } });
    return toPaymentDto(fresh, p.booking.holdExpiresAt);
  },
};

