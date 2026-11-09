import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { POST as quote } from '@/app/api/v1/quotes/route';
import { quoteDtoSchema } from '@/modules/pricing/quote.schema';
import { call } from '../helpers/http';
import { D, TODAY, consume, nextWeekday, publish, uniq } from '../helpers/publish';
import { makeUser } from '../helpers/users';

beforeAll(async () => {
  await redis.flushdb();
});

const ask = (body: object, token?: string) => call(quote, { body, token });

async function coupon(over: Record<string, unknown> = {}) {
  const admin = await makeUser({ roles: ['ADMIN'] });
  return prisma.coupon.create({
    data: { code: uniq('CP').toUpperCase(), discountType: 'PERCENT', percentBps: 1000, maxDiscountPaise: 100000, minBookingPaise: 0, createdById: admin.id, validFrom: D(addDays(TODAY, -5)), validTo: D(addDays(TODAY, 200)), usageLimit: 100, perUserLimit: 1, ...over },
  });
}

describe('pricing a stay', () => {
  it('applies weekend uplift per night, GST per night, and matches the response contract', async () => {
    const thu = nextWeekday(4);
    const h = await publish({ rooms: [{ price: 80000, units: 6, rules: [{ type: 'WEEKEND', weekdays: [5, 6], adjustmentBps: 2000 }] }] });
    const res = await ask({ hostelId: h.hostel.id, checkIn: thu, checkOut: addDays(thu, 3), guests: 1, items: [{ roomTypeId: h.rooms[0]!.id, units: 1 }] }); // Thu, Fri, Sat
    expect(res.status).toBe(200);
    expect(quoteDtoSchema.safeParse(res.body.data).error?.issues ?? []).toEqual([]);
    const q = res.body.data;
    expect(q.items[0].nightly.map((n: { unitPricePaise: number }) => n.unitPricePaise)).toEqual([80000, 96000, 96000]);
    expect(q.items[0].nightly.map((n: { isSpecialPrice: boolean }) => n.isSpecialPrice)).toEqual([false, true, true]);
    expect(q).toMatchObject({ nights: 3, subtotalPaise: 272000, discountPaise: 0, taxPaise: 13600, serviceFeePaise: 0, totalPaise: 285600, effectiveGstBps: 500, currency: 'INR', coupon: null });
  });

  it('prices several units and several room types together, charging 18% on high tariffs', async () => {
    const d = addDays(TODAY, 15);
    const h = await publish({ rooms: [{ name: 'Dorm', price: 80000, units: 6 }, { name: 'Suite', kind: 'PRIVATE', price: 900000, units: 2, occupancy: 2 }] });
    const res = await ask({ hostelId: h.hostel.id, checkIn: d, checkOut: addDays(d, 2), guests: 4, items: [{ roomTypeId: h.rooms[0]!.id, units: 2 }, { roomTypeId: h.rooms[1]!.id, units: 1 }] });
    const q = res.body.data;
    // dorm: 2 beds x 800 x 2 nights = 3200 @5% = 160; suite: 1 x 9000 x 2 = 18000 @18% = 3240
    expect(q).toMatchObject({ subtotalPaise: 320000 + 1800000, taxPaise: 16000 + 324000, totalPaise: 2120000 + 340000 });
    expect(q.items.map((i: { lineSubtotalPaise: number }) => i.lineSubtotalPaise)).toEqual([320000, 1800000]);
    expect(q.effectiveGstBps).toBe(Math.round((340000 / 2120000) * 10000));
  });

  it('does not hold or change anything', async () => {
    const d = addDays(TODAY, 15);
    const h = await publish({ rooms: [{ units: 3 }] });
    const before = await prisma.inventoryNight.aggregate({ where: { roomTypeId: h.rooms[0]!.id }, _sum: { heldUnits: true, bookedUnits: true } });
    await ask({ hostelId: h.hostel.id, checkIn: d, checkOut: addDays(d, 2), guests: 1, items: [{ roomTypeId: h.rooms[0]!.id, units: 1 }] });
    expect(await prisma.inventoryNight.aggregate({ where: { roomTypeId: h.rooms[0]!.id }, _sum: { heldUnits: true, bookedUnits: true } })).toEqual(before);
    expect(await prisma.booking.count({ where: { hostelId: h.hostel.id } })).toBe(0);
  });

  it('describes the cancellation terms in the hostel\'s own timezone', async () => {
    const d = addDays(TODAY, 30);
    const h = await publish({ cancellationPolicy: 'MODERATE', rooms: [{}] });
    const c = (await ask({ hostelId: h.hostel.id, checkIn: d, checkOut: addDays(d, 1), guests: 1, items: [{ roomTypeId: h.rooms[0]!.id, units: 1 }] })).body.data;
    // check-in 14:00 IST = 08:30Z; MODERATE gives a full refund until 120h before
    expect(c.cancellation).toMatchObject({ policy: 'MODERATE', freeCancellationUntil: `${addDays(d, -5)}T08:30:00.000Z` });
    expect(c.cancellation.tiers).toEqual([{ until: `${addDays(d, -5)}T08:30:00.000Z`, refundPercent: 100 }, { until: `${addDays(d, -1)}T08:30:00.000Z`, refundPercent: 50 }]);
    expect(c).toMatchObject({ bookingMode: 'INSTANT', holdMinutes: 15, checkInTime: '14:00' });
  });
});

