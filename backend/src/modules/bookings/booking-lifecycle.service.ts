import { requireRole } from '@/core/auth/rbac';
import { env } from '@/core/config/env';
import type { Actor } from '@/core/context/request-context';
import { addDays, toDateString, todayIn } from '@/core/dates';
import { Errors } from '@/core/errors/app-error';
import { logger } from '@/core/logger/logger';
import { prisma } from '@/infra/db/prisma';
import { confirmHold, unsell } from '@/modules/availability/holds';
import { settlementEntries } from './booking-ledger';
import {
  bookingInclude, capturedPayment, holdItems, inventoryEffect, lockBooking, releaseCoupon, releaseInventory, runEffects, stayDates, transition, writeLedger, type BookingFull, type Effect, type Tx,
} from './booking-core';
import { notifyBooking } from './booking-notify';
import { toBookingDto, type Viewer } from './bookings.mapper';
import type { BookingActor } from './bookings.status';

type Role = Extract<Viewer, 'OWNER' | 'ADMIN'>;

/** Locks the booking and makes sure this owner/admin may act on it. Someone else's booking is a plain 404. */
async function loadForHost(tx: Tx, actor: Actor, role: Role, id: string): Promise<BookingFull> {
  requireRole(actor, role);
  const b = await lockBooking(tx, id);
  if (role === 'OWNER' && b.hostel.ownerId !== actor.id) throw Errors.notFound('Booking');
  return b;
}

/** Releases escrow for a stay that is over (or a no-show whose payment is retained in full). */
async function settle(tx: Tx, b: BookingFull) {
  const paid = capturedPayment(b);
  if (!paid || paid.status === 'REFUNDED') return;
  await writeLedger(tx, settlementEntries({
    subtotalPaise: b.subtotalPaise, discountPaise: b.discountPaise, taxPaise: b.taxPaise, totalPaise: b.totalPaise, commissionBps: b.commissionBps,
    platformFundedDiscount: b.coupon !== null && b.coupon.hostelId === null, // an admin (platform-wide) coupon is paid for by the platform
  }), { bookingId: b.id, paymentId: paid.id });
}

const asActor = (role: Role | 'SYSTEM'): BookingActor => role;

async function finish(actor: Actor | null, role: Role, id: string, fn: (tx: Tx, b: BookingFull) => Promise<{ effects: Effect[] }>, now: Date) {
  const result = await prisma.$transaction(async (tx) => {
    const b = actor ? await loadForHost(tx, actor, role, id) : await lockBooking(tx, id);
    return { ...(await fn(tx, b)), id: b.id };
  });
  await runEffects(result.effects);
  const fresh = await prisma.booking.findUniqueOrThrow({ where: { id: result.id }, include: bookingInclude });
  return toBookingDto(fresh, role, now);
}

