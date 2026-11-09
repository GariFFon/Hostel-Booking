import type { BookingStatus } from '@/generated/prisma/client';
import { Errors } from '@/core/errors/app-error';

export type BookingActor = 'GUEST' | 'OWNER' | 'ADMIN' | 'SYSTEM';

/**
 * The only legal booking transitions and who may perform them. Request-to-book listings go
 * PENDING_APPROVAL -> (owner approves) -> PENDING_PAYMENT -> CONFIRMED; instant-book starts at PENDING_PAYMENT.
 * HOLD is legacy/unused (creation lands directly in the right state).
 */
export const TRANSITIONS: Record<BookingStatus, Partial<Record<BookingStatus, BookingActor[]>>> = {
  HOLD: { PENDING_PAYMENT: ['SYSTEM'], PENDING_APPROVAL: ['SYSTEM'], EXPIRED: ['SYSTEM'] },
  PENDING_PAYMENT: { CONFIRMED: ['SYSTEM'], EXPIRED: ['SYSTEM'], CANCELLED_BY_GUEST: ['GUEST'], CANCELLED_BY_OWNER: ['OWNER', 'ADMIN'] },
  PENDING_APPROVAL: { PENDING_PAYMENT: ['OWNER', 'ADMIN'], CONFIRMED: ['OWNER', 'ADMIN'], REJECTED: ['OWNER', 'ADMIN'], EXPIRED: ['SYSTEM'], CANCELLED_BY_GUEST: ['GUEST'], CANCELLED_BY_OWNER: ['ADMIN'] },
  CONFIRMED: { CHECKED_IN: ['OWNER', 'ADMIN'], CANCELLED_BY_GUEST: ['GUEST'], CANCELLED_BY_OWNER: ['OWNER', 'ADMIN'], NO_SHOW: ['OWNER', 'ADMIN', 'SYSTEM'] },
  CHECKED_IN: { COMPLETED: ['OWNER', 'ADMIN', 'SYSTEM'] },
  COMPLETED: {}, EXPIRED: {}, CANCELLED_BY_GUEST: {}, CANCELLED_BY_OWNER: {}, REJECTED: {}, NO_SHOW: {},
};

export const TERMINAL: BookingStatus[] = ['COMPLETED', 'EXPIRED', 'CANCELLED_BY_GUEST', 'CANCELLED_BY_OWNER', 'REJECTED', 'NO_SHOW'];
/** States in which the booking holds inventory but has not been paid for. */
export const UNPAID_HOLDING: BookingStatus[] = ['PENDING_PAYMENT', 'PENDING_APPROVAL'];
/** States that count against availability as sold. */
export const SOLD: BookingStatus[] = ['CONFIRMED', 'CHECKED_IN'];

export function assertTransition(from: BookingStatus, to: BookingStatus, actor: BookingActor) {
  const allowed = TRANSITIONS[from][to];
  if (!allowed) throw Errors.invalidTransition(from, to);
  if (!allowed.includes(actor)) throw Errors.forbidden(`A ${actor.toLowerCase()} cannot move a booking from ${from} to ${to}`);
}

export const canTransition = (from: BookingStatus, to: BookingStatus, actor: BookingActor) => Boolean(TRANSITIONS[from][to]?.includes(actor));
