import { randomUUID } from 'node:crypto';
import { Errors } from '@/core/errors/app-error';
import type { Actor } from '@/core/context/request-context';
import { requireVerifiedEmail } from '@/core/auth/rbac';
import { prisma } from '@/infra/db/prisma';
import { getPaymentProvider } from '@/infra/payments/provider';
import { recordAudit } from '@/modules/audit/audit.service';
import { fmtRupees } from '@/modules/bookings/booking-core';
import type { DemoWebhookEvent } from '@/modules/payments/payments.schema';
import { rentOrderInclude, toRentOrderDto } from '@/modules/rent/rent.mapper';
import { ORDER_STALE_MS } from '@/modules/rent/rent.rules';
import type { WebhookOutcome } from '@/modules/rent/rent-online.service';
import { lockRow } from './tenancy.rules';
import { notifyTenancy, runEffects, type Effect } from './tenancy-notify';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const STALE_ATTEMPT_MS = 2 * 60_000;

/** The deposit can be paid online while the stay is reserved or running, once, and only if it was not already recorded. */
const payable = (t: { status: string; depositPaise: number; depositReceivedAt: Date | null }) => ['PENDING_MOVE_IN', 'ACTIVE'].includes(t.status) && t.depositPaise > 0 && !t.depositReceivedAt;
const assertPayable = (t: { status: string; depositPaise: number; depositReceivedAt: Date | null }) => {
  if (payable(t)) return;
  throw Errors.conflict(t.depositReceivedAt ? 'The deposit has already been paid' : t.depositPaise === 0 ? 'There is no deposit to pay for this stay' : t.status === 'INVITED' ? 'Accept the invitation first' : 'This stay is not open for a deposit payment');
};

/** Closes a deposit order that was abandoned (no attempt in flight for the stale limit) and returns the one still genuinely open. */
export async function liveOpenDepositOrder(tx: Tx, tenancyId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - ORDER_STALE_MS);
  await tx.rentOrderAttempt.updateMany({
    where: { order: { tenancyId, status: { in: ['CREATED', 'PENDING'] } }, status: { in: ['INITIATED', 'PENDING'] }, createdAt: { lt: cutoff } },
    data: { status: 'FAILED', errorCode: 'TIMEOUT', errorMessage: 'The bank did not respond' },
  });
  await tx.rentOrder.updateMany({
    where: { tenancyId, status: { in: ['CREATED', 'PENDING'] }, createdAt: { lt: cutoff }, attempts: { none: { status: { in: ['INITIATED', 'PENDING'] } } } },
    data: { status: 'FAILED', failureCode: 'EXPIRED', failureReason: 'The payment was not completed in time', version: { increment: 1 } },
  });
  return tx.rentOrder.findFirst({ where: { tenancyId, status: { in: ['CREATED', 'PENDING'] } } });
}

