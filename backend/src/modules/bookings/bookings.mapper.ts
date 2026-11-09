import type { BookingStatus } from '@/generated/prisma/client';
import { addDays, toDateString, todayIn } from '@/core/dates';
import { transformUrl } from '@/infra/cloudinary/storage';
import { SUMMARY, checkInInstant, freeCancellationUntil, policyTiers, refundPercentAt } from '@/modules/pricing/cancellation-policy';
import { REVIEW_WINDOW_DAYS } from '@/modules/reviews/reviews.config';
import { refundAmount } from './booking-ledger';
import { capturedPayment, type BookingFull } from './booking-core';
import type { BookingDto } from './bookings.schema';
import { canTransition, type BookingActor } from './bookings.status';

export type Viewer = 'GUEST' | 'OWNER' | 'ADMIN';
type Action = BookingDto['actions'][number];

const REVEAL_CONTACT: BookingStatus[] = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'];
const iso = (d: Date | null) => d?.toISOString() ?? null;

/** What the viewer can do right now, derived from the same transition table the services enforce. */
export function allowedActions(b: BookingFull, viewer: Viewer, now: Date): Action[] {
  const actor: BookingActor = viewer;
  const today = todayIn(b.hostel.timezone, now);
  const ci = toDateString(b.checkIn), co = toDateString(b.checkOut);
  const out: Action[] = [];
  if (viewer === 'GUEST' && b.status === 'PENDING_PAYMENT' && b.totalPaise > 0 && (!b.holdExpiresAt || b.holdExpiresAt > now)) out.push('pay');
  if (canTransition(b.status, viewer === 'GUEST' ? 'CANCELLED_BY_GUEST' : 'CANCELLED_BY_OWNER', actor)) out.push('cancel');
  if (viewer !== 'GUEST' && b.status === 'PENDING_APPROVAL' && (!b.holdExpiresAt || b.holdExpiresAt > now)) out.push('approve', 'reject');
  if (viewer !== 'GUEST' && b.status === 'CONFIRMED' && today >= ci && today < co) out.push('check_in');
  if (viewer !== 'GUEST' && b.status === 'CONFIRMED' && today >= ci) out.push('no_show');
  if (viewer !== 'GUEST' && b.status === 'CHECKED_IN' && today >= co) out.push('complete');
  if (viewer === 'GUEST' && b.status === 'COMPLETED' && !b.review && today <= addDays(co, REVIEW_WINDOW_DAYS)) out.push('review');
  return out;
}

/** Refund the viewer would receive if the booking were cancelled right now. */
export function refundPreview(b: BookingFull, viewer: Viewer, now: Date): { percent: number; paise: number } | null {
  if (!['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED'].includes(b.status)) return null;
  const paid = capturedPayment(b);
  if (!paid || b.status !== 'CONFIRMED') return { percent: 100, paise: 0 }; // nothing was charged
  const percent = viewer === 'GUEST' ? refundPercentAt(b.cancellationPolicy, checkInInstant(toDateString(b.checkIn), b.hostel.checkInTime, b.hostel.timezone), now) : 100;
  return { percent, paise: refundAmount(b.totalPaise, percent) };
}

