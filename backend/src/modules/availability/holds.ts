import type { Prisma } from '@/generated/prisma/client';
import { diffDays } from '@/core/dates';
import { AppError } from '@/core/errors/app-error';
import { logger } from '@/core/logger/logger';

type Db = Prisma.TransactionClient;

export interface HoldItem {
  roomTypeId: string;
  units: number;
}

/**
 * All inventory counter changes for bookings go through here, inside the booking's transaction.
 * Lock order is fixed (room type id, then date) so two bookings can never deadlock on each other.
 *
 *   reserve   held += n          (booking created: PENDING_PAYMENT / PENDING_APPROVAL)
 *   confirm   held -= n, booked += n   (payment captured)
 *   release   held -= n          (unpaid booking expired / cancelled / rejected)
 *   unsell    booked -= n        (paid booking cancelled / no-show)
 */
const ordered = (items: HoldItem[]) => [...items].sort((a, b) => (a.roomTypeId < b.roomTypeId ? -1 : 1));

async function lockNights(db: Db, roomTypeId: string, from: string, to: string) {
  await db.$queryRaw`SELECT 1 FROM inventory_nights WHERE room_type_id = ${roomTypeId}::uuid AND date >= ${from}::date AND date < ${to}::date ORDER BY date FOR UPDATE`;
}

function assertAllNights(updated: number, expected: number, what: string, roomTypeId: string) {
  if (updated !== expected) {
    // The counters disagree with the booking. Abort the whole transaction rather than drift.
    logger.error({ roomTypeId, updated, expected, what }, 'inventory counters inconsistent');
    throw new AppError('INTERNAL', 'Inventory is inconsistent for this booking; it was not changed');
  }
}

export async function reserveHold(db: Db, items: HoldItem[], checkIn: string, checkOut: string) {
  const nights = diffDays(checkIn, checkOut);
  for (const { roomTypeId, units } of ordered(items)) {
    await lockNights(db, roomTypeId, checkIn, checkOut);
    const updated = await db.$executeRaw`
      UPDATE inventory_nights SET held_units = held_units + ${units}, updated_at = now()
      WHERE room_type_id = ${roomTypeId}::uuid AND date >= ${checkIn}::date AND date < ${checkOut}::date
        AND held_units + booked_units + blocked_units + ${units} <= total_units`;
    if (updated !== nights) {
      const free = await db.$queryRaw<{ available: number | null }[]>`
        SELECT min(total_units - held_units - booked_units - blocked_units)::int AS available FROM inventory_nights
        WHERE room_type_id = ${roomTypeId}::uuid AND date >= ${checkIn}::date AND date < ${checkOut}::date`;
      throw new AppError('SOLD_OUT', 'Not enough availability for the selected dates', [{ roomTypeId, requested: units, available: Math.max(0, free[0]?.available ?? 0) }]);
    }
  }
}

export async function confirmHold(db: Db, items: HoldItem[], checkIn: string, checkOut: string) {
  const nights = diffDays(checkIn, checkOut);
  for (const { roomTypeId, units } of ordered(items)) {
    await lockNights(db, roomTypeId, checkIn, checkOut);
    const updated = await db.$executeRaw`
      UPDATE inventory_nights SET held_units = held_units - ${units}, booked_units = booked_units + ${units}, updated_at = now()
      WHERE room_type_id = ${roomTypeId}::uuid AND date >= ${checkIn}::date AND date < ${checkOut}::date AND held_units >= ${units}`;
    assertAllNights(updated, nights, 'confirm', roomTypeId);
  }
}

export async function releaseHold(db: Db, items: HoldItem[], checkIn: string, checkOut: string) {
  const nights = diffDays(checkIn, checkOut);
  for (const { roomTypeId, units } of ordered(items)) {
    await lockNights(db, roomTypeId, checkIn, checkOut);
    const updated = await db.$executeRaw`
      UPDATE inventory_nights SET held_units = held_units - ${units}, updated_at = now()
      WHERE room_type_id = ${roomTypeId}::uuid AND date >= ${checkIn}::date AND date < ${checkOut}::date AND held_units >= ${units}`;
    assertAllNights(updated, nights, 'release', roomTypeId);
  }
}

/** Frees sold nights. `fromDate` skips nights that are already in the past (they cannot be resold). */
export async function unsell(db: Db, items: HoldItem[], checkIn: string, checkOut: string, fromDate?: string) {
  const start = fromDate && fromDate > checkIn ? fromDate : checkIn;
  if (start >= checkOut) return;
  const nights = diffDays(start, checkOut);
  for (const { roomTypeId, units } of ordered(items)) {
    await lockNights(db, roomTypeId, start, checkOut);
    const updated = await db.$executeRaw`
      UPDATE inventory_nights SET booked_units = booked_units - ${units}, updated_at = now()
      WHERE room_type_id = ${roomTypeId}::uuid AND date >= ${start}::date AND date < ${checkOut}::date AND booked_units >= ${units}`;
    assertAllNights(updated, nights, 'unsell', roomTypeId);
  }
}

