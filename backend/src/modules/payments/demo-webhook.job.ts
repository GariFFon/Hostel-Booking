import { env } from '@/core/config/env';
import { logger } from '@/core/logger/logger';
import { prisma } from '@/infra/db/prisma';
import { signDemoPayload } from '@/infra/payments/demo.provider';
import { enqueue, queueMode, type JobMap } from '@/infra/queue/queue';
import { processDemoWebhook } from './webhooks.service';

/**
 * Plays the gateway: after the guest "pays", sends the signed callback a real gateway would. Outcomes by instrument:
 *   DEMO_SUCCESS -> payment.captured          DEMO_FAIL -> payment.failed
 *   DEMO_PENDING -> captured later (like a UPI approval)    DEMO_TIMEOUT -> nothing ever arrives (guest abandons)
 */
export async function runDemoWebhookJob(data: JobMap['demo-webhook']): Promise<void> {
  if (data.instrument === 'DEMO_TIMEOUT') return;
  if (data.instrument === 'DEMO_PENDING' && data.stage === 'primary') {
    await enqueue('demo-webhook', { ...data, stage: 'settle' }, { delayMs: env().DEMO_WEBHOOK_DELAY_MS * 4 });
    return;
  }
  const attempt = await prisma.paymentAttempt.findUnique({ where: { id: data.attemptId }, include: { payment: true } });
  if (!attempt) return;
  const failed = data.instrument === 'DEMO_FAIL';
  const event = {
    id: `evt_${attempt.id}_${failed ? 'failed' : 'captured'}`, // deterministic: redelivery is recognised as a duplicate
    type: failed ? 'payment.failed' : 'payment.captured', createdAt: new Date().toISOString(),
    data: {
      orderId: attempt.payment.providerOrderId, paymentId: `demo_pay_${attempt.id.replace(/-/g, '')}`, amountPaise: attempt.payment.amountPaise, currency: attempt.payment.currency, method: attempt.method,
      ...(failed ? { failureCode: 'DEMO_DECLINED', failureReason: 'Your bank declined the payment (demo)' } : {}),
    },
  };
  const raw = JSON.stringify(event);
  const signature = signDemoPayload(raw);

  if (queueMode() === 'bullmq') {
    // Real delivery: over HTTP to our own public endpoint, exactly as a gateway would. Non-2xx => BullMQ retries with backoff.
    const res = await fetch(`${env().APP_URL}/api/v1/payments/webhooks/demo`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-signature': signature }, body: raw });
    if (!res.ok) throw new Error(`webhook endpoint answered ${res.status}`);
    return;
  }
  const outcome = await processDemoWebhook(raw, signature);
  logger.debug({ outcome, eventId: event.id }, 'demo webhook delivered in-process');
}
