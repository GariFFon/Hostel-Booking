import { describe, expect, it } from 'vitest';
import { allocate, nightlyUnitPrice, priceStay, taxBpsFor, type PriceRuleInput, type RoomPricingInput, type TaxPolicy } from '@/modules/pricing/pricing.engine';
import { evaluateCoupon, type CouponInput } from '@/modules/pricing/coupon.rules';
import { freeCancellationUntil, policyTiers, refundPercentAt } from '@/modules/pricing/cancellation-policy';
import { zonedTimeToUtc } from '@/core/dates';

const TAX: TaxPolicy = { lowBps: 500, highBps: 1800, thresholdPaise: 750000 };
const rule = (o: Partial<PriceRuleInput> & { id: string }): PriceRuleInput => ({ type: 'WEEKEND', weekdays: [], startDate: null, endDate: null, pricePaise: null, adjustmentBps: null, priority: 0, isActive: true, ...o });
const room = (base: number, rules: PriceRuleInput[] = [], priceUnit: 'NIGHT' | 'MONTH' = 'NIGHT'): RoomPricingInput => ({ basePricePaise: base, priceUnit, rules });
// 2026-12-04 is a Friday, 12-05 Saturday, 12-06 Sunday, 12-07 Monday
const nights = (...d: string[]) => d;

describe('nightly price rules', () => {
  it('uses the base price when no rule applies', () => {
    expect(nightlyUnitPrice(room(80000), '2026-12-07')).toEqual({ unitPricePaise: 80000, ruleId: null });
  });

  it('applies weekend uplifts by weekday and absolute overrides by date range', () => {
    const r = room(80000, [rule({ id: 'w', weekdays: [5, 6], adjustmentBps: 2000 }), rule({ id: 'x', type: 'DATE_RANGE', startDate: '2026-12-20', endDate: '2027-01-05', pricePaise: 150000, priority: 5 })]);
    expect(nightlyUnitPrice(r, '2026-12-04')).toEqual({ unitPricePaise: 96000, ruleId: 'w' }); // Friday +20%
    expect(nightlyUnitPrice(r, '2026-12-06')).toEqual({ unitPricePaise: 80000, ruleId: null }); // Sunday: no rule
    expect(nightlyUnitPrice(r, '2026-12-25')).toEqual({ unitPricePaise: 150000, ruleId: 'x' });
    expect(nightlyUnitPrice(r, '2027-01-05').ruleId).toBe('x'); // end date inclusive
    expect(nightlyUnitPrice(r, '2027-01-06').ruleId).toBeNull();
  });

  it('rules never stack: highest priority wins, then date ranges beat weekdays, then id', () => {
    const r = room(100000, [
      rule({ id: 'a', weekdays: [6], adjustmentBps: 1000, priority: 1 }),
      rule({ id: 'b', type: 'DATE_RANGE', startDate: '2026-12-05', endDate: '2026-12-05', pricePaise: 120000, priority: 1 }),
      rule({ id: 'c', weekdays: [6], adjustmentBps: -5000, priority: 9 }),
    ]);
    expect(nightlyUnitPrice(r, '2026-12-05')).toEqual({ unitPricePaise: 50000, ruleId: 'c' }); // priority 9
    const tie = room(100000, [rule({ id: 'a', weekdays: [6], adjustmentBps: 1000, priority: 1 }), rule({ id: 'b', type: 'DATE_RANGE', startDate: '2026-12-05', endDate: '2026-12-05', pricePaise: 120000, priority: 1 })]);
    expect(nightlyUnitPrice(tie, '2026-12-05').ruleId).toBe('b'); // same priority: date range wins
  });

  it('ignores inactive rules, rounds adjustments to whole paise and never goes below the floor', () => {
    expect(nightlyUnitPrice(room(80000, [rule({ id: 'a', weekdays: [5], adjustmentBps: 5000, isActive: false })]), '2026-12-04').ruleId).toBeNull();
    expect(nightlyUnitPrice(room(33333, [rule({ id: 'a', weekdays: [5], adjustmentBps: 1234 })]), '2026-12-04').unitPricePaise).toBe(37446); // 33333 * 1.1234 = 37446.33
    expect(nightlyUnitPrice(room(1000, [rule({ id: 'a', weekdays: [5], adjustmentBps: -9000 })]), '2026-12-04').unitPricePaise).toBe(100); // floor Re 1
  });

  it('prorates monthly (PG) rents per night, including absolute rules', () => {
    const r = room(900000, [rule({ id: 'a', type: 'DATE_RANGE', startDate: '2026-12-01', endDate: '2026-12-31', pricePaise: 1200000 })], 'MONTH');
    expect(nightlyUnitPrice(r, '2026-11-30').unitPricePaise).toBe(30000);
    expect(nightlyUnitPrice(r, '2026-12-10').unitPricePaise).toBe(40000);
  });
});

describe('allocate', () => {
  it('splits proportionally without losing or inventing a paisa', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [3, 3, 4])).toEqual([3, 3, 4]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(7, [0, 0])).toEqual([0, 0]);
    for (let t = 0; t < 200; t++) {
      const w = Array.from({ length: 1 + (t % 7) }, (_, i) => ((t * 31 + i * 17) % 90) + 1);
      expect(allocate(t * 13, w).reduce((a, b) => a + b, 0)).toBe(t * 13);
    }
  });
});

