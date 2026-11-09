import { Prisma, type BookingStatus } from '@/generated/prisma/client';
import { requireRole, requireVerifiedEmail } from '@/core/auth/rbac';
import { env } from '@/core/config/env';
import type { Actor } from '@/core/context/request-context';
import { Errors, AppError } from '@/core/errors/app-error';
import { cursorArgs, toPage } from '@/core/http/pagination';
import { rateLimit } from '@/core/rate-limit/rate-limit';
import { prisma } from '@/infra/db/prisma';
import { enqueue } from '@/infra/queue/queue';
import { recordAudit } from '@/modules/audit/audit.service';
import { confirmHold, reserveHold } from '@/modules/availability/holds';
import { evaluateCoupon, type CouponInput } from '@/modules/pricing/coupon.rules';
import { computeQuote } from '@/modules/pricing/quote.service';
import { cancellationEntries } from './booking-ledger';
import {
  bookingInclude, capturedPayment, failOpenPayments, holdItems, inventoryEffect, lockBooking, newBookingCode, releaseCoupon, releaseInventory, runEffects, stayDates, transition, writeLedger,
  type BookingFull, type Effect,
} from './booking-core';
import { expireDueBookings } from './booking-expiry';
import { notifyBooking } from './booking-notify';
import { refundPreview, toBookingDto, toBookingSummary, type Viewer } from './bookings.mapper';
import type { CreateBookingInput } from './bookings.schema';
import { TERMINAL, UNPAID_HOLDING } from './bookings.status';
import { refundsService } from '@/modules/payments/refunds.service';

const UPCOMING: BookingStatus[] = ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN'];

/** Gender rules: a women-only listing hosts only women, and a gender-specific dorm needs a matching guest per bed. */
function assertGenderRules(input: CreateBookingInput, hostel: { genderPolicy: 'MIXED' | 'MALE_ONLY' | 'FEMALE_ONLY' }, rooms: { id: string; name: string; gender: 'MIXED' | 'MALE' | 'FEMALE' }[]) {
  const problems: { path: string; message: string }[] = [];
  const need = hostel.genderPolicy === 'MALE_ONLY' ? 'MALE' : hostel.genderPolicy === 'FEMALE_ONLY' ? 'FEMALE' : null;
  if (need) {
    input.guests.forEach((g, i) => { if (g.gender !== need) problems.push({ path: `guests.${i}.gender`, message: `This property is ${need === 'MALE' ? 'men' : 'women'}-only: every guest's gender must be ${need}` }); });
  }
  for (const item of input.items) {
    const room = rooms.find((r) => r.id === item.roomTypeId);
    if (!room || room.gender === 'MIXED') continue;
    const matching = input.guests.filter((g) => g.gender === room.gender).length;
    if (matching < item.units) problems.push({ path: 'guests', message: `${room.name} is ${room.gender.toLowerCase()}-only: provide ${item.units} ${room.gender.toLowerCase()} guest(s) with their gender` });
  }
  if (problems.length) throw Errors.validation(problems, 'The guests do not match the room rules');
}

async function loadViewable(actor: Actor, id: string, viewer: Viewer): Promise<BookingFull> {
  const where: Prisma.BookingWhereInput = viewer === 'GUEST' ? { id, guestId: actor.id } : viewer === 'OWNER' ? { id, hostel: { ownerId: actor.id } } : { id };
  if (viewer === 'OWNER') requireRole(actor, 'OWNER');
  if (viewer === 'ADMIN') requireRole(actor, 'ADMIN');
  const b = await prisma.booking.findFirst({ where, include: bookingInclude });
  if (!b) throw Errors.notFound('Booking');
  return b;
}