describe('coupons in quotes', () => {
  const stay = () => ({ checkIn: addDays(TODAY, 12), checkOut: addDays(TODAY, 14) });

  it('discounts before tax and reports the saving', async () => {
    const h = await publish({ rooms: [{ price: 100000, units: 4 }] });
    const c = await coupon({ percentBps: 1000 });
    const res = await ask({ hostelId: h.hostel.id, ...stay(), guests: 1, items: [{ roomTypeId: h.rooms[0]!.id, units: 1 }], couponCode: c.code.toLowerCase() }); // codes are case-insensitive
    expect(res.body.data).toMatchObject({ subtotalPaise: 200000, discountPaise: 20000, taxPaise: 9000, totalPaise: 189000, coupon: { code: c.code, valid: true, discountPaise: 20000 } });
  });

  it('explains why a code does not apply, but still returns a full-price quote', async () => {
    const h = await publish({ rooms: [{ price: 100000, units: 4 }] });
    const other = await publish({ rooms: [{}] });
    const body = (code: string) => ({ hostelId: h.hostel.id, ...stay(), guests: 1, items: [{ roomTypeId: h.rooms[0]!.id, units: 1 }], couponCode: code });
    const cases: [string, string][] = [
      [(await coupon({ isActive: false })).code, 'INACTIVE'],
      [(await coupon({ validTo: D(addDays(TODAY, -1)), validFrom: D(addDays(TODAY, -9)) })).code, 'EXPIRED'],
      [(await coupon({ minBookingPaise: 9_000_000 })).code, 'MIN_AMOUNT'],
      [(await coupon({ hostelId: other.hostel.id })).code, 'WRONG_HOSTEL'],
      [(await coupon({ usageLimit: 1, usedCount: 1 })).code, 'EXHAUSTED'],
      ['NOSUCHCODE', 'NOT_FOUND'],
    ];
    for (const [code, reason] of cases) {
      const res = await ask(body(code));
      expect(res.status).toBe(200);
      expect(res.body.data.coupon).toMatchObject({ valid: false, reason });
      expect(res.body.data).toMatchObject({ discountPaise: 0, totalPaise: 210000 });
      expect(quoteDtoSchema.safeParse(res.body.data).error?.issues ?? []).toEqual([]);
    }
  });

  it('applies per-user limits only for signed-in guests', async () => {
    const h = await publish({ rooms: [{ price: 100000, units: 4 }] });
    const c = await coupon({ perUserLimit: 1 });
    const user = await makeUser();
    const booking = await prisma.booking.create({
      data: { code: uniq('HB-').toUpperCase(), guestId: user.id, hostelId: h.hostel.id, status: 'CONFIRMED', checkIn: D(addDays(TODAY, 40)), checkOut: D(addDays(TODAY, 41)), nights: 1, guestsCount: 1, subtotalPaise: 100, taxPaise: 5, gstRateBps: 500, totalPaise: 105, commissionBps: 1000, cancellationPolicy: 'MODERATE', bookingMode: 'INSTANT' },
    });
    await prisma.couponRedemption.create({ data: { couponId: c.id, userId: user.id, bookingId: booking.id, amountPaise: 10 } });
    const body = { hostelId: h.hostel.id, ...stay(), guests: 1, items: [{ roomTypeId: h.rooms[0]!.id, units: 1 }], couponCode: c.code };
    expect((await ask(body, user.token)).body.data.coupon).toMatchObject({ valid: false, reason: 'USER_LIMIT' });
    expect((await ask(body)).body.data.coupon).toMatchObject({ valid: true }); // anonymous: enforced again at booking
    expect((await ask(body, (await makeUser()).token)).body.data.coupon).toMatchObject({ valid: true }); // someone else
    expect((await ask(body, 'not-a-token')).status).toBe(401); // a bad token is an error, not silently anonymous
  });
});

