export interface CouponInput {
  id: string;
  code: string;
  description: string | null;
  discountType: 'PERCENT' | 'FLAT';
  percentBps: number | null;
  flatPaise: number | null;
  maxDiscountPaise: number | null;
  minBookingPaise: number;
  hostelId: string | null;
  validFrom: Date;
  validTo: Date;
  usageLimit: number | null;
  usedCount: number;
  perUserLimit: number;
  isActive: boolean;
}

export type CouponFailure = 'NOT_FOUND' | 'INACTIVE' | 'NOT_STARTED' | 'EXPIRED' | 'EXHAUSTED' | 'WRONG_HOSTEL' | 'MIN_AMOUNT' | 'USER_LIMIT';

export type CouponCheck =
  | { valid: true; couponId: string; code: string; description: string | null; discountPaise: number }
  | { valid: false; code: string; reason: CouponFailure; message: string };

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function evaluateCoupon(
  code: string,
  coupon: CouponInput | null,
  ctx: { hostelId: string; subtotalPaise: number; now: Date; userRedemptions?: number },
): CouponCheck {
  const fail = (reason: CouponFailure, message: string): CouponCheck => ({ valid: false, code, reason, message });
  if (!coupon) return fail('NOT_FOUND', 'This code is not valid');
  if (!coupon.isActive) return fail('INACTIVE', 'This code is no longer active');
  if (ctx.now < coupon.validFrom) return fail('NOT_STARTED', 'This code is not active yet');
  if (ctx.now > coupon.validTo) return fail('EXPIRED', 'This code has expired');
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return fail('EXHAUSTED', 'This code has been fully redeemed');
  if (coupon.hostelId && coupon.hostelId !== ctx.hostelId) return fail('WRONG_HOSTEL', 'This code is not valid for this property');
  if (ctx.subtotalPaise < coupon.minBookingPaise) return fail('MIN_AMOUNT', `Spend ${rupees(coupon.minBookingPaise)} or more to use this code`);
  if (ctx.userRedemptions !== undefined && ctx.userRedemptions >= coupon.perUserLimit) return fail('USER_LIMIT', 'You have already used this code');

  let discount = coupon.discountType === 'PERCENT' ? Math.round((ctx.subtotalPaise * (coupon.percentBps ?? 0)) / 10_000) : (coupon.flatPaise ?? 0);
  if (coupon.maxDiscountPaise !== null) discount = Math.min(discount, coupon.maxDiscountPaise);
  discount = Math.min(discount, ctx.subtotalPaise); // a coupon can cover everything: the booking is then free and confirms without payment
  return { valid: true, couponId: coupon.id, code: coupon.code, description: coupon.description, discountPaise: discount };
}
