import { z } from 'zod';
import { DEMO_INSTRUMENTS } from '@/infra/payments/demo.provider';

const ts = z.iso.datetime();

export const demoCheckoutSchema = z.object({
  instrument: z.enum(DEMO_INSTRUMENTS),
  method: z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET']).default('UPI'),
});

export const paymentDtoSchema = z.strictObject({
  id: z.uuid(), bookingId: z.uuid(), provider: z.string(), providerOrderId: z.string(), amountPaise: z.number().int(), refundedPaise: z.number().int(), currency: z.string(),
  status: z.enum(['CREATED', 'PENDING', 'CAPTURED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED']),
  method: z.string().nullable(), failureCode: z.string().nullable(), failureReason: z.string().nullable(), capturedAt: ts.nullable(),
  /** The booking's hold deadline: pay before this. */
  expiresAt: ts.nullable(),
  attempts: z.array(z.strictObject({ id: z.uuid(), status: z.enum(['INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED']), instrument: z.string(), method: z.string().nullable(), createdAt: ts })),
  /** What the client should present. For the demo gateway: a payment sheet offering these test instruments. */
  checkout: z.strictObject({ type: z.literal('demo'), instruments: z.array(z.enum(DEMO_INSTRUMENTS)) }).nullable(),
});
export type PaymentDto = z.infer<typeof paymentDtoSchema>;

export const demoWebhookEventSchema = z.object({
  id: z.string().min(8).max(100),
  type: z.enum(['payment.captured', 'payment.failed']),
  createdAt: z.string(),
  data: z.object({
    orderId: z.string(), paymentId: z.string(), amountPaise: z.number().int().positive(), currency: z.string().default('INR'),
    method: z.string().nullish(), failureCode: z.string().nullish(), failureReason: z.string().nullish(),
  }),
});
export type DemoWebhookEvent = z.infer<typeof demoWebhookEventSchema>;
