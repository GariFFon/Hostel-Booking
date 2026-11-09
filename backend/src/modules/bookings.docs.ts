import { z } from 'zod';
import { documentRoute } from '@/core/openapi/registry';
import { auditEntrySchema, auditQuerySchema, auditVerifySchema } from '@/modules/audit/audit.schema';
import { bookingDtoSchema, bookingSummarySchema, cancelBookingSchema, checkInSchema, createBookingSchema, listBookingsQuerySchema, ownerCancelSchema, ownerListBookingsQuerySchema, rejectBookingSchema } from '@/modules/bookings/bookings.schema';
import { earningsQuerySchema, earningsSchema } from '@/modules/earnings/earnings.schema';
import { demoCheckoutSchema, paymentDtoSchema } from '@/modules/payments/payments.schema';

const G = ['Bookings'], O = ['Owner'], A = ['Admin'], P = ['Payments'];
const cancelPreview = z.strictObject({ refundPercent: z.number().int(), refundPaise: z.number().int(), retainedPaise: z.number().int(), currency: z.string() });
const ledger = z.strictObject({
  bookingId: z.uuid(), code: z.string(), status: z.string(), totalPaise: z.number().int(),
  entries: z.array(z.strictObject({ id: z.uuid(), groupId: z.uuid(), from: z.string(), to: z.string(), amountPaise: z.number().int(), memo: z.string(), createdAt: z.iso.datetime() })),
  balances: z.record(z.string(), z.number().int()),
});