describe('GST slabs', () => {
  it('5% up to and including Rs 7,500 per night, 18% above', () => {
    expect(taxBpsFor(750000, TAX)).toBe(500);
    expect(taxBpsFor(750001, TAX)).toBe(1800);
    expect(taxBpsFor(80000, TAX)).toBe(500);
  });
});

describe('priceStay', () => {
  it('prices a dorm stay with tax and no discount', () => {
    const p = priceStay({ nights: nights('2026-12-07', '2026-12-08'), tax: TAX, lines: [{ roomTypeId: 'r1', name: 'Dorm', units: 2, room: room(80000) }] });
    expect(p).toMatchObject({ subtotalPaise: 320000, discountPaise: 0, taxPaise: 16000, totalPaise: 336000, effectiveGstBps: 500 });
    expect(p.lines[0]!.nightly).toHaveLength(2);
    expect(p.lines[0]!.lineSubtotalPaise).toBe(320000);
  });

  it('chooses the slab per room-night, so a stay can straddle the threshold', () => {
    const r = room(700000, [rule({ id: 'peak', weekdays: [5, 6], adjustmentBps: 2000 })]); // Fri/Sat = 840000 > 7500
    const p = priceStay({ nights: nights('2026-12-03', '2026-12-04', '2026-12-05'), tax: TAX, lines: [{ roomTypeId: 'r', name: 'Suite', units: 1, room: r }] });
    expect(p.lines[0]!.nightly.map((n) => n.taxBps)).toEqual([500, 1800, 1800]);
    expect(p.taxPaise).toBe(35000 + 151200 + 151200);
    expect(p.effectiveGstBps).toBe(Math.round((p.taxPaise / p.subtotalPaise) * 10000));
  });

  it('applies the discount before tax, and keeps the slab of the declared (pre-discount) tariff', () => {
    const p = priceStay({ nights: nights('2026-12-07'), tax: TAX, discountPaise: 100000, lines: [{ roomTypeId: 'r', name: 'Suite', units: 1, room: room(800000) }] });
    // tariff 8000 > 7500 so 18% even though the discounted amount is 7000
    expect(p).toMatchObject({ subtotalPaise: 800000, discountPaise: 100000, taxPaise: 126000, totalPaise: 826000 });
  });

  it('clamps the discount to the subtotal and never produces a negative total', () => {
    const p = priceStay({ nights: nights('2026-12-07'), tax: TAX, discountPaise: 9_999_999, lines: [{ roomTypeId: 'r', name: 'Dorm', units: 1, room: room(80000) }] });
    expect(p).toMatchObject({ discountPaise: 80000, taxPaise: 0, totalPaise: 0, effectiveGstBps: 0 });
  });

  it('always satisfies total = subtotal - discount + tax with integer paise (matches the DB CHECK)', () => {
    for (let i = 0; i < 300; i++) {
      const base = 5000 + ((i * 7919) % 1_400_000);
      const units = 1 + (i % 4);
      const n = Array.from({ length: 1 + (i % 6) }, (_, k) => `2026-12-${String(1 + ((i + k) % 28)).padStart(2, '0')}`);
      const discount = (i * 104729) % 300_000;
      const p = priceStay({ nights: n, tax: TAX, discountPaise: discount, lines: [{ roomTypeId: 'r', name: 'x', units, room: room(base, [rule({ id: 'w', weekdays: [5, 6], adjustmentBps: i % 3000 })]) }] });
      expect(Number.isInteger(p.totalPaise) && Number.isInteger(p.taxPaise)).toBe(true);
      expect(p.totalPaise).toBe(p.subtotalPaise - p.discountPaise + p.taxPaise);
      expect(p.subtotalPaise).toBe(p.lines.reduce((s, l) => s + l.lineSubtotalPaise, 0));
    }
  });

  it('prices several room types in one stay', () => {
    const p = priceStay({ nights: nights('2026-12-07'), tax: TAX, lines: [{ roomTypeId: 'a', name: 'Dorm', units: 2, room: room(80000) }, { roomTypeId: 'b', name: 'Private', units: 1, room: room(200000) }] });
    expect(p.subtotalPaise).toBe(360000);
    expect(p.lines.map((l) => l.lineSubtotalPaise)).toEqual([160000, 200000]);
  });
});