export const depositOnline = {
  /** Starts (or resumes) the online payment of the security deposit. */
  async initiate(actor: Actor, tenancyId: string, now = new Date()) {
    requireVerifiedEmail(actor);
    const pre = await prisma.tenancy.findFirst({ where: { id: tenancyId, tenantId: actor.id }, select: { id: true, code: true, status: true, depositPaise: true, depositReceivedAt: true } });
    if (!pre) throw Errors.notFound('Stay');
    assertPayable(pre);
    const { providerOrderId } = await getPaymentProvider().createOrder({ amountPaise: pre.depositPaise, currency: 'INR', receipt: `${pre.code}-deposit` });
    return prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', tenancyId);
      const t = await tx.tenancy.findUniqueOrThrow({ where: { id: tenancyId } });
      assertPayable(t);
      const open = await liveOpenDepositOrder(tx, tenancyId, now);
      if (open) return toRentOrderDto(await tx.rentOrder.findUniqueOrThrow({ where: { id: open.id }, include: rentOrderInclude })); // resume instead of piling up orders
      const order = await tx.rentOrder.create({ data: { tenancyId, tenantId: actor.id, provider: getPaymentProvider().name, providerOrderId, amountPaise: t.depositPaise }, include: rentOrderInclude });
      await recordAudit({ action: 'tenancy.deposit.order.create', entityType: 'tenancy', entityId: tenancyId, after: { orderId: order.id, amountPaise: order.amountPaise }, metadata: { hostelId: t.hostelId, code: t.code } }, tx);
      return toRentOrderDto(order);
    });
  },

  /** Demo gateway: records the attempt the way a rent order does. The caller then schedules the signed callback. */
  async startAttempt(order: { id: string; tenancyId: string | null; amountPaise: number }, input: { instrument: string; method: string }, now: Date) {
    const tenancyId = order.tenancyId!;
    return prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', tenancyId);
      const t = await tx.tenancy.findUniqueOrThrow({ where: { id: tenancyId } });
      if (!payable(t) || t.depositPaise !== order.amountPaise) {
        await tx.rentOrder.update({ where: { id: order.id }, data: { status: 'FAILED', failureCode: 'CHANGED', failureReason: 'The deposit changed. Start the payment again.', version: { increment: 1 } } });
        throw Errors.conflict('The deposit changed since the payment was started. Start the payment again.');
      }
      await tx.rentOrderAttempt.updateMany({
        where: { orderId: order.id, status: { in: ['INITIATED', 'PENDING'] }, createdAt: { lt: new Date(now.getTime() - STALE_ATTEMPT_MS) } },
        data: { status: 'FAILED', errorCode: 'TIMEOUT', errorMessage: 'The bank did not respond' },
      });
      if ((await tx.rentOrderAttempt.count({ where: { orderId: order.id, status: { in: ['INITIATED', 'PENDING'] } } })) > 0) throw Errors.conflict('A payment attempt is already in progress');
      const a = await tx.rentOrderAttempt.create({ data: { orderId: order.id, status: input.instrument === 'DEMO_PENDING' ? 'PENDING' : 'INITIATED', instrument: input.instrument, method: input.method } });
      if (input.instrument === 'DEMO_PENDING') await tx.rentOrder.update({ where: { id: order.id }, data: { status: 'PENDING', method: input.method, version: { increment: 1 } } });
      await recordAudit({ action: 'tenancy.deposit.order.attempt', entityType: 'tenancy', entityId: tenancyId, after: { orderId: order.id, attemptId: a.id, instrument: input.instrument }, metadata: { hostelId: t.hostelId, code: t.code } }, tx);
      return a;
    });
  },
};

