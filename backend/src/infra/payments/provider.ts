import { env } from '@/core/config/env';
import { DemoProvider } from './demo.provider';

export interface CreateOrderInput {
  amountPaise: number;
  currency: string;
  /** Our reference (booking code); lets the provider de-duplicate. */
  receipt: string;
}

export interface RefundInput {
  providerPaymentId: string;
  amountPaise: number;
  /** Deterministic per refund: the provider must treat repeats as the same refund. */
  idempotencyKey: string;
}

/**
 * Everything the platform needs from a payment gateway. The demo implementation is production-shaped (asynchronous,
 * signed webhooks), so adding Razorpay later means implementing this interface and its webhook parser, nothing else.
 */
export interface PaymentProvider {
  readonly name: string;
  createOrder(input: CreateOrderInput): Promise<{ providerOrderId: string }>;
  refund(input: RefundInput): Promise<{ providerRefundId: string }>;
  /** Checks the webhook signature against the exact raw body. */
  verifyWebhook(rawBody: string, signatureHeader: string | null, now?: Date): boolean;
}

let provider: PaymentProvider | undefined;

export function getPaymentProvider(): PaymentProvider {
  if (!provider) {
    switch (env().PAYMENT_PROVIDER) {
      case 'demo':
        provider = new DemoProvider();
    }
  }
  return provider!;
}

/** Test seam. */
export function setPaymentProvider(p: PaymentProvider | null) {
  provider = p ?? undefined;
}
