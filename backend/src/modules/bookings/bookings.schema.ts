import { z } from 'zod';
import { paginationSchema } from '@/core/http/pagination';
import { quoteRequestSchema } from '@/modules/pricing/quote.schema';

const phone = z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a phone number in international format');

export const bookingGuestSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  age: z.number().int().min(0).max(120).optional(),
  idType: z.enum(['AADHAAR', 'PASSPORT', 'DRIVING_LICENCE', 'VOTER_ID', 'OTHER']).optional(),
  /** Only the last 4 characters; full ID numbers are never stored. */
  idLast4: z.string().regex(/^[A-Za-z0-9]{4}$/, 'Provide only the last 4 characters').optional(),
});

export const createBookingSchema = quoteRequestSchema
  .omit({ guests: true })
  .extend({
    /** Everyone staying; the first entry is the primary guest. */
    guests: z.array(bookingGuestSchema).min(1).max(30),
    contactPhone: phone,
    specialRequests: z.string().trim().max(500).nullish(),
    /** Total shown to the guest. If the live price differs the booking is refused (409 PRICE_CHANGED). */
    expectedTotalPaise: z.number().int().min(0).optional(),
  });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const listBookingsQuerySchema = paginationSchema.extend({
  when: z.enum(['upcoming', 'past', 'all']).default('all'),
  status: z.enum(['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'EXPIRED', 'CANCELLED_BY_GUEST', 'CANCELLED_BY_OWNER', 'REJECTED', 'NO_SHOW']).optional(),
});
export const ownerListBookingsQuerySchema = listBookingsQuerySchema.extend({ hostelId: z.uuid().optional() });
export const cancelBookingSchema = z.object({ reason: z.string().trim().min(3).max(500).optional() });
export const rejectBookingSchema = z.object({ reason: z.string().trim().min(5, 'Please give a short reason').max(500) });
export const ownerCancelSchema = z.object({ reason: z.string().trim().min(5, 'Please give a short reason').max(500) });
export const checkInSchema = z.object({ notes: z.string().trim().max(300).optional() });

// ───────── response contracts ─────────
const ts = z.iso.datetime();
const status = z.enum(['HOLD', 'PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'EXPIRED', 'CANCELLED_BY_GUEST', 'CANCELLED_BY_OWNER', 'REJECTED', 'NO_SHOW']);

export const paymentSummarySchema = z.strictObject({
  id: z.uuid(), status: z.enum(['CREATED', 'PENDING', 'CAPTURED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED']), amountPaise: z.number().int(), refundedPaise: z.number().int(),
  method: z.string().nullable(), capturedAt: ts.nullable(), failureReason: z.string().nullable(),
});

export const bookingDtoSchema = z.strictObject({
  id: z.uuid(), code: z.string(), status, viewer: z.enum(['GUEST', 'OWNER', 'ADMIN']),
  checkIn: z.string(), checkOut: z.string(), nights: z.number().int(), guestsCount: z.number().int(), currency: z.string(),
  hostel: z.strictObject({
    id: z.uuid(), slug: z.string(), name: z.string(), city: z.string(), state: z.string(), addressLine1: z.string(), locality: z.string().nullable(),
    location: z.strictObject({ latitude: z.number(), longitude: z.number() }), coverUrl: z.string().nullable(), checkInTime: z.string(), checkOutTime: z.string(), timezone: z.string(),
    phone: z.string().nullable(),
  }),
  items: z.array(z.strictObject({
    roomTypeId: z.uuid(), name: z.string(), units: z.number().int(), lineTotalPaise: z.number().int(),
    nightly: z.array(z.strictObject({ date: z.string(), unitPricePaise: z.number().int(), taxBps: z.number().int() })),
  })),
  guests: z.array(z.strictObject({ fullName: z.string(), gender: z.string().nullable(), age: z.number().int().nullable(), idType: z.string().nullable(), idLast4: z.string().nullable(), isPrimary: z.boolean() })),
  contactPhone: z.string().nullable(), specialRequests: z.string().nullable(),
  pricing: z.strictObject({ subtotalPaise: z.number().int(), discountPaise: z.number().int(), taxPaise: z.number().int(), serviceFeePaise: z.number().int(), totalPaise: z.number().int(), effectiveGstBps: z.number().int(), couponCode: z.string().nullable() }),
  bookingMode: z.enum(['INSTANT', 'APPROVAL']), cancellationPolicy: z.enum(['FLEXIBLE', 'MODERATE', 'STRICT']),
  holdExpiresAt: ts.nullable(), approvalDeadline: ts.nullable(), confirmedAt: ts.nullable(), checkedInAt: ts.nullable(), completedAt: ts.nullable(), cancelledAt: ts.nullable(),
  cancelReason: z.string().nullable(), cancelledBy: z.enum(['GUEST', 'OWNER', 'ADMIN']).nullable(),
  payment: paymentSummarySchema.nullable(),
  refund: z.strictObject({ amountPaise: z.number().int(), status: z.enum(['PENDING', 'PROCESSED', 'FAILED']), reason: z.string() }).nullable(),
  cancellation: z.strictObject({
    summary: z.string(), tiers: z.array(z.strictObject({ until: ts, refundPercent: z.number().int() })), freeCancellationUntil: ts.nullable(),
    refundPercentNow: z.number().int(), refundPaiseNow: z.number().int(),
  }).nullable(),
  timeline: z.array(z.strictObject({ status, at: ts, actorRole: z.string().nullable(), reason: z.string().nullable() })),
  actions: z.array(z.enum(['pay', 'cancel', 'approve', 'reject', 'check_in', 'complete', 'no_show', 'review'])),
  /** The guest's review of this stay, once written (edit it via PATCH /reviews/{id}). */
  reviewId: z.uuid().nullable(),
  guest: z.strictObject({ id: z.uuid(), name: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable() }).nullable(),
  ownerShare: z.strictObject({ commissionPaise: z.number().int(), ownerNetPaise: z.number().int() }).nullable(),
  createdAt: ts,
});
export type BookingDto = z.infer<typeof bookingDtoSchema>;

export const bookingSummarySchema = z.strictObject({
  id: z.uuid(), code: z.string(), status, hostel: z.strictObject({ id: z.uuid(), name: z.string(), city: z.string(), coverUrl: z.string().nullable() }),
  checkIn: z.string(), checkOut: z.string(), nights: z.number().int(), guestsCount: z.number().int(), totalPaise: z.number().int(),
  holdExpiresAt: ts.nullable(), guestName: z.string().nullable(), createdAt: ts,
});
