import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '@/core/config/env';
import { AppError } from '@/core/errors/app-error';
import type { CreateOrderInput, PaymentProvider, RefundInput } from './provider';

export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Demo payments move no money. They are allowed everywhere except production, unless explicitly enabled there. */
export const demoPaymentsAllowed = (e: { APP_ENV: string; ALLOW_DEMO_PAYMENTS: boolean } = env()) => e.APP_ENV !== 'production' || e.ALLOW_DEMO_PAYMENTS;
export const DEMO_INSTRUMENTS = ['DEMO_SUCCESS', 'DEMO_FAIL', 'DEMO_PENDING', 'DEMO_TIMEOUT'] as const;
export type DemoInstrument = (typeof DEMO_INSTRUMENTS)[number];

/** `t=<unix seconds>,v1=<hex hmac-sha256 of "t.rawBody">` (same shape real gateways use). */
export function signDemoPayload(rawBody: string, secret = env().DEMO_WEBHOOK_SECRET, at = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

export class DemoProvider implements PaymentProvider {
  readonly name = 'demo';
  /** Test hook: make the next N refund calls fail as if the gateway were down. */
  failRefunds = 0;
  refundCalls: RefundInput[] = [];

  async createOrder(_input: CreateOrderInput) {
    return { providerOrderId: `demo_order_${randomUUID()}` };
  }

  async refund(input: RefundInput) {
    this.refundCalls.push(input);
    if (this.failRefunds > 0) {
      this.failRefunds--;
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Payment gateway unavailable');
    }
    // Deterministic id: repeating the same refund request returns the same refund.
    return { providerRefundId: `demo_rfnd_${createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 24)}` };
  }

  verifyWebhook(rawBody: string, header: string | null, now = new Date()): boolean {
    if (!header || !demoPaymentsAllowed()) return false;
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
    const t = Number(parts.t);
    if (!Number.isFinite(t) || !parts.v1 || Math.abs(now.getTime() / 1000 - t) > WEBHOOK_TOLERANCE_SECONDS) return false;
    const expected = createHmac('sha256', env().DEMO_WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest();
    const given = Buffer.from(parts.v1, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
