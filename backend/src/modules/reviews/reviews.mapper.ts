import type { Prisma } from '@/generated/prisma/client';
import { toDateString } from '@/core/dates';
import { REVIEW_EDIT_WINDOW_DAYS } from './reviews.config';

export const reviewInclude = {
  guest: { select: { email: true, profile: { select: { fullName: true } } } },
  booking: { select: { code: true, checkIn: true, nights: true } },
  hostel: { select: { id: true, slug: true, name: true, ownerId: true } },
} satisfies Prisma.ReviewInclude;
export type ReviewFull = Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>;

const iso = (d: Date | null) => d?.toISOString() ?? null;
const DAY_MS = 86_400_000;

/** "Asha Rao" -> "Asha R."; one word stays as is; nothing -> "Guest". Counts code points so emoji are never split. */
export function reviewerName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Guest';
  const first = Array.from(parts[0]!).slice(0, 30).join('');
  if (parts.length === 1) return first;
  return `${first} ${Array.from(parts[parts.length - 1]!)[0]}.`;
}

const core = (r: ReviewFull) => ({
  id: r.id, overall: r.overall, cleanliness: r.cleanliness, location: r.location, staff: r.staff, valueForMoney: r.valueForMoney,
  title: r.title, comment: r.comment,
  reviewer: { name: reviewerName(r.guest.profile?.fullName) },
  stay: { month: toDateString(r.booking.checkIn).slice(0, 7), nights: r.booking.nights },
  ownerReply: r.ownerReply, ownerRepliedAt: iso(r.ownerRepliedAt), createdAt: r.createdAt.toISOString(), editedAt: iso(r.editedAt),
});
const hostelRef = (r: ReviewFull) => ({ id: r.hostel.id, slug: r.hostel.slug, name: r.hostel.name });

export const toPublicReview = core;

/** Until when the author may still change or delete the review; null once that is no longer possible. */
export function editableUntil(r: Pick<ReviewFull, 'status' | 'ownerReply' | 'createdAt'>, now: Date): Date | null {
  if (r.status !== 'PUBLISHED' || r.ownerReply) return null;
  const until = new Date(r.createdAt.getTime() + REVIEW_EDIT_WINDOW_DAYS * DAY_MS);
  return until > now ? until : null;
}

export function toMyReview(r: ReviewFull, now = new Date()) {
  const until = editableUntil(r, now);
  return { ...core(r), bookingId: r.bookingId, status: r.status, moderationReason: r.status === 'HIDDEN' ? r.moderationReason : null, hostel: hostelRef(r), editable: until !== null, editableUntil: iso(until) };
}

export const toOwnerReview = (r: ReviewFull) => ({ ...core(r), bookingCode: r.booking.code, status: r.status, hostel: hostelRef(r) });

export const toAdminReview = (r: ReviewFull) => ({
  ...core(r), bookingId: r.bookingId, bookingCode: r.booking.code, status: r.status, hostel: hostelRef(r),
  guestId: r.guestId, guestEmail: r.guest.email, moderationReason: r.moderationReason, moderatedAt: iso(r.moderatedAt), moderatedById: r.moderatedById,
});

/**
 * Audit snapshot: ratings and text *lengths* only. The audit log is append-only and permanent, so review text
 * (personal data a guest may later ask us to erase) is deliberately kept out of it.
 */
export const auditSnapshot = (r: { overall: number; cleanliness: number | null; location: number | null; staff: number | null; valueForMoney: number | null; title: string | null; comment: string | null; status?: string }) => ({
  overall: r.overall, cleanliness: r.cleanliness, location: r.location, staff: r.staff, valueForMoney: r.valueForMoney,
  titleLength: r.title?.length ?? 0, commentLength: r.comment?.length ?? 0, ...(r.status ? { status: r.status } : {}),
});
