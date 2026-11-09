import type { Prisma } from '@/generated/prisma/client';
import { env } from '@/core/config/env';
import { addDays, diffDays, todayIn, toDateString } from '@/core/dates';
import { AppError, Errors } from '@/core/errors/app-error';
import { prisma } from '@/infra/db/prisma';
import { INVENTORY_HORIZON_DAYS } from '@/modules/availability/inventory.service';
import { SUMMARY, checkInInstant, freeCancellationUntil, policyTiers } from './cancellation-policy';
import { evaluateCoupon, type CouponCheck } from './coupon.rules';
import { taxPolicy } from './pricing.config';
import { priceStay, type PriceRuleInput, type StayPrice } from './pricing.engine';
import { MAX_STAY_NIGHTS, type QuoteDto, type QuoteRequest } from './quote.schema';

type Db = Prisma.TransactionClient;

export interface QuoteResult {
  dto: QuoteDto;
  /** Everything a booking needs to snapshot, so a booking can never disagree with the quote it was made from. */
  internal: {
    hostel: { id: string; ownerId: string; timezone: string; cancellationPolicy: 'FLEXIBLE' | 'MODERATE' | 'STRICT'; bookingMode: 'INSTANT' | 'APPROVAL'; checkInTime: string };
    price: StayPrice;
    nights: string[];
    coupon: CouponCheck | null;
    couponId: string | null;
  };
}

export const toRuleInput = (r: { id: string; type: 'WEEKEND' | 'DATE_RANGE'; weekdays: number[]; startDate: Date | null; endDate: Date | null; pricePaise: number | null; adjustmentBps: number | null; priority: number; isActive: boolean }): PriceRuleInput => ({
  id: r.id, type: r.type, weekdays: r.weekdays, startDate: r.startDate ? toDateString(r.startDate) : null, endDate: r.endDate ? toDateString(r.endDate) : null,
  pricePaise: r.pricePaise, adjustmentBps: r.adjustmentBps, priority: r.priority, isActive: r.isActive,
});

export const stayNights = (checkIn: string, checkOut: string) => Array.from({ length: diffDays(checkIn, checkOut) }, (_, i) => addDays(checkIn, i));

/** Lowest number of free units across the stay, per room type. A missing night (outside the open horizon) counts as 0. */
export async function availabilityFor(db: Db, roomTypeIds: string[], checkIn: string, checkOut: string): Promise<Map<string, number>> {
  const expected = diffDays(checkIn, checkOut);
  const rows = await db.$queryRaw<{ room_type_id: string; nights: number; available: number }[]>`
    SELECT room_type_id::text AS room_type_id, count(*)::int AS nights,
           min(total_units - held_units - booked_units - blocked_units)::int AS available
    FROM inventory_nights
    WHERE room_type_id = ANY(${roomTypeIds}::uuid[]) AND date >= ${checkIn}::date AND date < ${checkOut}::date
    GROUP BY room_type_id`;
  const out = new Map(roomTypeIds.map((id) => [id, 0]));
  for (const r of rows) if (r.nights === expected) out.set(r.room_type_id, Math.max(0, r.available));
  return out;
}

/**
 * Builds a priced, availability-checked quote. Read-only: it holds nothing. `userId` (optional) lets per-user
 * coupon limits be applied; anonymous callers see the discount but the limit is enforced again at booking.
 */
