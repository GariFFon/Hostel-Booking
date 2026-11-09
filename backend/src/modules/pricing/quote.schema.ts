import { z } from 'zod';
import { isDateString } from '@/core/dates';

const date = z.string().refine(isDateString, 'Use YYYY-MM-DD');

export const MAX_STAY_NIGHTS = 90;
export const MAX_QUOTE_ITEMS = 5;

export const quoteRequestSchema = z.object({
  hostelId: z.uuid(),
  checkIn: date,
  checkOut: date,
  guests: z.number().int().min(1).max(30),
  items: z.array(z.object({ roomTypeId: z.uuid(), units: z.number().int().min(1).max(50) })).min(1).max(MAX_QUOTE_ITEMS),
  couponCode: z.string().trim().toUpperCase().min(2).max(40).nullish(),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

const nightSchema = z.strictObject({ date: z.string(), unitPricePaise: z.number().int(), taxBps: z.number().int(), isSpecialPrice: z.boolean() });

export const quoteDtoSchema = z.strictObject({
  hostelId: z.uuid(),
  hostelName: z.string(),
  currency: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number().int(),
  guests: z.number().int(),
  items: z.array(z.strictObject({
    roomTypeId: z.uuid(), name: z.string(), kind: z.enum(['DORM', 'PRIVATE']), units: z.number().int(), nightly: z.array(nightSchema), lineSubtotalPaise: z.number().int(),
  })),
  subtotalPaise: z.number().int(),
  discountPaise: z.number().int(),
  taxPaise: z.number().int(),
  serviceFeePaise: z.number().int(),
  totalPaise: z.number().int(),
  effectiveGstBps: z.number().int(),
  coupon: z.union([
    z.strictObject({ code: z.string(), valid: z.literal(true), discountPaise: z.number().int(), description: z.string().nullable() }),
    z.strictObject({ code: z.string(), valid: z.literal(false), reason: z.string(), message: z.string() }),
  ]).nullable(),
  cancellation: z.strictObject({
    policy: z.enum(['FLEXIBLE', 'MODERATE', 'STRICT']), summary: z.string(), freeCancellationUntil: z.string().nullable(),
    tiers: z.array(z.strictObject({ until: z.string(), refundPercent: z.number().int() })),
  }),
  bookingMode: z.enum(['INSTANT', 'APPROVAL']),
  holdMinutes: z.number().int(),
  checkInTime: z.string(),
  checkOutTime: z.string(),
});
export type QuoteDto = z.infer<typeof quoteDtoSchema>;