documentRoute({ method: 'post', path: '/bookings', summary: 'Book and hold the beds. Requires an Idempotency-Key header (409 PRICE_CHANGED if expectedTotalPaise is stale; 409 SOLD_OUT; 409 IDEMPOTENCY_CONFLICT). Instant-book listings return PENDING_PAYMENT (pay within holdExpiresAt); request-to-book listings return PENDING_APPROVAL', tags: G, auth: true, body: createBookingSchema, response: bookingDtoSchema, status: 201, errors: [403, 404, 409] });
documentRoute({ method: 'get', path: '/bookings', summary: 'My bookings (keyset pagination; when=upcoming|past|all)', tags: G, auth: true, query: listBookingsQuerySchema, response: z.array(bookingSummarySchema) });
documentRoute({ method: 'get', path: '/bookings/{id}', summary: 'One booking with timeline, payment, refund, allowed actions and cancellation terms', tags: G, auth: true, response: bookingDtoSchema, errors: [404] });
documentRoute({ method: 'get', path: '/bookings/{id}/cancellation-preview', summary: 'What a cancellation right now would refund', tags: G, auth: true, response: cancelPreview, errors: [404, 409] });
documentRoute({ method: 'post', path: '/bookings/{id}/cancel', summary: 'Cancel my booking (refund per the cancellation policy). Optional Idempotency-Key', tags: G, auth: true, body: cancelBookingSchema, response: bookingDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/bookings/{id}/payments', summary: 'Start (or resume) payment for a booking waiting for it. Returns the open order; retry after a failure creates a new one', tags: P, auth: true, response: paymentDtoSchema, status: 201, errors: [403, 404, 409] });
documentRoute({ method: 'get', path: '/payments/{id}', summary: 'Payment status (poll after paying; confirmation arrives asynchronously by webhook)', tags: P, auth: true, response: paymentDtoSchema, errors: [404] });
documentRoute({ method: 'post', path: '/payments/{id}/demo-checkout', summary: 'Demo gateway only: simulate the guest paying with a test instrument (DEMO_SUCCESS | DEMO_FAIL | DEMO_PENDING | DEMO_TIMEOUT)', tags: P, auth: true, body: demoCheckoutSchema, response: paymentDtoSchema, errors: [404, 409] });
documentRoute({ method: 'post', path: '/payments/webhooks/demo', summary: 'Gateway callback (HMAC-signed, X-Demo-Signature: t=<unix>,v1=<hex>). Idempotent by event id', tags: P, body: z.object({ id: z.string(), type: z.enum(['payment.captured', 'payment.failed']), createdAt: z.string(), data: z.object({ orderId: z.string(), paymentId: z.string(), amountPaise: z.number().int() }) }), response: z.strictObject({ received: z.boolean(), outcome: z.enum(['processed', 'duplicate', 'ignored']) }), errors: [401] });

documentRoute({ method: 'get', path: '/owner/bookings', summary: 'Bookings at my properties', tags: O, auth: true, query: ownerListBookingsQuerySchema, response: z.array(bookingSummarySchema), errors: [403] });
documentRoute({ method: 'get', path: '/owner/bookings/{id}', summary: 'Booking detail for the host (guest contact revealed once confirmed)', tags: O, auth: true, response: bookingDtoSchema, errors: [403, 404] });
documentRoute({ method: 'post', path: '/owner/bookings/{id}/approve', summary: 'Accept a request; the guest then has a payment window', tags: O, auth: true, response: bookingDtoSchema, errors: [403, 404, 409] });
documentRoute({ method: 'post', path: '/owner/bookings/{id}/reject', summary: 'Decline a request (beds are released, nothing was charged)', tags: O, auth: true, body: rejectBookingSchema, response: bookingDtoSchema, errors: [403, 404, 409] });
documentRoute({ method: 'post', path: '/owner/bookings/{id}/check-in', summary: 'Check a guest in (from the check-in date)', tags: O, auth: true, body: checkInSchema, response: bookingDtoSchema, errors: [403, 404, 409] });
documentRoute({ method: 'post', path: '/owner/bookings/{id}/complete', summary: 'Complete a stay (from the check-out date); releases the owner share', tags: O, auth: true, response: bookingDtoSchema, errors: [403, 404, 409] });
documentRoute({ method: 'post', path: '/owner/bookings/{id}/no-show', summary: 'Record a no-show: payment retained, future nights return to sale', tags: O, auth: true, response: bookingDtoSchema, errors: [403, 404, 409] });
documentRoute({ method: 'post', path: '/owner/bookings/{id}/cancel', summary: 'Cancel a confirmed booking: the guest is refunded in full', tags: O, auth: true, body: ownerCancelSchema, response: bookingDtoSchema, errors: [403, 404, 409] });
documentRoute({ method: 'get', path: '/owner/earnings', summary: 'Earnings from the ledger: settled, upcoming and per property', tags: O, auth: true, query: earningsQuerySchema, response: earningsSchema, errors: [403] });

documentRoute({ method: 'get', path: '/admin/bookings', summary: 'All bookings', tags: A, auth: true, query: ownerListBookingsQuerySchema, response: z.array(bookingSummarySchema), errors: [403] });
documentRoute({ method: 'get', path: '/admin/bookings/{id}', summary: 'Any booking', tags: A, auth: true, response: bookingDtoSchema, errors: [403, 404] });
documentRoute({ method: 'post', path: '/admin/bookings/{id}/cancel', summary: 'Cancel on behalf of the platform (full refund)', tags: A, auth: true, body: ownerCancelSchema, response: bookingDtoSchema, errors: [403, 404, 409] });
documentRoute({ method: 'get', path: '/admin/bookings/{id}/ledger', summary: 'Money trail with per-account balances', tags: A, auth: true, response: ledger, errors: [403, 404] });
documentRoute({ method: 'get', path: '/admin/audit-logs', summary: 'Audit log viewer (newest first, filterable, keyset pagination)', tags: A, auth: true, query: auditQuerySchema, response: z.array(auditEntrySchema), errors: [403] });
documentRoute({ method: 'get', path: '/admin/audit-logs/verify', summary: 'Recompute the tamper-evident hash chain', tags: A, auth: true, response: auditVerifySchema, errors: [403] });