describe('rejecting impossible stays', () => {
  it('validates dates, stay limits, room selection and party size with field paths', async () => {
    const h = await publish({ rooms: [{ name: 'Dorm', units: 4, minStay: 2, maxStay: 10 }, { name: 'Pair', kind: 'PRIVATE', units: 2, occupancy: 2 }] });
    const dorm = h.rooms[0]!;
    const pair = h.rooms[1]!;
    const ci = addDays(TODAY, 20);
    const base = { hostelId: h.hostel.id, checkIn: ci, checkOut: addDays(ci, 3), guests: 1, items: [{ roomTypeId: dorm.id, units: 1 }] };
    const paths = async (over: object) => {
      const res = await ask({ ...base, ...over });
      expect(res.status).toBe(422);
      return res.body.error.details.map((d: { path: string }) => d.path);
    };
    expect(await paths({ checkOut: ci })).toContain('checkOut');
    expect(await paths({ checkIn: addDays(TODAY, -1), checkOut: addDays(TODAY, 2) })).toContain('checkIn');
    expect(await paths({ checkOut: addDays(ci, 91) })).toContain('checkOut');
    expect(await paths({ checkIn: addDays(TODAY, 400), checkOut: addDays(TODAY, 402) })).toContain('checkOut'); // beyond the open horizon
    expect(await paths({ checkOut: addDays(ci, 1) })).toContain('items.0.roomTypeId'); // below this room's 2-night minimum
    expect(await paths({ checkOut: addDays(ci, 12) })).toContain('items.0.roomTypeId'); // above its 10-night maximum
    expect(await paths({ items: [{ roomTypeId: dorm.id, units: 1 }, { roomTypeId: dorm.id, units: 1 }], guests: 2 })).toContain('items');
    expect(await paths({ items: [{ roomTypeId: '00000000-0000-4000-8000-000000000000', units: 1 }] })).toContain('items.0.roomTypeId');
    expect(await paths({ items: [{ roomTypeId: dorm.id, units: 5 }], guests: 5 })).toContain('items.0.units'); // more than exist
    expect(await paths({ guests: 3 })).toContain('guests'); // 1 bed holds 1 guest
    expect(await paths({ items: [{ roomTypeId: dorm.id, units: 3 }], guests: 2 })).toContain('guests'); // 3 beds need 3 guests
    expect((await ask({ ...base, items: [{ roomTypeId: pair.id, units: 1 }], checkOut: addDays(ci, 2), guests: 2 })).status).toBe(200); // a pair fits one private room
    expect((await ask({ ...base, items: [] })).status).toBe(422);
    expect((await ask({ ...base, checkIn: '2026-02-31' })).status).toBe(422);
  });

  it('reports exactly what is sold out (409 SOLD_OUT) and counts blocked and held units', async () => {
    const h = await publish({ rooms: [{ name: 'Dorm', units: 4 }] });
    const room = h.rooms[0]!;
    const ci = addDays(TODAY, 25), co = addDays(ci, 3);
    const body = (units: number) => ({ hostelId: h.hostel.id, checkIn: ci, checkOut: co, guests: units, items: [{ roomTypeId: room.id, units }] });
    expect((await ask(body(4))).status).toBe(200);
    await consume(room.id, addDays(ci, 1), addDays(ci, 2), 1);
    await prisma.inventoryNight.updateMany({ where: { roomTypeId: room.id, date: D(ci) }, data: { heldUnits: 1 } });
    await prisma.inventoryNight.updateMany({ where: { roomTypeId: room.id, date: D(addDays(ci, 2)) }, data: { blockedUnits: 1 } });
    const res = await ask(body(4));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'SOLD_OUT', details: [{ roomTypeId: room.id, name: 'Dorm', requested: 4, available: 3 }] });
    expect((await ask(body(3))).status).toBe(200);
  });

  it('only quotes published listings', async () => {
    const ci = addDays(TODAY, 10);
    for (const status of ['DRAFT', 'PENDING_REVIEW', 'SUSPENDED', 'REJECTED'] as const) {
      const h = await publish({ status });
      expect((await ask({ hostelId: h.hostel.id, checkIn: ci, checkOut: addDays(ci, 1), guests: 1, items: [{ roomTypeId: h.rooms[0]!.id, units: 1 }] })).status).toBe(404);
    }
    const gone = await publish({ deleted: true });
    expect((await ask({ hostelId: gone.hostel.id, checkIn: ci, checkOut: addDays(ci, 1), guests: 1, items: [{ roomTypeId: gone.rooms[0]!.id, units: 1 }] })).status).toBe(404);
    const inactive = await publish();
    await prisma.roomType.update({ where: { id: inactive.rooms[0]!.id }, data: { isActive: false } });
    expect((await ask({ hostelId: inactive.hostel.id, checkIn: ci, checkOut: addDays(ci, 1), guests: 1, items: [{ roomTypeId: inactive.rooms[0]!.id, units: 1 }] })).status).toBe(422);
  });
});