export async function computeQuote(db: Db, input: QuoteRequest, ctx: { userId?: string | null; now?: Date } = {}): Promise<QuoteResult> {
  const now = ctx.now ?? new Date();
  const hostel = await db.hostel.findFirst({
    where: { id: input.hostelId, status: 'APPROVED', deletedAt: null },
    include: { roomTypes: { where: { isActive: true, deletedAt: null }, include: { priceRules: { where: { isActive: true } } } } },
  });
  if (!hostel) throw Errors.notFound('Hostel');

  const today = todayIn(hostel.timezone, now);
  const nightCount = diffDays(input.checkIn, input.checkOut);
  const problems: { path: string; message: string }[] = [];
  if (nightCount < 1) problems.push({ path: 'checkOut', message: 'Check-out must be after check-in' });
  if (input.checkIn < today) problems.push({ path: 'checkIn', message: 'Check-in cannot be in the past' });
  if (nightCount > MAX_STAY_NIGHTS) problems.push({ path: 'checkOut', message: `Stays are limited to ${MAX_STAY_NIGHTS} nights` });
  if (input.checkOut > addDays(today, INVENTORY_HORIZON_DAYS)) problems.push({ path: 'checkOut', message: `Bookings open up to ${INVENTORY_HORIZON_DAYS} days ahead` });

  const ids = input.items.map((i) => i.roomTypeId);
  if (new Set(ids).size !== ids.length) problems.push({ path: 'items', message: 'List each room type only once' });
  const rooms = input.items.map((item, idx) => ({ item, room: hostel.roomTypes.find((r) => r.id === item.roomTypeId), idx }));
  for (const { item, room, idx } of rooms) {
    if (!room) { problems.push({ path: `items.${idx}.roomTypeId`, message: 'Room type not available at this property' }); continue; }
    if (item.units > room.totalUnits) problems.push({ path: `items.${idx}.units`, message: `Only ${room.totalUnits} available at this property` });
    if (nightCount > 0 && (nightCount < room.minStayNights || nightCount > room.maxStayNights)) {
      problems.push({ path: `items.${idx}.roomTypeId`, message: `${room.name}: stays must be ${room.minStayNights} to ${room.maxStayNights} nights` });
    }
  }
  if (problems.length) throw Errors.validation(problems, 'This stay cannot be booked as requested');

  const lines = rooms.map(({ item, room }) => ({ item, room: room! }));
  const totalUnits = lines.reduce((s, l) => s + l.item.units, 0);
  const capacity = lines.reduce((s, l) => s + l.item.units * l.room.maxOccupancyPerUnit, 0);
  if (input.guests > capacity) throw Errors.validation([{ path: 'guests', message: `The selected rooms host at most ${capacity} guest(s)` }]);
  if (input.guests < totalUnits) throw Errors.validation([{ path: 'guests', message: `${totalUnits} beds/rooms need at least ${totalUnits} guest(s)` }]);

  const avail = await availabilityFor(db, ids, input.checkIn, input.checkOut);
  const short = lines.filter((l) => (avail.get(l.room.id) ?? 0) < l.item.units);
  if (short.length) {
    throw new AppError('SOLD_OUT', 'Not enough availability for the selected dates', short.map((l) => ({ roomTypeId: l.room.id, name: l.room.name, requested: l.item.units, available: avail.get(l.room.id) ?? 0 })));
  }

  const nights = stayNights(input.checkIn, input.checkOut);
  const stayLines = lines.map((l) => ({ roomTypeId: l.room.id, name: l.room.name, units: l.item.units, room: { basePricePaise: l.room.basePricePaise, priceUnit: l.room.priceUnit, rules: l.room.priceRules.map(toRuleInput) } }));

  // Price once without a discount to learn the subtotal, evaluate the coupon against it, then price again with it.
  const undiscounted = priceStay({ nights, lines: stayLines, tax: taxPolicy() });
  let coupon: CouponCheck | null = null;
  if (input.couponCode) {
    const row = await db.coupon.findUnique({ where: { code: input.couponCode } });
    const redemptions = row && ctx.userId ? await db.couponRedemption.count({ where: { couponId: row.id, userId: ctx.userId } }) : undefined;
    coupon = evaluateCoupon(input.couponCode, row, { hostelId: hostel.id, subtotalPaise: undiscounted.subtotalPaise, now, userRedemptions: redemptions });
  }
  const price = coupon?.valid ? priceStay({ nights, lines: stayLines, tax: taxPolicy(), discountPaise: coupon.discountPaise }) : undiscounted;

  const checkInAt = checkInInstant(input.checkIn, hostel.checkInTime, hostel.timezone);
  const dto: QuoteDto = {
    hostelId: hostel.id, hostelName: hostel.name, currency: hostel.currency, checkIn: input.checkIn, checkOut: input.checkOut, nights: nightCount, guests: input.guests,
    items: price.lines.map((l) => ({
      roomTypeId: l.roomTypeId, name: l.name, kind: hostel.roomTypes.find((r) => r.id === l.roomTypeId)!.kind, units: l.units,
      nightly: l.nightly.map((n) => ({ date: n.date, unitPricePaise: n.unitPricePaise, taxBps: n.taxBps, isSpecialPrice: n.ruleId !== null })), lineSubtotalPaise: l.lineSubtotalPaise,
    })),
    subtotalPaise: price.subtotalPaise, discountPaise: price.discountPaise, taxPaise: price.taxPaise, serviceFeePaise: 0, totalPaise: price.totalPaise, effectiveGstBps: price.effectiveGstBps,
    coupon: coupon ? (coupon.valid ? { code: coupon.code, valid: true, discountPaise: coupon.discountPaise, description: coupon.description } : { code: coupon.code, valid: false, reason: coupon.reason, message: coupon.message }) : null,
    cancellation: { policy: hostel.cancellationPolicy, summary: SUMMARY[hostel.cancellationPolicy], freeCancellationUntil: freeCancellationUntil(hostel.cancellationPolicy, checkInAt), tiers: policyTiers(hostel.cancellationPolicy, checkInAt) },
    bookingMode: hostel.bookingMode, holdMinutes: env().BOOKING_HOLD_MINUTES, checkInTime: hostel.checkInTime, checkOutTime: hostel.checkOutTime,
  };
  return {
    dto,
    internal: { hostel: { id: hostel.id, ownerId: hostel.ownerId, timezone: hostel.timezone, cancellationPolicy: hostel.cancellationPolicy, bookingMode: hostel.bookingMode, checkInTime: hostel.checkInTime }, price, nights, coupon, couponId: coupon?.valid ? coupon.couponId : null },
  };
}

export const quoteService = {
  quote: (input: QuoteRequest, userId?: string | null) => computeQuote(prisma, input, { userId }).then((r) => r.dto),
};
