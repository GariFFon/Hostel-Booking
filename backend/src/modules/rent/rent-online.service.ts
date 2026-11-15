import { randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import { AppError, Errors } from '@/core/errors/app-error';
import type { Actor } from '@/core/context/request-context';
import { requireVerifiedEmail } from '@/core/auth/rbac';
import { env } from '@/core/config/env';
import { todayIn } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { demoPaymentsAllowed } from '@/infra/payments/demo.provider';
import { getPaymentProvider } from '@/infra/payments/provider';
import { enqueue } from '@/infra/queue/queue';
import { recordAudit } from '@/modules/audit/audit.service';
import { fmtRupees } from '@/modules/bookings/booking-core';
import type { DemoWebhookEvent } from '@/modules/payments/payments.schema';
import { depositOnline, applyDepositEvent } from '@/modules/tenancies/deposit-online';
import { rentOrderInclude, toRentOrderDto } from './rent.mapper';
import { balanceOf, newReceiptNumber } from './rent.rules';
import { liveOpenOrder, lockInvoice } from './rent.service';
import { notifyRent, runEffects, type Effect } from './rent-notify';

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored';
/** An attempt still INITIATED/PENDING after this long is treated as abandoned (the same rule bookings use). */
const STALE_ATTEMPT_MS = 2 * 60_000;

const payable = (i: { status: string; totalPaise: number; paidPaise: number }) => (i.status === 'DUE' || i.status === 'PARTIALLY_PAID') && balanceOf(i) > 0;
const assertPayable = (i: { status: string; totalPaise: number; paidPaise: number }) => {
  if (!payable(i)) throw Errors.conflict(i.status === 'PAID' ? 'This invoice is already paid' : i.status === 'VOID' ? 'This invoice was cancelled' : 'Nothing is owed on this invoice');
};

export const rentOnline = {
  /** Starts (or resumes) an online payment of the invoice's whole balance. At most one order is open per invoice. */
  async initiate(actor: Actor, invoiceId: string, now = new Date()) {
    requireVerifiedEmail(actor);
    const pre = await prisma.rentInvoice.findFirst({ where: { id: invoiceId, tenantId: actor.id }, select: { id: true, number: true, status: true, totalPaise: true, paidPaise: true } });
    if (!pre) throw Errors.notFound('Invoice');
    assertPayable(pre);
    // The gateway call happens outside any transaction; an orphaned order at the gateway is harmless.
    const { providerOrderId } = await getPaymentProvider().createOrder({ amountPaise: balanceOf(pre), currency: 'INR', receipt: pre.number });

    return prisma.$transaction(async (tx) => {
      await lockInvoice(tx, invoiceId);
      const inv = await tx.rentInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
      assertPayable(inv);
      const open = await liveOpenOrder(tx, invoiceId, now);
      if (open) return toRentOrderDto(await tx.rentOrder.findUniqueOrThrow({ where: { id: open.id }, include: rentOrderInclude })); // resume instead of piling up orders
      const order = await tx.rentOrder.create({
        data: { invoiceId, tenantId: actor.id, provider: getPaymentProvider().name, providerOrderId, amountPaise: balanceOf(inv) },
        include: rentOrderInclude,
      });
      await recordAudit({ action: 'rent.order.create', entityType: 'rent_invoice', entityId: invoiceId, after: { orderId: order.id, amountPaise: order.amountPaise }, metadata: { hostelId: inv.hostelId, tenancyId: inv.tenancyId, number: inv.number } }, tx);
      return toRentOrderDto(order);
    });
  },

  /** Demo gateway: stands in for the tenant finishing payment on the gateway's page, then schedules the signed webhook a real gateway would send. */
  async demoCheckout(actor: Actor, orderId: string, input: { instrument: string; method: string }, now = new Date()) {
    if (!demoPaymentsAllowed()) throw Errors.notFound(); // behave as if the endpoint does not exist
    const order = await prisma.rentOrder.findFirst({ where: { id: orderId, tenantId: actor.id } });
    if (!order) throw Errors.notFound('Payment');
    if (order.provider !== 'demo') throw Errors.validation(null, 'This payment does not use the demo gateway');
    if (order.status !== 'CREATED' && order.status !== 'PENDING') throw Errors.conflict(`This payment is already ${order.status.toLowerCase()}`);

    const invoiceId = order.invoiceId;
    const attempt = invoiceId === null ? await depositOnline.startAttempt(order, input, now) : await prisma.$transaction(async (tx) => {
      await lockInvoice(tx, invoiceId); // the "is one already running?" check must be made under the lock
      const inv = await tx.rentInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
      if (!payable(inv) || balanceOf(inv) !== order.amountPaise) {
        await tx.rentOrder.update({ where: { id: order.id }, data: { status: 'FAILED', failureCode: 'CHANGED', failureReason: 'The invoice changed. Start the payment again.', version: { increment: 1 } } });
        throw Errors.conflict('This invoice changed since the payment was started. Start the payment again.');
      }
      await tx.rentOrderAttempt.updateMany({
        where: { orderId, status: { in: ['INITIATED', 'PENDING'] }, createdAt: { lt: new Date(now.getTime() - STALE_ATTEMPT_MS) } },
        data: { status: 'FAILED', errorCode: 'TIMEOUT', errorMessage: 'The bank did not respond' },
      });
      if ((await tx.rentOrderAttempt.count({ where: { orderId, status: { in: ['INITIATED', 'PENDING'] } } })) > 0) throw Errors.conflict('A payment attempt is already in progress');
      const a = await tx.rentOrderAttempt.create({ data: { orderId, status: input.instrument === 'DEMO_PENDING' ? 'PENDING' : 'INITIATED', instrument: input.instrument, method: input.method } });
      if (input.instrument === 'DEMO_PENDING') await tx.rentOrder.update({ where: { id: orderId }, data: { status: 'PENDING', method: input.method, version: { increment: 1 } } });
      await recordAudit({ action: 'rent.order.attempt', entityType: 'rent_invoice', entityId: invoiceId, after: { orderId, attemptId: a.id, instrument: input.instrument }, metadata: { hostelId: inv.hostelId, tenancyId: inv.tenancyId, number: inv.number } }, tx);
      return a;
    });
    await enqueue('rent-demo-webhook', { orderId, attemptId: attempt.id, instrument: input.instrument, stage: 'primary' }, { delayMs: env().DEMO_WEBHOOK_DELAY_MS });
    return this.get(actor, orderId);
  },

  async get(actor: Actor, orderId: string) {
    const o = await prisma.rentOrder.findFirst({ where: { id: orderId, tenantId: actor.id }, include: rentOrderInclude });
    if (!o) throw Errors.notFound('Payment');
    return toRentOrderDto(o);
  },
};

/**
 * A gateway callback for a rent order. Called by the shared webhook handler when the order id is not a booking payment:
 * returns null if it is not a rent order either. Lock order: invoice, then order.
 */
export async function applyRentEvent(event: DemoWebhookEvent, eventRowId: string, now: Date): Promise<WebhookOutcome | null> {
  const order = await prisma.rentOrder.findUnique({ where: { providerOrderId: event.data.orderId }, select: { id: true, invoiceId: true, amountPaise: true } });
  if (!order) return null;
  if (order.invoiceId === null) return applyDepositEvent(event, eventRowId, now); // an order for the security deposit
  const invoiceId = order.invoiceId;
  const finish = (tx: Prisma.TransactionClient | typeof prisma, status: 'PROCESSED' | 'IGNORED', error?: string) =>
    tx.webhookEvent.update({ where: { id: eventRowId }, data: { status, processedAt: now, error: error ?? null } });

  if (event.type === 'payment.captured' && event.data.amountPaise !== order.amountPaise) {
    await prisma.webhookEvent.update({ where: { id: eventRowId }, data: { status: 'FAILED', error: 'amount mismatch' } });
    await recordAudit({ action: 'rent.payment.amount_mismatch', entityType: 'rent_invoice', entityId: invoiceId, outcome: 'DENIED', actorRole: 'SYSTEM', actorId: null, metadata: { expected: order.amountPaise, received: event.data.amountPaise } });
    throw Errors.validation(null, 'Payment amount does not match the order');
  }

  try {
    const effects: Effect[] = [];
    const outcome = await prisma.$transaction(async (tx): Promise<WebhookOutcome> => {
      await lockInvoice(tx, invoiceId);
      await tx.$queryRaw`SELECT id FROM rent_orders WHERE id = ${order.id}::uuid FOR UPDATE`;
      const o = await tx.rentOrder.findUniqueOrThrow({ where: { id: order.id } });
      const inv = await tx.rentInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { hostel: { select: { name: true, ownerId: true, timezone: true, owner: { select: { email: true } } } }, tenant: { select: { id: true, email: true } } } });
      const note = { hostelId: inv.hostelId, tenancyId: inv.tenancyId, number: inv.number };

      if (event.type === 'payment.captured') {
        if (o.status === 'CAPTURED') { await finish(tx, 'IGNORED', 'already captured'); return 'ignored'; }
        await tx.rentOrder.update({ where: { id: o.id }, data: { status: 'CAPTURED', providerPaymentId: event.data.paymentId, method: event.data.method ?? o.method, capturedAt: now, failureCode: null, failureReason: null, version: { increment: 1 } } });
        await tx.rentOrderAttempt.updateMany({ where: { orderId: o.id, status: { in: ['INITIATED', 'PENDING'] } }, data: { status: 'SUCCEEDED' } });

        const receivedOn = todayIn(inv.hostel.timezone, now);
        const payment = await tx.rentPayment.create({
          data: {
            receiptNo: newReceiptNumber(receivedOn), invoiceId: inv.id, tenancyId: inv.tenancyId, hostelId: inv.hostelId, tenantId: inv.tenantId, amountPaise: o.amountPaise, method: 'ONLINE',
            reference: event.data.paymentId, receivedOn: new Date(`${receivedOn}T00:00:00.000Z`), rentOrderId: o.id,
          },
        });
        // Money that arrives for a cancelled invoice cannot be applied to it: it is recorded and flagged for support to refund.
        const applied = inv.status !== 'VOID';
        const paid = inv.paidPaise + o.amountPaise;
        const overpaid = applied && paid > inv.totalPaise;
        if (applied) await tx.rentInvoice.update({ where: { id: inv.id }, data: { paidPaise: paid, status: paid >= inv.totalPaise ? 'PAID' : 'PARTIALLY_PAID', paidAt: paid >= inv.totalPaise ? now : null, version: { increment: 1 } } });

        const commission = Math.round((o.amountPaise * env().RENT_COMMISSION_BPS) / 10_000);
        const groupId = randomUUID();
        const entries = [
          { debitAccount: 'GUEST' as const, creditAccount: 'OWNER_PAYABLE' as const, amountPaise: o.amountPaise - commission, memo: `Rent ${inv.number}: owner share` },
          { debitAccount: 'GUEST' as const, creditAccount: 'PLATFORM_REVENUE' as const, amountPaise: commission, memo: `Rent ${inv.number}: platform commission` },
        ].filter((e) => e.amountPaise > 0); // zero-value entries are not allowed (and mean nothing)
        if (entries.length) await tx.ledgerEntry.createMany({ data: entries.map((e) => ({ ...e, groupId, rentInvoiceId: inv.id })) });

        await recordAudit({
          action: 'rent.payment.capture', entityType: 'rent_invoice', entityId: inv.id, actorRole: 'SYSTEM', actorId: null,
          after: { orderId: o.id, receiptNo: payment.receiptNo, amountPaise: o.amountPaise, commissionPaise: commission, applied, overpaid }, metadata: note,
        }, tx);
        if (!applied || overpaid) await recordAudit({ action: 'rent.payment.needs_review', entityType: 'rent_invoice', entityId: inv.id, outcome: 'FAILURE', actorRole: 'SYSTEM', actorId: null, metadata: { ...note, reason: applied ? 'overpaid' : 'invoice cancelled' } }, tx);

        const amount = fmtRupees(o.amountPaise);
        effects.push(...(await notifyRent(tx, 'paid', { property: inv.hostel.name, hostelId: inv.hostelId, tenancyId: inv.tenancyId, invoiceId: inv.id, number: inv.number, amount, audience: 'TENANT', to: { userId: inv.tenant.id, email: inv.tenant.email } })));
        effects.push(...(await notifyRent(tx, 'paid', { property: inv.hostel.name, hostelId: inv.hostelId, tenancyId: inv.tenancyId, invoiceId: inv.id, number: inv.number, amount, audience: 'OWNER', to: { userId: inv.hostel.ownerId, email: inv.hostel.owner.email } })));
      } else {
        if (o.status !== 'CREATED' && o.status !== 'PENDING') { await finish(tx, 'IGNORED', `payment already ${o.status}`); return 'ignored'; } // a stale "failed" after success
        await tx.rentOrder.update({ where: { id: o.id }, data: { status: 'FAILED', failureCode: event.data.failureCode ?? 'DECLINED', failureReason: event.data.failureReason ?? 'The payment was declined', version: { increment: 1 } } });
        await tx.rentOrderAttempt.updateMany({ where: { orderId: o.id, status: { in: ['INITIATED', 'PENDING'] } }, data: { status: 'FAILED', errorCode: event.data.failureCode ?? 'DECLINED', errorMessage: event.data.failureReason ?? 'The payment was declined' } });
        await recordAudit({ action: 'rent.payment.failed', entityType: 'rent_invoice', entityId: inv.id, outcome: 'FAILURE', actorRole: 'SYSTEM', actorId: null, after: { orderId: o.id, code: event.data.failureCode ?? 'DECLINED' }, metadata: note }, tx);
      }
      await finish(tx, 'PROCESSED');
      return 'processed';
    });
    await runEffects(effects);
    return outcome;
  } catch (e) {
    await prisma.webhookEvent.update({ where: { id: eventRowId }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 500) } }).catch(() => undefined);
    throw e instanceof AppError ? e : new AppError('INTERNAL', 'Could not process the webhook');
  }
}