/** A gateway callback for a deposit order (called by the rent handler when the order has no invoice). Lock order: tenancy, then order. */
export async function applyDepositEvent(event: DemoWebhookEvent, eventRowId: string, now: Date): Promise<WebhookOutcome | null> {
  const order = await prisma.rentOrder.findUnique({ where: { providerOrderId: event.data.orderId }, select: { id: true, tenancyId: true, amountPaise: true } });
  if (!order?.tenancyId) return null;
  const tenancyId = order.tenancyId;
  const finish = (tx: Tx | typeof prisma, status: 'PROCESSED' | 'IGNORED', error?: string) => tx.webhookEvent.update({ where: { id: eventRowId }, data: { status, processedAt: now, error: error ?? null } });

  if (event.type === 'payment.captured' && event.data.amountPaise !== order.amountPaise) {
    await prisma.webhookEvent.update({ where: { id: eventRowId }, data: { status: 'FAILED', error: 'amount mismatch' } });
    await recordAudit({ action: 'tenancy.deposit.amount_mismatch', entityType: 'tenancy', entityId: tenancyId, outcome: 'DENIED', actorRole: 'SYSTEM', actorId: null, metadata: { expected: order.amountPaise, received: event.data.amountPaise } });
    throw Errors.validation(null, 'Payment amount does not match the order');
  }

  const effects: Effect[] = [];
  const outcome = await prisma.$transaction(async (tx): Promise<WebhookOutcome> => {
    await lockRow(tx, 'tenancies', tenancyId);
    await tx.$queryRaw`SELECT id FROM rent_orders WHERE id = ${order.id}::uuid FOR UPDATE`;
    const o = await tx.rentOrder.findUniqueOrThrow({ where: { id: order.id } });
    const t = await tx.tenancy.findUniqueOrThrow({ where: { id: tenancyId }, include: { hostel: { select: { name: true, ownerId: true, owner: { select: { email: true } } } }, tenant: { select: { id: true, email: true } } } });
    const meta = { hostelId: t.hostelId, code: t.code };

    if (event.type === 'payment.captured') {
      if (o.status === 'CAPTURED') { await finish(tx, 'IGNORED', 'already captured'); return 'ignored'; }
      await tx.rentOrder.update({ where: { id: o.id }, data: { status: 'CAPTURED', providerPaymentId: event.data.paymentId, method: event.data.method ?? o.method, capturedAt: now, failureCode: null, failureReason: null, version: { increment: 1 } } });
      await tx.rentOrderAttempt.updateMany({ where: { orderId: o.id, status: { in: ['INITIATED', 'PENDING'] } }, data: { status: 'SUCCEEDED' } });
      // The money is on the platform's books either way; only a deposit that is still due is marked as received.
      await tx.ledgerEntry.create({ data: { groupId: randomUUID(), debitAccount: 'GUEST', creditAccount: 'DEPOSIT_HELD', amountPaise: o.amountPaise, memo: `Deposit ${t.code}: held for the stay`, tenancyId } });
      if (payable(t)) {
        await tx.tenancy.update({ where: { id: tenancyId }, data: { depositReceivedAt: now, depositMethod: 'ONLINE', depositReference: event.data.paymentId, version: { increment: 1 } } });
        await recordAudit({ action: 'tenancy.deposit.online', entityType: 'tenancy', entityId: tenancyId, actorRole: 'SYSTEM', actorId: null, after: { orderId: o.id, amountPaise: o.amountPaise }, metadata: meta }, tx);
        const ctx = { property: t.hostel.name, hostelId: t.hostelId, tenancyId, code: t.code, amount: fmtRupees(o.amountPaise) };
        effects.push(...(await notifyTenancy(tx, 'deposit_paid', { ...ctx, audience: 'TENANT', to: { userId: t.tenant!.id, email: t.tenant!.email } })));
        effects.push(...(await notifyTenancy(tx, 'deposit_paid', { ...ctx, audience: 'OWNER', to: { userId: t.hostel.ownerId, email: t.hostel.owner.email } })));
      } else {
        await recordAudit({ action: 'tenancy.deposit.needs_review', entityType: 'tenancy', entityId: tenancyId, outcome: 'FAILURE', actorRole: 'SYSTEM', actorId: null, metadata: { ...meta, reason: 'deposit already recorded or stay over', orderId: o.id, amountPaise: o.amountPaise } }, tx);
      }
    } else {
      if (o.status !== 'CREATED' && o.status !== 'PENDING') { await finish(tx, 'IGNORED', `payment already ${o.status}`); return 'ignored'; } // a stale "failed" after success
      await tx.rentOrder.update({ where: { id: o.id }, data: { status: 'FAILED', failureCode: event.data.failureCode ?? 'DECLINED', failureReason: event.data.failureReason ?? 'The payment was declined', version: { increment: 1 } } });
      await tx.rentOrderAttempt.updateMany({ where: { orderId: o.id, status: { in: ['INITIATED', 'PENDING'] } }, data: { status: 'FAILED', errorCode: event.data.failureCode ?? 'DECLINED', errorMessage: event.data.failureReason ?? 'The payment was declined' } });
      await recordAudit({ action: 'tenancy.deposit.failed', entityType: 'tenancy', entityId: tenancyId, outcome: 'FAILURE', actorRole: 'SYSTEM', actorId: null, after: { orderId: o.id, code: event.data.failureCode ?? 'DECLINED' }, metadata: meta }, tx);
    }
    await finish(tx, 'PROCESSED');
    return 'processed';
  });
  await runEffects(effects);
  return outcome;
}