export const bookingsService = {
  /**
   * Creates a booking and holds its beds in one transaction. Overbooking is impossible: the hold is a conditional UPDATE under
   * row locks (and the CHECK constraint backs it up), so concurrent requests for the last beds yield exactly one winner.
   */
  async create(actor: Actor, input: CreateBookingInput, idempotencyKey: string, now = new Date()) {
    requireVerifiedEmail(actor);
    await rateLimit({ bucket: `book:${actor.id}`, limit: 10, windowSeconds: 60 });
    await expireDueBookings({ now, hostelId: input.hostelId, limit: 25 }); // holds that ran out must not block this guest

    let effects: Effect[] = [];
    try {
      const bookingId = await prisma.$transaction(async (tx) => {
        const { dto: quote, internal } = await computeQuote(tx, { hostelId: input.hostelId, checkIn: input.checkIn, checkOut: input.checkOut, guests: input.guests.length, items: input.items, couponCode: input.couponCode }, { userId: actor.id, now });
        if (internal.hostel.ownerId === actor.id) throw Errors.forbidden('You cannot book your own property');
        if (input.expectedTotalPaise !== undefined && input.expectedTotalPaise !== quote.totalPaise) {
          throw new AppError('PRICE_CHANGED', 'The price changed since you last looked. Review the new total and confirm again.', { expectedTotalPaise: input.expectedTotalPaise, totalPaise: quote.totalPaise });
        }
        // Serialise this guest's concurrent requests: a count-then-insert would otherwise let N parallel requests all see "under the cap".
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`open-bookings:${actor.id}`}))`; // void result: executeRaw, not queryRaw
        const open = await tx.booking.count({ where: { guestId: actor.id, status: { in: UNPAID_HOLDING } } });
        if (open >= env().MAX_OPEN_BOOKINGS_PER_USER) throw Errors.conflict(`You already have ${open} bookings waiting for payment or approval. Complete or cancel one first.`);

        const [hostel, rooms] = await Promise.all([
          tx.hostel.findUniqueOrThrow({ where: { id: input.hostelId }, select: { genderPolicy: true } }),
          tx.roomType.findMany({ where: { id: { in: input.items.map((i) => i.roomTypeId) } }, select: { id: true, name: true, gender: true } }),
        ]);
        assertGenderRules(input, hostel, rooms);

        // Coupon: re-validated under a row lock, because usage limits can race (two guests, one remaining use).
        let coupon: { id: string; discountPaise: number } | null = null;
        if (input.couponCode) {
          if (!quote.coupon?.valid) throw Errors.validation([{ path: 'couponCode', message: quote.coupon?.valid === false ? quote.coupon.message : 'This code is not valid' }]);
          await tx.$queryRaw`SELECT id FROM coupons WHERE code = ${input.couponCode} FOR UPDATE`;
          const row = await tx.coupon.findUnique({ where: { code: input.couponCode } });
          const used = row ? await tx.couponRedemption.count({ where: { couponId: row.id, userId: actor.id } }) : 0;
          const check = evaluateCoupon(input.couponCode, row as CouponInput | null, { hostelId: input.hostelId, subtotalPaise: quote.subtotalPaise, now, userRedemptions: used });
          if (!check.valid) throw Errors.validation([{ path: 'couponCode', message: check.message }]);
          coupon = { id: check.couponId, discountPaise: check.discountPaise };
          await tx.coupon.update({ where: { id: check.couponId }, data: { usedCount: { increment: 1 } } });
        }

        await reserveHold(tx, internal.price.lines.map((l) => ({ roomTypeId: l.roomTypeId, units: l.units })), input.checkIn, input.checkOut);

        const approval = internal.hostel.bookingMode === 'APPROVAL';
        const expires = new Date(now.getTime() + (approval ? env().APPROVAL_WINDOW_HOURS * 3600_000 : env().BOOKING_HOLD_MINUTES * 60_000));
        // Pick a free code up front. A failed INSERT would abort this whole transaction in Postgres (no retrying inside it); the
        // unique constraint remains the backstop for the vanishingly rare race between this check and the insert.
        let code = newBookingCode();
        for (let attempt = 0; attempt < 5 && (await tx.booking.findUnique({ where: { code }, select: { id: true } })); attempt++) code = newBookingCode();
        const created = await tx.booking.create({
              data: {
                code, guestId: actor.id, hostelId: input.hostelId, status: approval ? 'PENDING_APPROVAL' : 'PENDING_PAYMENT',
                checkIn: new Date(`${input.checkIn}T00:00:00.000Z`), checkOut: new Date(`${input.checkOut}T00:00:00.000Z`), nights: quote.nights, guestsCount: input.guests.length, currency: quote.currency,
                subtotalPaise: quote.subtotalPaise, taxPaise: quote.taxPaise, gstRateBps: quote.effectiveGstBps, serviceFeePaise: 0, discountPaise: quote.discountPaise, totalPaise: quote.totalPaise,
                commissionBps: env().PLATFORM_COMMISSION_BPS, cancellationPolicy: internal.hostel.cancellationPolicy, bookingMode: internal.hostel.bookingMode, couponId: coupon?.id ?? null,
                specialRequests: input.specialRequests ?? null, contactPhone: input.contactPhone, holdExpiresAt: expires, approvalDeadline: approval ? expires : null, idempotencyKey,
                items: { create: internal.price.lines.map((l) => ({ roomTypeId: l.roomTypeId, units: l.units, lineTotalPaise: l.lineSubtotalPaise, roomNameSnapshot: l.name, nightlyBreakdown: l.nightly.map((n) => ({ date: n.date, unitPricePaise: n.unitPricePaise, taxBps: n.taxBps })) })) },
                guests: { create: input.guests.map((g, i) => ({ fullName: g.fullName, gender: g.gender ?? null, age: g.age ?? null, idType: g.idType ?? null, idLast4: g.idLast4 ?? null, isPrimary: i === 0 })) },
                history: { create: [{ fromStatus: null, toStatus: approval ? 'PENDING_APPROVAL' : 'PENDING_PAYMENT', actorId: actor.id, actorRole: 'GUEST' }] },
              },
              select: { id: true },
            });
        if (coupon) await tx.couponRedemption.create({ data: { couponId: coupon.id, userId: actor.id, bookingId: created.id, amountPaise: coupon.discountPaise } });
        await recordAudit({ action: 'booking.created', entityType: 'booking', entityId: created.id, after: { status: approval ? 'PENDING_APPROVAL' : 'PENDING_PAYMENT', totalPaise: quote.totalPaise, hostelId: input.hostelId, checkIn: input.checkIn, checkOut: input.checkOut } }, tx);

        let booking = await tx.booking.findUniqueOrThrow({ where: { id: created.id }, include: bookingInclude });
        effects = [inventoryEffect];
        if (approval) effects.push(...(await notifyBooking(tx, 'requested', booking)));
        else if (booking.totalPaise === 0) {
          // 100% discount: nothing to pay, so the booking confirms immediately.
          const { checkIn, checkOut } = stayDates(booking);
          await confirmHold(tx, holdItems(booking), checkIn, checkOut);
          booking = await transition(tx, booking, 'CONFIRMED', { actor: 'SYSTEM', reason: 'No payment due', data: { confirmedAt: now, holdExpiresAt: null } });
          effects.push(...(await notifyBooking(tx, 'confirmed', booking)));
        }
        return created.id;
      });
      await runEffects(effects);
      return toBookingDto(await loadViewable(actor, bookingId, 'GUEST'), 'GUEST', now);
    } catch (e) {
      // The same request arrived twice and both got past the idempotency table: the unique (guest, key) wins, return the booking that exists.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target).includes('idempotency')) {
        const existing = await prisma.booking.findFirstOrThrow({ where: { guestId: actor.id, idempotencyKey }, select: { id: true } });
        return toBookingDto(await loadViewable(actor, existing.id, 'GUEST'), 'GUEST', now);
      }
      throw e;
    }
  },

  async get(actor: Actor, id: string, viewer: Viewer = 'GUEST', now = new Date()) {
    return toBookingDto(await loadViewable(actor, id, viewer), viewer, now);
  },

  async list(actor: Actor, q: { when: 'upcoming' | 'past' | 'all'; status?: BookingStatus; limit: number; cursor?: string; hostelId?: string }, viewer: Viewer = 'GUEST') {
    if (viewer === 'OWNER') requireRole(actor, 'OWNER');
    if (viewer === 'ADMIN') requireRole(actor, 'ADMIN');
    const where: Prisma.BookingWhereInput = {
      ...(viewer === 'GUEST' ? { guestId: actor.id } : viewer === 'OWNER' ? { hostel: { ownerId: actor.id } } : {}),
      ...(q.hostelId ? { hostelId: q.hostelId } : {}),
      ...(q.status ? { status: q.status } : q.when === 'upcoming' ? { status: { in: UPCOMING } } : q.when === 'past' ? { status: { in: TERMINAL } } : {}),
    };
    const rows = await prisma.booking.findMany({ where, include: bookingInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q) });
    const { items, nextCursor } = toPage(rows, q.limit);
    return { items: items.map(toBookingSummary), nextCursor };
  },

  async cancellationPreview(actor: Actor, id: string, now = new Date()) {
    const b = await loadViewable(actor, id, 'GUEST');
    const p = refundPreview(b, 'GUEST', now);
    if (!p) throw Errors.invalidTransition(b.status, 'CANCELLED_BY_GUEST');
    return { refundPercent: p.percent, refundPaise: p.paise, retainedPaise: capturedPayment(b) && b.status === 'CONFIRMED' ? b.totalPaise - p.paise : 0, currency: b.currency };
  },

  /**
   * Cancels on behalf of the guest, the owner or an admin. Unpaid bookings simply release their hold; paid ones get a
   * refund by the policy (guest) or in full (owner/admin), with the ledger and refund record written in the same transaction.
   */
  async cancel(actor: Actor, role: Viewer, id: string, reason: string | undefined, now = new Date()) {
    let effects: Effect[] = [];
    const bookingId = await prisma.$transaction(async (tx) => {
      const b = await lockBooking(tx, id);
      if (role === 'GUEST' && b.guestId !== actor.id) throw Errors.notFound('Booking');
      if (role === 'OWNER') { requireRole(actor, 'OWNER'); if (b.hostel.ownerId !== actor.id) throw Errors.notFound('Booking'); }
      if (role === 'ADMIN') requireRole(actor, 'ADMIN');

      const was = b.status;
      const paid = capturedPayment(b);
      const preview = refundPreview(b, role, now);
      await releaseInventory(tx, b, now);
      if (was === 'PENDING_PAYMENT' || was === 'PENDING_APPROVAL') {
        await releaseCoupon(tx, b.id);
        await failOpenPayments(tx, b.id, 'CANCELLED', 'The booking was cancelled');
      }
      const updated = await transition(tx, b, role === 'GUEST' ? 'CANCELLED_BY_GUEST' : 'CANCELLED_BY_OWNER', {
        actor: role, actorId: actor.id, reason: reason ?? null, data: { cancelledAt: now, cancelledById: actor.id, cancelReason: reason ?? null, holdExpiresAt: null },
        metadata: { refundPercent: preview?.percent ?? 0 },
      });

      let refundPaise = 0;
      if (was === 'CONFIRMED' && paid) {
        refundPaise = preview?.paise ?? 0;
        let refundId: string | null = null;
        if (refundPaise > 0) {
          const refund = await refundsService.create(tx, { paymentId: paid.id, bookingId: b.id, amountPaise: refundPaise, reason: role === 'GUEST' ? `Cancelled by guest (${preview?.percent}% refund)` : 'Cancelled by the property: full refund', idempotencyKey: `cancel:${b.id}`, initiatedById: actor.id });
          refundId = refund.id;
          effects.push(() => enqueue('process-refund', { refundId: refund.id }));
        }
        await writeLedger(tx, cancellationEntries({ totalPaise: b.totalPaise, taxPaise: b.taxPaise, commissionBps: b.commissionBps }, refundPaise), { bookingId: b.id, paymentId: paid.id, refundId });
      }
      effects = [inventoryEffect, ...effects, ...(await notifyBooking(tx, role === 'GUEST' ? 'cancelled_by_guest' : 'cancelled_by_owner', updated, { reason, refundPaise }))];
      return b.id;
    });
    await runEffects(effects);
    return toBookingDto(await loadViewable(actor, bookingId, role), role, now);
  },
};