export const bookingLifecycle = {
  /** Request-to-book: the owner accepts, and the guest then has a window to pay. */
  async approve(actor: Actor, role: Role, id: string, now = new Date()) {
    return finish(actor, role, id, async (tx, b) => {
      if (b.status === 'PENDING_APPROVAL' && b.holdExpiresAt && b.holdExpiresAt <= now) throw Errors.conflict('This request has already expired');
      const free = b.totalPaise === 0;
      const updated = await transition(tx, b, free ? 'CONFIRMED' : 'PENDING_PAYMENT', {
        actor: asActor(role), actorId: actor.id, reason: 'Request accepted',
        data: free ? { confirmedAt: now, holdExpiresAt: null, approvalDeadline: null } : { holdExpiresAt: new Date(now.getTime() + env().APPROVAL_PAYMENT_WINDOW_MINUTES * 60_000) },
      });
      if (free) { const { checkIn, checkOut } = stayDates(b); await confirmHold(tx, holdItems(b), checkIn, checkOut); }
      return { effects: [...(free ? [inventoryEffect] : []), ...(await notifyBooking(tx, free ? 'confirmed' : 'approved', updated))] };
    }, now);
  },

  async reject(actor: Actor, role: Role, id: string, reason: string, now = new Date()) {
    return finish(actor, role, id, async (tx, b) => {
      await releaseInventory(tx, b, now);
      await releaseCoupon(tx, b.id);
      const updated = await transition(tx, b, 'REJECTED', { actor: asActor(role), actorId: actor.id, reason, data: { holdExpiresAt: null, cancelReason: reason } });
      return { effects: [inventoryEffect, ...(await notifyBooking(tx, 'rejected', updated, { reason }))] };
    }, now);
  },

  async checkIn(actor: Actor, role: Role, id: string, notes: string | undefined, now = new Date()) {
    return finish(actor, role, id, async (tx, b) => {
      const today = todayIn(b.hostel.timezone, now);
      if (b.status === 'CONFIRMED' && today < toDateString(b.checkIn)) throw Errors.conflict(`Check-in opens on ${toDateString(b.checkIn)}`);
      if (b.status === 'CONFIRMED' && today >= toDateString(b.checkOut)) throw Errors.conflict('This stay has already ended');
      await transition(tx, b, 'CHECKED_IN', { actor: asActor(role), actorId: actor.id, reason: notes ?? null, data: { checkedInAt: now } });
      return { effects: [] };
    }, now);
  },

  async complete(actor: Actor | null, role: Role | 'SYSTEM', id: string, now = new Date()) {
    return finish(actor, role === 'SYSTEM' ? 'ADMIN' : role, id, async (tx, b) => {
      const today = todayIn(b.hostel.timezone, now);
      if (role !== 'SYSTEM' && b.status === 'CHECKED_IN' && today < toDateString(b.checkOut)) throw Errors.conflict(`The stay ends on ${toDateString(b.checkOut)}`);
      const updated = await transition(tx, b, 'COMPLETED', { actor: asActor(role), actorId: actor?.id ?? null, data: { completedAt: now } });
      await settle(tx, updated);
      return { effects: await notifyBooking(tx, 'completed', updated) };
    }, now);
  },

  /** The guest never arrived: the amount paid is kept, and the nights still ahead go back on sale. */
  async noShow(actor: Actor | null, role: Role | 'SYSTEM', id: string, now = new Date()) {
    return finish(actor, role === 'SYSTEM' ? 'ADMIN' : role, id, async (tx, b) => {
      const today = todayIn(b.hostel.timezone, now);
      if (role !== 'SYSTEM' && b.status === 'CONFIRMED' && today < toDateString(b.checkIn)) throw Errors.conflict(`A no-show can only be recorded from ${toDateString(b.checkIn)}`);
      const { checkIn, checkOut } = stayDates(b);
      const updated = await transition(tx, b, 'NO_SHOW', { actor: asActor(role), actorId: actor?.id ?? null, reason: role === 'SYSTEM' ? 'Guest did not arrive' : null, data: { completedAt: now } });
      await unsell(tx, holdItems(b), checkIn, checkOut, today);
      await settle(tx, updated);
      return { effects: [inventoryEffect, ...(await notifyBooking(tx, 'no_show', updated))] };
    }, now);
  },

  // ───────── scheduled sweeps ─────────

  /** Auto-completes finished stays and records no-shows for guests who never came (2 days after the check-in date). */
  async sweep(now = new Date(), opts: { hostelId?: string } = {}): Promise<{ completed: number; noShows: number }> {
    const utcToday = toDateString(now);
    const hostelScope = opts.hostelId ? { hostelId: opts.hostelId } : {};
    const finished = await prisma.booking.findMany({ where: { ...hostelScope, status: 'CHECKED_IN', checkOut: { lte: new Date(`${addDays(utcToday, 1)}T00:00:00.000Z`) } }, include: { hostel: { select: { timezone: true } } }, take: 100 });
    const absent = await prisma.booking.findMany({ where: { ...hostelScope, status: 'CONFIRMED', checkIn: { lte: new Date(`${utcToday}T00:00:00.000Z`) } }, include: { hostel: { select: { timezone: true } } }, take: 100 });
    let completed = 0, noShows = 0;
    for (const b of finished) {
      if (todayIn(b.hostel.timezone, now) <= toDateString(b.checkOut)) continue;
      try { await bookingLifecycle.complete(null, 'SYSTEM', b.id, now); completed++; } catch (e) { logger.error({ err: (e as Error).message, bookingId: b.id }, 'auto-complete failed'); }
    }
    for (const b of absent) {
      if (todayIn(b.hostel.timezone, now) < addDays(toDateString(b.checkIn), 2)) continue;
      try { await bookingLifecycle.noShow(null, 'SYSTEM', b.id, now); noShows++; } catch (e) { logger.error({ err: (e as Error).message, bookingId: b.id }, 'auto no-show failed'); }
    }
    return { completed, noShows };
  },

  /** One reminder per confirmed booking, sent the day before check-in (hostel's local date). */
  async sendReminders(now = new Date(), opts: { hostelId?: string } = {}): Promise<number> {
    const utcToday = toDateString(now);
    const candidates = await prisma.booking.findMany({
      where: { ...(opts.hostelId ? { hostelId: opts.hostelId } : {}), status: 'CONFIRMED', checkIn: { gte: new Date(`${addDays(utcToday, -1)}T00:00:00.000Z`), lte: new Date(`${addDays(utcToday, 2)}T00:00:00.000Z`) } },
      include: bookingInclude, take: 200,
    });
    let sent = 0;
    for (const b of candidates) {
      if (toDateString(b.checkIn) !== addDays(todayIn(b.hostel.timezone, now), 1)) continue;
      const already = await prisma.notification.count({ where: { userId: b.guestId, type: 'BOOKING_REMINDER', data: { path: ['bookingId'], equals: b.id } } });
      if (already) continue;
      const effects = await prisma.$transaction((tx) => notifyBooking(tx, 'reminder', b));
      await runEffects(effects);
      sent++;
    }
    return sent;
  },
};