describe('coupons', () => {
  const NOW = new Date('2026-12-01T00:00:00Z');
  const base: CouponInput = { id: 'c1', code: 'WELCOME10', description: '10% off', discountType: 'PERCENT', percentBps: 1000, flatPaise: null, maxDiscountPaise: 50000, minBookingPaise: 100000, hostelId: null, validFrom: new Date('2026-01-01'), validTo: new Date('2027-01-01'), usageLimit: 10, usedCount: 0, perUserLimit: 1, isActive: true };
  const ctx = { hostelId: 'h1', subtotalPaise: 200000, now: NOW };

  it('computes percent (with cap) and flat discounts, never above the subtotal', () => {
    expect(evaluateCoupon('WELCOME10', base, ctx)).toMatchObject({ valid: true, discountPaise: 20000 });
    expect(evaluateCoupon('WELCOME10', base, { ...ctx, subtotalPaise: 900000 })).toMatchObject({ valid: true, discountPaise: 50000 }); // capped
    const flat = { ...base, discountType: 'FLAT' as const, percentBps: null, flatPaise: 20000, maxDiscountPaise: null };
    expect(evaluateCoupon('X', flat, ctx)).toMatchObject({ valid: true, discountPaise: 20000 });
    expect(evaluateCoupon('X', { ...flat, flatPaise: 999999, minBookingPaise: 0 }, { ...ctx, subtotalPaise: 5000 })).toMatchObject({ discountPaise: 5000 });
    expect(evaluateCoupon('P', { ...base, percentBps: 10000, maxDiscountPaise: null, minBookingPaise: 0 }, { ...ctx, subtotalPaise: 80000 })).toMatchObject({ discountPaise: 80000 }); // 100% = a free stay
  });

  it.each([
    ['unknown code', null, ctx, 'NOT_FOUND'],
    ['inactive', { ...base, isActive: false }, ctx, 'INACTIVE'],
    ['not started', { ...base, validFrom: new Date('2027-02-01'), validTo: new Date('2027-03-01') }, ctx, 'NOT_STARTED'],
    ['expired', { ...base, validTo: new Date('2026-06-01') }, ctx, 'EXPIRED'],
    ['exhausted', { ...base, usedCount: 10 }, ctx, 'EXHAUSTED'],
    ['other hostel', { ...base, hostelId: 'h2' }, ctx, 'WRONG_HOSTEL'],
    ['below minimum', base, { ...ctx, subtotalPaise: 50000 }, 'MIN_AMOUNT'],
    ['already used by this user', base, { ...ctx, userRedemptions: 1 }, 'USER_LIMIT'],
  ] as const)('rejects: %s', (_n, coupon, c, reason) => {
    const res = evaluateCoupon('CODE', coupon as CouponInput | null, c);
    expect(res).toMatchObject({ valid: false, reason });
    expect((res as { message: string }).message.length).toBeGreaterThan(5);
  });

  it('formats the minimum spend in rupees', () => {
    expect(evaluateCoupon('C', base, { ...ctx, subtotalPaise: 100 })).toMatchObject({ message: 'Spend ₹1,000 or more to use this code' });
  });
});

describe('timezones', () => {
  it('converts hostel wall-clock time to UTC (India has no DST)', () => {
    expect(zonedTimeToUtc('2026-12-10', '14:00', 'Asia/Kolkata').toISOString()).toBe('2026-12-10T08:30:00.000Z');
  });
  it('handles DST on both sides of a transition', () => {
    expect(zonedTimeToUtc('2026-03-07', '14:00', 'America/New_York').toISOString()).toBe('2026-03-07T19:00:00.000Z'); // EST
    expect(zonedTimeToUtc('2026-03-09', '14:00', 'America/New_York').toISOString()).toBe('2026-03-09T18:00:00.000Z'); // EDT
  });
});

describe('cancellation policies', () => {
  const checkIn = zonedTimeToUtc('2026-12-10', '14:00', 'Asia/Kolkata'); // 08:30Z
  const hoursBefore = (h: number) => new Date(checkIn.getTime() - h * 3_600_000);

  it('FLEXIBLE: full refund until 24h before', () => {
    expect(refundPercentAt('FLEXIBLE', checkIn, hoursBefore(24))).toBe(100);
    expect(refundPercentAt('FLEXIBLE', checkIn, hoursBefore(23.9))).toBe(0);
  });
  it('MODERATE: 100% to 5 days, 50% to 24h, then nothing', () => {
    expect(refundPercentAt('MODERATE', checkIn, hoursBefore(120))).toBe(100);
    expect(refundPercentAt('MODERATE', checkIn, hoursBefore(119))).toBe(50);
    expect(refundPercentAt('MODERATE', checkIn, hoursBefore(24))).toBe(50);
    expect(refundPercentAt('MODERATE', checkIn, hoursBefore(23))).toBe(0);
  });
  it('STRICT: 50% to 7 days, then nothing; after check-in nothing for any policy', () => {
    expect(refundPercentAt('STRICT', checkIn, hoursBefore(168))).toBe(50);
    expect(refundPercentAt('STRICT', checkIn, hoursBefore(167))).toBe(0);
    for (const p of ['FLEXIBLE', 'MODERATE', 'STRICT'] as const) expect(refundPercentAt(p, checkIn, new Date(checkIn.getTime() + 1))).toBe(0);
  });
  it('exposes deadlines for display', () => {
    expect(freeCancellationUntil('MODERATE', checkIn)).toBe(hoursBefore(120).toISOString());
    expect(freeCancellationUntil('STRICT', checkIn)).toBeNull();
    expect(policyTiers('MODERATE', checkIn).map((t) => t.refundPercent)).toEqual([100, 50]);
  });
});
