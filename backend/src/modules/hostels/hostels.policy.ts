import type { Prisma } from '@/generated/prisma/client';
import type { Actor } from '@/core/context/request-context';
import { requireRole } from '@/core/auth/rbac';
import { Errors } from '@/core/errors/app-error';
import { todayIn } from '@/core/dates';

type Db = Prisma.TransactionClient;

/** Owner-scoped lookup. Someone else's hostel is indistinguishable from a missing one (404, not 403). */
export async function loadOwnedHostel(db: Db, actor: Actor, hostelId: string) {
  requireRole(actor, 'OWNER');
  const hostel = await db.hostel.findFirst({ where: { id: hostelId, ownerId: actor.id, deletedAt: null } });
  if (!hostel) throw Errors.notFound('Hostel');
  return hostel;
}

export async function loadOwnedRoomType(db: Db, actor: Actor, roomTypeId: string) {
  requireRole(actor, 'OWNER');
  const room = await db.roomType.findFirst({ where: { id: roomTypeId, deletedAt: null, hostel: { ownerId: actor.id, deletedAt: null } }, include: { hostel: true } });
  if (!room) throw Errors.notFound('Room type');
  return room;
}

const ACTIVE_BOOKING = ['HOLD', 'PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN'] as const;

/** True when guests still hold (or are about to hold) a stay at this hostel. */
export async function hasLiveBookings(db: Db, hostelId: string, timezone: string, roomTypeId?: string): Promise<boolean> {
  const today = new Date(`${todayIn(timezone)}T00:00:00.000Z`);
  const count = await db.booking.count({
    where: { hostelId, status: { in: [...ACTIVE_BOOKING] }, checkOut: { gte: today }, ...(roomTypeId ? { items: { some: { roomTypeId } } } : {}) },
  });
  return count > 0;
}
