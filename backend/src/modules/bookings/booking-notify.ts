import type { NotificationType } from '@/generated/prisma/client';
import { env } from '@/core/config/env';
import { enqueue } from '@/infra/queue/queue';
import { layout } from '@/infra/mail/templates';
import type { Mail } from '@/infra/mail/mailer';
import { loadPreferences, notify } from '@/modules/notifications/notifications.service';
import { fmtDate, fmtRupees, type BookingFull, type Effect, type Tx } from './booking-core';

export type BookingEvent =
  | 'requested' // guest asked to book (request-to-book): owner must decide
  | 'approved' // owner accepted: guest should pay
  | 'rejected'
  | 'confirmed' // payment captured
  | 'expired'
  | 'cancelled_by_guest'
  | 'cancelled_by_owner'
  | 'payment_failed'
  | 'refund_processed'
  | 'completed'
  | 'no_show'
  | 'reminder';

interface Note {
  type: NotificationType;
  title: string;
  body: string;
  mailSubject?: string;
  mailBody?: string;
  cta?: string;
}

const link = (b: BookingFull, party: 'guest' | 'owner') => `${env().FRONTEND_URL}/${party === 'owner' ? 'owner/bookings' : 'bookings'}/${b.id}`;
const stay = (b: BookingFull) => `${b.hostel.name}, ${fmtDate(b.checkIn)} to ${fmtDate(b.checkOut)} (${b.nights} night${b.nights > 1 ? 's' : ''})`;

/** What each party is told for each event. Titles/bodies are short (in-app); mail bodies add the details. */
function compose(event: BookingEvent, b: BookingFull, extra: { reason?: string | null; refundPaise?: number } = {}): { guest?: Note; owner?: Note } {
  const reason = extra.reason ? ` Reason: ${extra.reason}` : '';
  switch (event) {
    case 'requested':
      return {
        guest: { type: 'BOOKING_CREATED', title: 'Request sent', body: `${b.hostel.name} will respond within ${env().APPROVAL_WINDOW_HOURS} hours. You pay only after they accept.` },
        owner: { type: 'BOOKING_APPROVAL_REQUESTED', title: 'New booking request', body: `${b.code}: ${stay(b)}, ${b.guestsCount} guest(s). Respond within ${env().APPROVAL_WINDOW_HOURS} hours.`, mailSubject: `Booking request ${b.code}`, mailBody: `You have a new request for ${stay(b)}. Open it to accept or decline; it expires automatically if unanswered.`, cta: 'Review request' },
      };
    case 'approved':
      return { guest: { type: 'BOOKING_APPROVED', title: 'Request accepted: complete payment', body: `${b.hostel.name} accepted your request ${b.code}. Pay within ${env().APPROVAL_PAYMENT_WINDOW_MINUTES} minutes to secure it.`, mailSubject: `Accepted: pay now to confirm ${b.code}`, mailBody: `${stay(b)} was accepted. Total ${fmtRupees(b.totalPaise)}. Your hold lasts ${env().APPROVAL_PAYMENT_WINDOW_MINUTES} minutes.`, cta: 'Pay now' } };
    case 'rejected':
      return { guest: { type: 'BOOKING_REJECTED', title: 'Request declined', body: `${b.hostel.name} could not accept ${b.code}.${reason}`, mailSubject: `Request ${b.code} declined`, mailBody: `Unfortunately ${b.hostel.name} could not accept your request for ${stay(b)}.${reason} You have not been charged.`, cta: 'Find another stay' } };
    case 'confirmed':
      return {
        guest: { type: 'BOOKING_CONFIRMED', title: 'Booking confirmed', body: `${b.code}: ${stay(b)}. Paid ${fmtRupees(b.totalPaise)}.`, mailSubject: `Booking confirmed ${b.code}`, mailBody: `You're all set for ${stay(b)}. Check-in from ${b.hostel.checkInTime}. Paid ${fmtRupees(b.totalPaise)}. Bring a government ID.`, cta: 'View booking' },
        owner: { type: 'BOOKING_CREATED', title: 'New confirmed booking', body: `${b.code}: ${stay(b)}, ${b.guestsCount} guest(s), ${fmtRupees(b.totalPaise)}.`, mailSubject: `New booking ${b.code}`, mailBody: `${stay(b)} for ${b.guestsCount} guest(s) is confirmed and paid.`, cta: 'View booking' },
      };
    case 'expired':
      return { guest: { type: 'BOOKING_EXPIRED', title: 'Booking expired', body: `${b.code} was not completed in time and the beds were released.`, mailSubject: `Booking ${b.code} expired`, mailBody: `${stay(b)} was not completed in time, so the hold was released. You have not been charged.`, cta: 'Search again' } };
    case 'cancelled_by_guest':
      return {
        guest: { type: 'BOOKING_CANCELLED', title: 'Booking cancelled', body: `${b.code} is cancelled.${extra.refundPaise ? ` Refund of ${fmtRupees(extra.refundPaise)} is on its way.` : ''}`, mailSubject: `Booking ${b.code} cancelled`, mailBody: `Your booking for ${stay(b)} is cancelled.${extra.refundPaise ? ` A refund of ${fmtRupees(extra.refundPaise)} is being processed.` : ' No refund is due under the cancellation policy.'}`, cta: 'View booking' },
        owner: { type: 'BOOKING_CANCELLED', title: 'Guest cancelled', body: `${b.code}: ${stay(b)}.${reason}`, mailSubject: `Booking ${b.code} cancelled by guest`, mailBody: `The guest cancelled ${stay(b)}. The beds are open for sale again.`, cta: 'View booking' },
      };
    case 'cancelled_by_owner':
      return { guest: { type: 'BOOKING_CANCELLED', title: 'Booking cancelled by the property', body: `${b.code} was cancelled.${reason}${extra.refundPaise ? ` Full refund of ${fmtRupees(extra.refundPaise)} is on its way.` : ''}`, mailSubject: `Booking ${b.code} cancelled by the property`, mailBody: `We're sorry: ${b.hostel.name} had to cancel ${stay(b)}.${reason}${extra.refundPaise ? ` You will receive a full refund of ${fmtRupees(extra.refundPaise)}.` : ''}`, cta: 'Find another stay' } };
    case 'payment_failed':
      return { guest: { type: 'PAYMENT_FAILED', title: 'Payment failed', body: `Payment for ${b.code} did not go through.${reason} Your hold is kept until it expires: try again.` } };
    case 'refund_processed':
      return { guest: { type: 'REFUND_PROCESSED', title: 'Refund processed', body: `${fmtRupees(extra.refundPaise ?? 0)} was refunded for ${b.code}.`, mailSubject: `Refund processed for ${b.code}`, mailBody: `We refunded ${fmtRupees(extra.refundPaise ?? 0)} to your original payment method. It can take a few days to show up.`, cta: 'View booking' } };
    case 'completed':
      return { guest: { type: 'REVIEW_REQUESTED', title: 'How was your stay?', body: `Tell others about ${b.hostel.name}.`, mailSubject: `How was ${b.hostel.name}?`, mailBody: `Thanks for staying with ${b.hostel.name}. A quick review helps other travellers.`, cta: 'Write a review' } };
    case 'no_show':
      return { guest: { type: 'BOOKING_CANCELLED', title: 'Marked as no-show', body: `${b.code} was marked as a no-show. The amount paid is not refundable.` } };
    case 'reminder':
      return { guest: { type: 'BOOKING_REMINDER', title: 'Your stay is tomorrow', body: `${stay(b)}. Check-in from ${b.hostel.checkInTime}.`, mailSubject: `Tomorrow: ${b.hostel.name}`, mailBody: `Your stay starts tomorrow. Check-in from ${b.hostel.checkInTime}. Please carry a government ID. ${b.hostel.phone ? `Property phone: ${b.hostel.phone}.` : ''}`, cta: 'View booking' } };
  }
}

