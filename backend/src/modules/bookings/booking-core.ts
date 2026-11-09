import { randomInt, randomUUID } from 'node:crypto';
import type { BookingStatus, Prisma } from '@/generated/prisma/client';
import { toDateString, todayIn } from '@/core/dates';
import { Errors } from '@/core/errors/app-error';
import { logger } from '@/core/logger/logger';
import { invalidateInventory } from '@/infra/cache/invalidation';
import { recordAudit } from '@/modules/audit/audit.service';
import { releaseHold, unsell, type HoldItem } from '@/modules/availability/holds';
import type { LedgerLine } from './booking-ledger';
import { assertTransition, type BookingActor } from './bookings.status';

export type Tx = Prisma.TransactionClient;

export const bookingInclude = {
  items: true,
  guests: { orderBy: [{ isPrimary: 'desc' as const }, { id: 'asc' as const }] },
  history: { orderBy: { createdAt: 'asc' as const } },
  payments: { orderBy: { createdAt: 'desc' as const } },
  refunds: { orderBy: { createdAt: 'desc' as const } },
  coupon: { select: { code: true, hostelId: true } },
  review: { select: { id: true } },
  hostel: { include: { media: { where: { deletedAt: null, roomTypeId: null }, orderBy: [{ isCover: 'desc' as const }, { sortOrder: 'asc' as const }], take: 1 } } },
  guest: { select: { id: true, email: true, profile: { select: { fullName: true, phone: true } } } },
} satisfies Prisma.BookingInclude;
export type BookingFull = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

/** Work that must only happen after the transaction commits (emails, refunds, cache invalidation). */
export type Effect = () => Promise<void>;
export async function runEffects(effects: Effect[]) {
  for (const fx of effects) {
    try { await fx(); } catch (e) { logger.error({ err: (e as Error).message }, 'post-commit effect failed'); }
  }
}
export const inventoryEffect: Effect = () => invalidateInventory();

/** Locks the booking row, then loads it. Lock order everywhere is: booking, then its payments. */
export async function lockBooking(tx: Tx, id: string): Promise<BookingFull> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM bookings WHERE id = ${id}::uuid FOR UPDATE`;
  if (locked.length === 0) throw Errors.notFound('Booking');
  return tx.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
}

export const holdItems = (b: { items: { roomTypeId: string; units: number }[] }): HoldItem[] => b.items.map((i) => ({ roomTypeId: i.roomTypeId, units: i.units }));
export const stayDates = (b: { checkIn: Date; checkOut: Date }) => ({ checkIn: toDateString(b.checkIn), checkOut: toDateString(b.checkOut) });

// Unambiguous characters only (no 0/O, 1/I/L): codes get read out over the phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newBookingCode = () => `HB-${Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')}`;

export interface TransitionOptions {
  actor: BookingActor;
  actorId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  /** Extra column updates applied atomically with the status change. */
  data?: Prisma.BookingUncheckedUpdateInput;
}

/** The only place a booking's status changes: validates the transition, writes history and audit. */
export async function transition(tx: Tx, booking: BookingFull, to: BookingStatus, opts: TransitionOptions) {
  assertTransition(booking.status, to, opts.actor);
  const updated = await tx.booking.update({
    where: { id: booking.id },
    data: { ...opts.data, status: to, version: { increment: 1 } },
    include: bookingInclude,
  });
  await tx.bookingStatusHistory.create({
    data: { bookingId: booking.id, fromStatus: booking.status, toStatus: to, actorId: opts.actorId ?? null, actorRole: opts.actor, reason: opts.reason ?? null, metadata: opts.metadata as Prisma.InputJsonValue | undefined },
  });
  await recordAudit(
    { action: `booking.${to.toLowerCase()}`, entityType: 'booking', entityId: booking.id, before: { status: booking.status }, after: { status: to }, actorId: opts.actorId ?? null, actorRole: opts.actor, metadata: { code: booking.code, ...(opts.reason ? { reason: opts.reason } : {}), ...opts.metadata } },
    tx,
  );
  return updated;
}

/** Frees the inventory a booking is holding, according to its current state. */
export async function releaseInventory(tx: Tx, b: BookingFull, now: Date) {
  const { checkIn, checkOut } = stayDates(b);
  if (b.status === 'PENDING_PAYMENT' || b.status === 'PENDING_APPROVAL') await releaseHold(tx, holdItems(b), checkIn, checkOut);
  else if (b.status === 'CONFIRMED' || b.status === 'CHECKED_IN') await unsell(tx, holdItems(b), checkIn, checkOut, todayIn(b.hostel.timezone, now));
}

/** Returns an unpaid booking's coupon use to the pool. */
export async function releaseCoupon(tx: Tx, bookingId: string) {
  const r = await tx.couponRedemption.findUnique({ where: { bookingId } });
  if (!r) return;
  await tx.couponRedemption.delete({ where: { bookingId } });
  await tx.$executeRaw`UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE id = ${r.couponId}::uuid`;
}

/** Orders still waiting for money are closed when the booking goes away. */
export async function failOpenPayments(tx: Tx, bookingId: string, code: 'EXPIRED' | 'CANCELLED', reason: string) {
  await tx.payment.updateMany({ where: { bookingId, status: { in: ['CREATED', 'PENDING'] } }, data: { status: 'FAILED', failureCode: code, failureReason: reason, version: { increment: 1 } } });
}

export async function writeLedger(tx: Tx, lines: LedgerLine[], ref: { bookingId: string; paymentId?: string | null; refundId?: string | null }) {
  if (lines.length === 0) return;
  const groupId = randomUUID();
  await tx.ledgerEntry.createMany({
    data: lines.map((l) => ({ groupId, bookingId: ref.bookingId, paymentId: ref.paymentId ?? null, refundId: ref.refundId ?? null, debitAccount: l.debit, creditAccount: l.credit, amountPaise: l.amountPaise, memo: l.memo })),
  });
}

/** The payment that actually holds the guest's money for this booking, if any. */
export const capturedPayment = (b: BookingFull) => b.payments.find((p) => p.status === 'CAPTURED' || p.status === 'PARTIALLY_REFUNDED' || p.status === 'REFUNDED') ?? null;

export const fmtRupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const fmtDate = (d: Date | string) => new Date(typeof d === 'string' ? `${d}T00:00:00Z` : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
