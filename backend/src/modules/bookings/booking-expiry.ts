import { logger } from '@/core/logger/logger';
import { prisma } from '@/infra/db/prisma';
import { inventoryEffect, failOpenPayments, lockBooking, releaseCoupon, releaseInventory, runEffects, transition } from './booking-core';
import { notifyBooking } from './booking-notify';

const WAITING = ['PENDING_PAYMENT', 'PENDING_APPROVAL'] as const;

/** Expires a single booking if (and only if) it is still waiting and past its deadline. Safe under races. */
async function expireOne(id: string, now: Date): Promise<boolean> {
  const effects = await prisma.$transaction(async (tx) => {
    const b = await lockBooking(tx, id);
    if (!(WAITING as readonly string[]).includes(b.status) || !b.holdExpiresAt || b.holdExpiresAt > now) return null; // paid, cancelled or extended in the meantime
    await releaseInventory(tx, b, now);
    await releaseCoupon(tx, b.id);
    await failOpenPayments(tx, b.id, 'EXPIRED', 'The booking hold expired before payment');
    const updated = await transition(tx, b, 'EXPIRED', { actor: 'SYSTEM', reason: b.status === 'PENDING_APPROVAL' ? 'No response from the property in time' : 'Payment not completed in time', data: { holdExpiresAt: null } });
    return [inventoryEffect, ...(await notifyBooking(tx, 'expired', updated))];
  });
  if (!effects) return false;
  await runEffects(effects);
  return true;
}

/**
 * Releases bookings whose hold has run out. The worker calls this every 30 s; booking creation and payment
 * initiation also call it for the hostel involved, so correctness never depends on the worker being up.
 */
export async function expireDueBookings(opts: { now?: Date; hostelId?: string; limit?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const due = await prisma.booking.findMany({
    where: { status: { in: [...WAITING] }, holdExpiresAt: { lt: now }, ...(opts.hostelId ? { hostelId: opts.hostelId } : {}) },
    select: { id: true }, orderBy: { holdExpiresAt: 'asc' }, take: opts.limit ?? 100,
  });
  let expired = 0;
  for (const { id } of due) {
    try {
      if (await expireOne(id, now)) expired++;
    } catch (e) {
      logger.error({ err: (e as Error).message, bookingId: id }, 'could not expire booking');
    }
  }
  return expired;
}
