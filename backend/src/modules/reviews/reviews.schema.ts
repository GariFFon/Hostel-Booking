import { z } from 'zod';
import { paginationSchema } from '@/core/http/pagination';

const ts = z.iso.datetime();
const rating = z.number().int().min(1).max(5);
const reviewStatus = z.enum(['PUBLISHED', 'HIDDEN']);

/** Tabs, newlines and printable text only: no NULs or other control characters in anything we store and re-serve. */
export function hasControlChars(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) return true;
  }
  return false;
}
export const safeText = (max: number) => z.string().trim().min(1).max(max).refine((s) => !hasControlChars(s), 'Contains invalid characters');

// ── input ──
export const createReviewSchema = z.strictObject({
  overall: rating,
  cleanliness: rating.optional(), location: rating.optional(), staff: rating.optional(), valueForMoney: rating.optional(),
  title: safeText(100).optional(), comment: safeText(2000).optional(),
});

/** PATCH: omitted = unchanged, null = clear an optional field. */
export const updateReviewSchema = z.strictObject({
  overall: rating.optional(),
  cleanliness: rating.nullable().optional(), location: rating.nullable().optional(), staff: rating.nullable().optional(), valueForMoney: rating.nullable().optional(),
  title: safeText(100).nullable().optional(), comment: safeText(2000).nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to change' });

export const replyReviewSchema = z.strictObject({ text: safeText(1000) });
export const reasonSchema = z.strictObject({ reason: safeText(500) });

export const publicReviewsQuerySchema = paginationSchema.extend({
  sort: z.enum(['recent', 'highest', 'lowest']).default('recent'),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});
export const ownerReviewsQuerySchema = paginationSchema.extend({
  hostelId: z.uuid().optional(), replied: z.enum(['true', 'false']).optional(), status: reviewStatus.optional(), rating: z.coerce.number().int().min(1).max(5).optional(),
});
export const adminReviewsQuerySchema = paginationSchema.extend({
  status: reviewStatus.optional(), hostelId: z.uuid().optional(), rating: z.coerce.number().int().min(1).max(5).optional(),
});

// ── output ──
const base = {
  id: z.uuid(), overall: rating,
  cleanliness: rating.nullable(), location: rating.nullable(), staff: rating.nullable(), valueForMoney: rating.nullable(),
  title: z.string().nullable(), comment: z.string().nullable(),
  /** "Asha R." — never the full name or email. */
  reviewer: z.strictObject({ name: z.string() }),
  /** Month and length of the verified stay, not the exact dates. */
  stay: z.strictObject({ month: z.string(), nights: z.number().int() }),
  ownerReply: z.string().nullable(), ownerRepliedAt: ts.nullable(), createdAt: ts, editedAt: ts.nullable(),
};
const hostelRef = z.strictObject({ id: z.uuid(), slug: z.string(), name: z.string() });

export const publicReviewSchema = z.strictObject(base);
export const myReviewSchema = z.strictObject({
  ...base, bookingId: z.uuid(), status: reviewStatus, moderationReason: z.string().nullable(), hostel: hostelRef,
  editable: z.boolean(), editableUntil: ts.nullable(),
});
export const ownerReviewSchema = z.strictObject({ ...base, bookingCode: z.string(), status: reviewStatus, hostel: hostelRef });
export const adminReviewSchema = z.strictObject({
  ...base, bookingId: z.uuid(), bookingCode: z.string(), status: reviewStatus, hostel: hostelRef,
  guestId: z.uuid(), guestEmail: z.string(), moderationReason: z.string().nullable(), moderatedAt: ts.nullable(), moderatedById: z.uuid().nullable(),
});

export const reviewSummarySchema = z.strictObject({
  avgRating: z.number(), reviewCount: z.number().int(),
  distribution: z.strictObject({ '1': z.number().int(), '2': z.number().int(), '3': z.number().int(), '4': z.number().int(), '5': z.number().int() }),
  categories: z.strictObject({ cleanliness: z.number().nullable(), location: z.number().nullable(), staff: z.number().nullable(), valueForMoney: z.number().nullable() }),
});
export const reportResultSchema = z.strictObject({ reported: z.boolean() });
