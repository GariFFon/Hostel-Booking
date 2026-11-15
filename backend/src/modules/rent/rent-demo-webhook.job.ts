import { env } from '@/core/config/env';
import { logger } from '@/core/logger/logger';
import { prisma } from '@/infra/db/prisma';
import { signDemoPayload } from '@/infra/payments/demo.provider';
import { enqueue, queueMode, type JobMap } from '@/infra/queue/queue';
import { processDemoWebhook } from '@/modules/payments/webhooks.service';

/**
 * Plays the gateway for a rent order, exactly like the booking version: after the tenant "pays", it sends the signed callback a
 * real gateway would. DEMO_SUCCESS captures, DEMO_FAIL fails, DEMO_PENDING captures later, DEMO_TIMEOUT never reports back.
 */
export async function runRentDemoWebhookJob(data: JobMap['rent-demo-webhook']): Promise<void> {
  if (data.instrument === 'DEMO_TIMEOUT') return;
  if (data.instrument === 'DEMO_PENDING' && data.stage === 'primary') {
    await enqueue('rent-demo-webhook', { ...data, stage: 'settle' }, { delayMs: env().DEMO_WEBHOOK_DELAY_MS * 4 });
    return;
  }
  const attempt = await prisma.rentOrderAttempt.findUnique({ where: { id: data.attemptId }, include: { order: true } });
  if (!attempt) return;
  const failed = data.instrument === 'DEMO_FAIL';
  const event = {
    id: `evt_${attempt.id}_${failed ? 'failed' : 'captured'}`, // deterministic: redelivery is recognised as a duplicate
    type: failed ? 'payment.failed' : 'payment.captured', createdAt: new Date().toISOString(),
    data: {
      orderId: attempt.order.providerOrderId, paymentId: `demo_pay_${attempt.id.replace(/-/g, '')}`, amountPaise: attempt.order.amountPaise, currency: attempt.order.currency, method: attempt.method ?? 'UPI',
      ...(failed ? { failureCode: 'DEMO_DECLINED', failureReason: 'Your bank declined the payment (demo)' } : {}),
    },
  };
  const raw = JSON.stringify(event);
  const signature = signDemoPayload(raw);
  if (queueMode() === 'bullmq') {
    const res = await fetch(`${env().APP_URL}/api/v1/payments/webhooks/demo`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-signature': signature }, body: raw });
    if (!res.ok) throw new Error(`webhook endpoint answered ${res.status}`);
    return;
  }
  logger.debug({ outcome: await processDemoWebhook(raw, signature), eventId: event.id }, 'rent demo webhook delivered in-process');
}
