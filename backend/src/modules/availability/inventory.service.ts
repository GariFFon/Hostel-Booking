import type { Prisma } from '@/generated/prisma/client';
import { Errors } from '@/core/errors/app-error';
import { addDays, diffDays, parseDate, toDateString, todayIn } from '@/core/dates';

type Db = Prisma.TransactionClient;

/** Nights of inventory kept open ahead of today. A daily job extends this (Phase 5/9). */
export const INVENTORY_HORIZON_DAYS = 365;
export const MAX_BLOCK_RANGE_NIGHTS = 366;

/** Creates any missing nightly rows in [from, from+days). Existing rows (and their counters) are untouched. */
export async function ensureInventory(db: Db, roomTypeId: string, totalUnits: number, from: string, days = INVENTORY_HORIZON_DAYS) {
  await db.$executeRaw`
    INSERT INTO inventory_nights (room_type_id, date, total_units, held_units, booked_units, blocked_units, updated_at)
    SELECT ${roomTypeId}::uuid, d::date, ${totalUnits}, 0, 0, 0, now()
    FROM generate_series(${from}::date, ${from}::date + make_interval(days => ${days - 1}), interval '1 day') AS d
    ON CONFLICT (room_type_id, date) DO NOTHING`;
}

/**
 * Changes capacity for today onward. Refuses to go below what is already held, booked or blocked on any night.
 * (The CHECK constraint is the backstop if a booking races this call.)
 */
export async function setTotalUnits(db: Db, roomTypeId: string, totalUnits: number, timezone: string) {
  const from = todayIn(timezone);
  const [row] = await db.$queryRaw<{ committed: number | null }[]>`
    SELECT max(held_units + booked_units + blocked_units)::int AS committed
    FROM inventory_nights WHERE room_type_id = ${roomTypeId}::uuid AND date >= ${from}::date`;
  const committed = row?.committed ?? 0;
  if (committed > totalUnits) {
    throw Errors.conflict(`Cannot reduce capacity below ${committed}: that many units are already booked, held or blocked on at least one future night`, { committed });
  }
  try {
    await db.$executeRaw`UPDATE inventory_nights SET total_units = ${totalUnits}, updated_at = now() WHERE room_type_id = ${roomTypeId}::uuid AND date >= ${from}::date`;
  } catch (e) {
    if (String((e as Error).message).includes('inventory_capacity')) throw Errors.conflict('A booking was just made; capacity cannot be reduced that far');
    throw e;
  }
}

export interface BlockInput {
  from: string; // first blocked night
  to: string; // last blocked night (inclusive)
  units: number; // units removed from sale per night; 0 clears the block
  reason?: string | null;
}

/** Sets the number of owner-blocked units for each night in [from, to]. Idempotent. */
export async function setBlocks(db: Db, roomTypeId: string, timezone: string, input: BlockInput) {
  const today = todayIn(timezone);
  if (input.from < today) throw Errors.validation([{ path: 'from', message: 'Cannot block past nights' }]);
  if (input.to < input.from) throw Errors.validation([{ path: 'to', message: 'End must not be before start' }]);
  const nights = diffDays(input.from, input.to) + 1;
  if (nights > MAX_BLOCK_RANGE_NIGHTS) throw Errors.validation([{ path: 'to', message: `A block can span at most ${MAX_BLOCK_RANGE_NIGHTS} nights` }]);

  const rt = await db.roomType.findUniqueOrThrow({ where: { id: roomTypeId }, select: { totalUnits: true } });
  await ensureInventory(db, roomTypeId, rt.totalUnits, input.from, nights);

  const updated = await db.$executeRaw`
    UPDATE inventory_nights SET blocked_units = ${input.units}, updated_at = now()
    WHERE room_type_id = ${roomTypeId}::uuid AND date BETWEEN ${input.from}::date AND ${input.to}::date
      AND held_units + booked_units + ${input.units} <= total_units`;
  if (updated !== nights) {
    const bad = await db.$queryRaw<{ date: Date }[]>`
      SELECT date FROM inventory_nights
      WHERE room_type_id = ${roomTypeId}::uuid AND date BETWEEN ${input.from}::date AND ${input.to}::date
        AND held_units + booked_units + ${input.units} > total_units ORDER BY date LIMIT 10`;
    throw Errors.conflict('Some nights already have too many bookings to block that many units', { nights: bad.map((r) => toDateString(r.date)) });
  }

  // Keep the human-readable record (reason) in blocked_dates in step with the counters.
  if (input.units === 0) {
    await db.blockedDate.deleteMany({ where: { roomTypeId, date: { gte: parseDate(input.from), lte: parseDate(input.to) } } });
  } else {
    await db.$executeRaw`
      INSERT INTO blocked_dates (id, room_type_id, date, units_blocked, reason, created_at)
      SELECT gen_random_uuid(), ${roomTypeId}::uuid, d::date, ${input.units}, ${input.reason ?? null}, now()
      FROM generate_series(${input.from}::date, ${input.to}::date, interval '1 day') AS d
      ON CONFLICT (room_type_id, date) DO UPDATE SET units_blocked = EXCLUDED.units_blocked, reason = EXCLUDED.reason`;
  }
  return { nights };
}

export interface CalendarNight {
  date: string;
  total: number;
  held: number;
  booked: number;
  blocked: number;
  available: number;
}

export async function getCalendar(db: Db, roomTypeId: string, from: string, to: string): Promise<CalendarNight[]> {
  if (diffDays(from, to) > MAX_BLOCK_RANGE_NIGHTS) throw Errors.validation([{ path: 'to', message: `Range is limited to ${MAX_BLOCK_RANGE_NIGHTS} nights` }]);
  const rows = await db.inventoryNight.findMany({ where: { roomTypeId, date: { gte: parseDate(from), lte: parseDate(to) } }, orderBy: { date: 'asc' } });
  return rows.map((r) => ({
    date: toDateString(r.date), total: r.totalUnits, held: r.heldUnits, booked: r.bookedUnits, blocked: r.blockedUnits,
    available: r.totalUnits - r.heldUnits - r.bookedUnits - r.blockedUnits,
  }));
}

/**
 * Keeps a rolling year of nightly rows open for every live room type (daily job). Existing rows and their counters
 * are untouched; only missing future nights are added.
 */
export async function extendHorizon(db: Db, now = new Date()): Promise<number> {
  const rooms = await db.roomType.findMany({ where: { deletedAt: null, hostel: { deletedAt: null } }, select: { id: true, totalUnits: true, hostel: { select: { timezone: true } } } });
  for (const r of rooms) await ensureInventory(db, r.id, r.totalUnits, todayIn(r.hostel.timezone, now));
  return rooms.length;
}

export { addDays };
