import { z } from 'zod';
import { paginationSchema } from '@/core/http/pagination';
import { safeText } from '@/modules/reviews/reviews.schema';

const ts = z.iso.datetime();
const tsIn = z.iso.datetime({ offset: true });
const discountType = z.enum(['PERCENT', 'FLAT']);

/** Business limits. The database has its own, looser CHECKs as a last line of defence. */
export const COUPON_LIMITS = {
  percentBps: { min: 100, max: 10000 }, // 1%..100% (100% = a free stay; the booking confirms without payment)
  flatPaise: { min: 100, max: 5_000_000 }, // ₹1..₹50,000
  maxDiscountPaise: { min: 100, max: 5_000_000 },
  minBookingPaise: { max: 100_000_000 }, // ₹10,00,000
  usageLimit: { max: 1_000_000 },
  perUserLimit: { max: 100 },
  maxValidityDays: 731,
  maxPerOwner: 200,
} as const;
const L = COUPON_LIMITS;

const percentBps = z.number().int().min(L.percentBps.min).max(L.percentBps.max);
const flatPaise = z.number().int().min(L.flatPaise.min).max(L.flatPaise.max);
const maxDiscountPaise = z.number().int().min(L.maxDiscountPaise.min).max(L.maxDiscountPaise.max);
const minBookingPaise = z.number().int().min(0).max(L.minBookingPaise.max);
const usageLimit = z.number().int().min(1).max(L.usageLimit.max);
const perUserLimit = z.number().int().min(1).max(L.perUserLimit.max);

export interface CouponShape {
  discountType: 'PERCENT' | 'FLAT'; percentBps: number | null; flatPaise: number | null; maxDiscountPaise: number | null; validFrom: Date; validTo: Date;
}

/** Cross-field rules, shared by create (schema refinement) and update (applied to the merged result). */
export function couponShapeIssues(c: CouponShape): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (c.discountType === 'PERCENT') {
    if (c.percentBps === null) issues.push({ path: 'percentBps', message: 'Required for a percentage coupon' });
    if (c.flatPaise !== null) issues.push({ path: 'flatPaise', message: 'Not allowed for a percentage coupon' });
  } else {
    if (c.flatPaise === null) issues.push({ path: 'flatPaise', message: 'Required for a flat coupon' });
    if (c.percentBps !== null) issues.push({ path: 'percentBps', message: 'Not allowed for a flat coupon' });
    if (c.maxDiscountPaise !== null) issues.push({ path: 'maxDiscountPaise', message: 'Only applies to percentage coupons' });
  }
  if (c.validTo <= c.validFrom) issues.push({ path: 'validTo', message: 'Must be after validFrom' });
  else if (c.validTo.getTime() - c.validFrom.getTime() > L.maxValidityDays * 86_400_000) issues.push({ path: 'validTo', message: `A coupon can be valid for at most ${L.maxValidityDays} days` });
  return issues;
}

// ── input ──
export const createCouponSchema = z.strictObject({
  /** Letters, digits, "-" and "_"; stored upper-case. Globally unique. */
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{3,19}$/, '4-20 characters: letters, digits, "-" or "_"'),
  description: safeText(200).optional(),
  discountType,
  percentBps: percentBps.optional(), flatPaise: flatPaise.optional(), maxDiscountPaise: maxDiscountPaise.optional(),
  minBookingPaise: minBookingPaise.default(0),
  /** Hosts: the property this code applies to (required). Admins create platform-wide codes (leave empty). */
  hostelId: z.uuid().optional(),
  validFrom: tsIn, validTo: tsIn,
  usageLimit: usageLimit.optional(), perUserLimit: perUserLimit.default(1),
  isActive: z.boolean().default(true), isPublic: z.boolean().default(false),
}).superRefine((v, ctx) => {
  for (const i of couponShapeIssues({ discountType: v.discountType, percentBps: v.percentBps ?? null, flatPaise: v.flatPaise ?? null, maxDiscountPaise: v.maxDiscountPaise ?? null, validFrom: new Date(v.validFrom), validTo: new Date(v.validTo) })) {
    ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
  }
});

/** PATCH. The code, discount type and property never change (past bookings point at them). Omitted = unchanged. */
export const updateCouponSchema = z.strictObject({
  description: safeText(200).nullable().optional(),
  percentBps: percentBps.nullable().optional(), flatPaise: flatPaise.nullable().optional(), maxDiscountPaise: maxDiscountPaise.nullable().optional(),
  minBookingPaise: minBookingPaise.optional(),
  validFrom: tsIn.optional(), validTo: tsIn.optional(),
  usageLimit: usageLimit.nullable().optional(), perUserLimit: perUserLimit.optional(),
  isActive: z.boolean().optional(), isPublic: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to change' });

export const listCouponsQuerySchema = paginationSchema.extend({
  hostelId: z.uuid().optional(),
  isActive: z.enum(['true', 'false']).optional(),
  /** Admin only: PLATFORM = platform-wide codes, PROPERTY = host codes. */
  scope: z.enum(['PLATFORM', 'PROPERTY']).optional(),
});

// ── output ──
export const couponStatusSchema = z.enum(['ACTIVE', 'SCHEDULED', 'EXPIRED', 'EXHAUSTED', 'DISABLED']);
export const couponDtoSchema = z.strictObject({
  id: z.uuid(), code: z.string(), description: z.string().nullable(),
  discountType, percentBps: z.number().int().nullable(), flatPaise: z.number().int().nullable(), maxDiscountPaise: z.number().int().nullable(), minBookingPaise: z.number().int(),
  scope: z.enum(['PLATFORM', 'PROPERTY']), hostel: z.strictObject({ id: z.uuid(), slug: z.string(), name: z.string() }).nullable(),
  validFrom: ts, validTo: ts,
  usageLimit: z.number().int().nullable(), usedCount: z.number().int(), remaining: z.number().int().nullable(), perUserLimit: z.number().int(),
  isActive: z.boolean(), isPublic: z.boolean(), status: couponStatusSchema,
  /** Discount value currently attached to live and completed bookings (released when an unpaid booking expires). */
  redeemedPaise: z.number().int(),
  createdById: z.uuid(), createdAt: ts, updatedAt: ts,
});

export const offerSchema = z.strictObject({
  code: z.string(), description: z.string().nullable(), headline: z.string(),
  discountType, percentBps: z.number().int().nullable(), flatPaise: z.number().int().nullable(), maxDiscountPaise: z.number().int().nullable(), minBookingPaise: z.number().int(),
  scope: z.enum(['PLATFORM', 'PROPERTY']), validTo: ts,
});