const toMail = (to: string, n: Note, url: string): Mail | null => (n.mailSubject && n.mailBody ? { to, subject: n.mailSubject, ...layout(n.mailSubject, n.mailBody, n.cta ?? 'View booking', url) } : null);

/**
 * Writes in-app notifications inside the transaction (they commit with the change), and returns the emails
 * as post-commit effects so a mail outage can never roll back or delay a booking.
 */
export async function notifyBooking(tx: Tx, event: BookingEvent, b: BookingFull, extra: { reason?: string | null; refundPaise?: number } = {}): Promise<Effect[]> {
  const n = compose(event, b, extra);
  const data = { bookingId: b.id, code: b.code };
  const rows = [
    ...(n.guest ? [{ userId: b.guestId, type: n.guest.type, title: n.guest.title, body: n.guest.body, data }] : []),
    ...(n.owner ? [{ userId: b.hostel.ownerId, type: n.owner.type, title: n.owner.title, body: n.owner.body, data }] : []),
  ];
  await notify(rows, tx);

  const effects: Effect[] = [];
  const ownerEmail = n.owner ? (await tx.user.findUnique({ where: { id: b.hostel.ownerId }, select: { email: true } }))?.email : undefined;
  // Confirmations, cancellations, payments and refunds are transactional and always emailed; the pre-stay reminder honours the guest's choice.
  const guestMailWanted = event !== 'reminder' || (await loadPreferences(tx, [b.guestId])).get(b.guestId)?.emailBookings !== false;
  const mails: (Mail | null)[] = [n.guest && guestMailWanted ? toMail(b.guest.email, n.guest, link(b, 'guest')) : null, n.owner && ownerEmail ? toMail(ownerEmail, n.owner, link(b, 'owner')) : null];
  for (const m of mails) if (m) effects.push(() => enqueue('mail', m));
  return effects;
}
