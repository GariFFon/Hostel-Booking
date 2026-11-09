import { addDays } from '@/core/dates';
import type { Actor } from '@/core/context/request-context';
import { prisma } from '@/infra/db/prisma';
import { bookingLifecycle } from '@/modules/bookings/booking-lifecycle.service';
import { confirmedBooking, makeGuest, makeHost } from './booking';
import { D, TODAY, uniq } from './publish';
import { makeUser } from './users';

type Host = Awaited<ReturnType<typeof makeHost>>;
type Guest = Awaited<ReturnType<typeof makeGuest>>;

export const actorOf = (u: { id: string }, role: Actor['roles'][number]): Actor => ({ id: u.id, roles: [role], emailVerified: true });
export const at = (date: string, time = '06:00') => new Date(`${date}T${time}:00Z`);
export const issues = (schema: { safeParse: (v: unknown) => { error?: { issues: unknown[] } } }, v: unknown) => schema.safeParse(v).error?.issues ?? [];
export const makeAdmin = () => makeUser({ roles: ['ADMIN'] });

/** The real thing: book -> pay -> check in -> complete (stay is today..+2, completed "on" check-out day). */
export async function completedStay(host: Host, guest: Guest, over: Record<string, unknown> = {}) {
  const id = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id, { checkIn: TODAY, checkOut: addDays(TODAY, 2), ...over });
  await bookingLifecycle.checkIn(actorOf(host.owner, 'OWNER'), 'OWNER', id, undefined);
  await bookingLifecycle.complete(actorOf(host.owner, 'OWNER'), 'OWNER', id, at(addDays(TODAY, 2)));
  return id;
}

/** A COMPLETED booking row written directly: the fast path for tests that need many reviewers. */
export async function completedRow(hostelId: string, guestId: string, opts: { checkOutDaysAgo?: number; nights?: number } = {}) {
  const nights = opts.nights ?? 2;
  const checkOut = addDays(TODAY, -(opts.checkOutDaysAgo ?? 3));
  return prisma.booking.create({
    data: {
      code: `HB${uniq().toUpperCase()}${Math.floor(Math.random() * 1000)}`, guestId, hostelId, status: 'COMPLETED', checkIn: D(addDays(checkOut, -nights)), checkOut: D(checkOut), nights, guestsCount: 1,
      subtotalPaise: 100000, taxPaise: 5000, gstRateBps: 500, totalPaise: 105000, commissionBps: 1000, cancellationPolicy: 'MODERATE', bookingMode: 'INSTANT', completedAt: new Date(),
    },
  });
}

/** Inserts a review directly (bypassing the service) for a fresh completed booking by a fresh guest. */
export async function seedReview(hostelId: string, overall: number, over: { createdAt?: Date; comment?: string | null; status?: 'PUBLISHED' | 'HIDDEN'; name?: string } = {}) {
  const guest = await makeUser({ roles: ['GUEST'], name: over.name });
  const b = await completedRow(hostelId, guest.id);
  const review = await prisma.review.create({
    data: { bookingId: b.id, hostelId, guestId: guest.id, overall, comment: over.comment === undefined ? `comment ${overall}` : over.comment, status: over.status ?? 'PUBLISHED', ...(over.createdAt ? { createdAt: over.createdAt } : {}) },
  });
  return { review, guest, booking: b };
}
