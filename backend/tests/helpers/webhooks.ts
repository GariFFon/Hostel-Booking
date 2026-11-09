import { signDemoPayload } from '@/infra/payments/demo.provider';
import { POST as webhookRoute } from '@/app/api/v1/payments/webhooks/demo/route';
import { prisma } from '@/infra/db/prisma';
import { call } from './http';

let n = 0;
export interface EventOverrides {
  id?: string; type?: 'payment.captured' | 'payment.failed'; amountPaise?: number; orderId?: string; method?: string; failureCode?: string;
}

/** Builds a gateway event for a payment exactly as the demo gateway would send it. */
export async function buildEvent(paymentId: string, over: EventOverrides = {}) {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const type = over.type ?? 'payment.captured';
  return {
    id: over.id ?? `evt_test_${Date.now()}_${++n}`, type, createdAt: new Date().toISOString(),
    data: {
      orderId: over.orderId ?? p.providerOrderId, paymentId: `demo_pay_test_${paymentId.replace(/-/g, "")}`, amountPaise: over.amountPaise ?? p.amountPaise, currency: 'INR', method: over.method ?? 'UPI',
      ...(type === 'payment.failed' ? { failureCode: over.failureCode ?? 'DEMO_DECLINED', failureReason: 'Declined' } : {}),
    },
  };
}

/** POSTs a (correctly signed, by default) event to the public webhook endpoint. */
export async function deliver(event: object, opts: { signature?: string | null; at?: Date; raw?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(event);
  const signature = opts.signature === undefined ? signDemoPayload(raw, undefined, opts.at) : opts.signature;
  return call(webhookRoute, { rawBody: raw, headers: signature ? { 'x-demo-signature': signature } : {} });
}