export function toBookingDto(b: BookingFull, viewer: Viewer, now = new Date()): BookingDto {
  const contactVisible = viewer === 'ADMIN' || REVEAL_CONTACT.includes(b.status);
  const paid = capturedPayment(b) ?? b.payments[0] ?? null;
  const refund = b.refunds[0] ?? null;
  const preview = refundPreview(b, viewer, now);
  const cover = b.hostel.media[0];
  const checkInAt = checkInInstant(toDateString(b.checkIn), b.hostel.checkInTime, b.hostel.timezone);
  const cancelledBy: BookingDto['cancelledBy'] = b.status === 'CANCELLED_BY_GUEST' ? 'GUEST' : b.status === 'CANCELLED_BY_OWNER' ? (b.history.find((h) => h.toStatus === 'CANCELLED_BY_OWNER')?.actorRole === 'ADMIN' ? 'ADMIN' : 'OWNER') : null;
  const net = b.subtotalPaise - b.discountPaise;
  const commission = Math.round((net * b.commissionBps) / 10_000);

  return {
    id: b.id, code: b.code, status: b.status, viewer,
    checkIn: toDateString(b.checkIn), checkOut: toDateString(b.checkOut), nights: b.nights, guestsCount: b.guestsCount, currency: b.currency,
    hostel: {
      id: b.hostel.id, slug: b.hostel.slug, name: b.hostel.name, city: b.hostel.city, state: b.hostel.state, addressLine1: b.hostel.addressLine1, locality: b.hostel.locality,
      location: { latitude: b.hostel.latitude, longitude: b.hostel.longitude }, coverUrl: cover ? transformUrl(cover.url, 'c_fill,w_640,h_480,f_auto,q_auto') : null,
      checkInTime: b.hostel.checkInTime, checkOutTime: b.hostel.checkOutTime, timezone: b.hostel.timezone,
      phone: viewer !== 'GUEST' || REVEAL_CONTACT.includes(b.status) ? b.hostel.phone : null, // the property's number is revealed once the stay is confirmed
    },
    items: b.items.map((i) => ({
      roomTypeId: i.roomTypeId, name: i.roomNameSnapshot, units: i.units, lineTotalPaise: i.lineTotalPaise,
      nightly: (i.nightlyBreakdown as { date: string; unitPricePaise: number; taxBps: number }[]).map((n) => ({ date: n.date, unitPricePaise: n.unitPricePaise, taxBps: n.taxBps })),
    })),
    guests: b.guests.map((g) => ({ fullName: g.fullName, gender: g.gender, age: g.age, idType: g.idType, idLast4: g.idLast4, isPrimary: g.isPrimary })),
    contactPhone: viewer === 'GUEST' || contactVisible ? b.contactPhone : null, specialRequests: b.specialRequests,
    pricing: { subtotalPaise: b.subtotalPaise, discountPaise: b.discountPaise, taxPaise: b.taxPaise, serviceFeePaise: b.serviceFeePaise, totalPaise: b.totalPaise, effectiveGstBps: b.gstRateBps, couponCode: b.coupon?.code ?? null },
    bookingMode: b.bookingMode, cancellationPolicy: b.cancellationPolicy,
    holdExpiresAt: ['PENDING_PAYMENT', 'PENDING_APPROVAL'].includes(b.status) ? iso(b.holdExpiresAt) : null, approvalDeadline: b.status === 'PENDING_APPROVAL' ? iso(b.approvalDeadline) : null,
    confirmedAt: iso(b.confirmedAt), checkedInAt: iso(b.checkedInAt), completedAt: iso(b.completedAt), cancelledAt: iso(b.cancelledAt), cancelReason: b.cancelReason, cancelledBy,
    payment: paid ? { id: paid.id, status: paid.status, amountPaise: paid.amountPaise, refundedPaise: paid.refundedPaise, method: paid.method, capturedAt: iso(paid.capturedAt), failureReason: paid.failureReason } : null,
    refund: refund ? { amountPaise: refund.amountPaise, status: refund.status, reason: refund.reason } : null,
    cancellation: preview && viewer === 'GUEST'
      ? { summary: SUMMARY[b.cancellationPolicy], tiers: policyTiers(b.cancellationPolicy, checkInAt), freeCancellationUntil: freeCancellationUntil(b.cancellationPolicy, checkInAt), refundPercentNow: preview.percent, refundPaiseNow: preview.paise }
      : null,
    timeline: b.history.map((h) => ({ status: h.toStatus, at: h.createdAt.toISOString(), actorRole: h.actorRole, reason: h.reason })),
    actions: allowedActions(b, viewer, now),
    reviewId: viewer === 'GUEST' ? (b.review?.id ?? null) : null,
    guest: viewer === 'GUEST' ? null : { id: b.guest.id, name: b.guest.profile?.fullName ?? null, email: contactVisible ? b.guest.email : null, phone: contactVisible ? (b.contactPhone ?? b.guest.profile?.phone ?? null) : null },
    ownerShare: viewer === 'GUEST' ? null : { commissionPaise: commission, ownerNetPaise: net - commission },
    createdAt: b.createdAt.toISOString(),
  };
}

export function toBookingSummary(b: BookingFull) {
  const cover = b.hostel.media[0];
  return {
    id: b.id, code: b.code, status: b.status, hostel: { id: b.hostel.id, name: b.hostel.name, city: b.hostel.city, coverUrl: cover ? transformUrl(cover.url, 'c_fill,w_320,h_240,f_auto,q_auto') : null },
    checkIn: toDateString(b.checkIn), checkOut: toDateString(b.checkOut), nights: b.nights, guestsCount: b.guestsCount, totalPaise: b.totalPaise,
    holdExpiresAt: ['PENDING_PAYMENT', 'PENDING_APPROVAL'].includes(b.status) ? iso(b.holdExpiresAt) : null,
    guestName: b.guest.profile?.fullName ?? null, createdAt: b.createdAt.toISOString(),
  };
}
