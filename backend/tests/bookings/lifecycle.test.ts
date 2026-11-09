import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addDays, zonedTimeToUtc } from '@/core/dates';
import type { Actor } from '@/core/context/request-context';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { outbox } from '@/infra/mail/mailer';
import { DemoProvider } from '@/infra/payments/demo.provider';
import { setPaymentProvider } from '@/infra/payments/provider';
import { POST as ownerApprove } from '@/app/api/v1/owner/bookings/[id]/approve/route';
import { POST as ownerReject } from '@/app/api/v1/owner/bookings/[id]/reject/route';
import { POST as ownerCheckIn } from '@/app/api/v1/owner/bookings/[id]/check-in/route';
import { POST as ownerCancel } from '@/app/api/v1/owner/bookings/[id]/cancel/route';
import { POST as ownerNoShow } from '@/app/api/v1/owner/bookings/[id]/no-show/route';
import { POST as guestCancel } from '@/app/api/v1/bookings/[id]/cancel/route';
import { GET as preview } from '@/app/api/v1/bookings/[id]/cancellation-preview/route';
import { GET as getBooking } from '@/app/api/v1/bookings/[id]/route';
import { POST as adminCancel } from '@/app/api/v1/admin/bookings/[id]/cancel/route';
import { GET as adminLedger } from '@/app/api/v1/admin/bookings/[id]/ledger/route';
import { GET as auditLogs } from '@/app/api/v1/admin/audit-logs/route';
import { GET as auditVerify } from '@/app/api/v1/admin/audit-logs/verify/route';
import { GET as earnings } from '@/app/api/v1/owner/earnings/route';
import { expireDueBookings } from '@/modules/bookings/booking-expiry';
import { bookingLifecycle } from '@/modules/bookings/booking-lifecycle.service';
import { bookingsService } from '@/modules/bookings/bookings.service';
import { bookingDtoSchema } from '@/modules/bookings/bookings.schema';
import { earningsSchema } from '@/modules/earnings/earnings.schema';
import { auditEntrySchema, auditVerifySchema } from '@/modules/audit/audit.schema';
import { refundsService } from '@/modules/payments/refunds.service';
import { call } from '../helpers/http';
import { STAY, book, bookingBody, confirmedBooking, inventoryOf, ledgerBalances, makeGuest, makeHost, notificationsFor, pay } from '../helpers/booking';
import { D, TODAY, uniq } from '../helpers/publish';
import { makeUser } from '../helpers/users';

beforeAll(async () => {
  await redis.flushdb();
});
afterEach(() => setPaymentProvider(null));

const actor = (u: { id: string }, role: Actor['roles'][number]): Actor => ({ id: u.id, roles: [role], emailVerified: true });
const row = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });
const at = (date: string, time = '06:00') => new Date(`${date}T${time}:00Z`); // 11:30 IST: still the same Indian calendar date
const checkInAt = (date: string) => zonedTimeToUtc(date, '14:00', 'Asia/Kolkata');
const issues = (schema: { safeParse: (v: unknown) => { error?: { issues: unknown[] } } }, v: unknown) => schema.safeParse(v).error?.issues ?? [];
const PRICE = { rooms: [{ units: 6, price: 80000 }] }; // 2 nights x 1 bed = 160000 + 5% GST = 168000

describe('request-to-book approval flow', () => {
  it('request -> approve -> guest pays -> confirmed, with the hold extended to a payment window', async () => {
    const host = await makeHost({ bookingMode: 'APPROVAL', ...PRICE });
    const guest = await makeGuest();
    const b = (await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id))).body.data;
    const res = await call(ownerApprove, { token: host.owner.token, params: { id: b.id } });
    expect(res.status).toBe(200);
    expect(issues(bookingDtoSchema, res.body.data)).toEqual([]);
    expect(res.body.data).toMatchObject({ status: 'PENDING_PAYMENT', viewer: 'OWNER' });
    const mins = (new Date(res.body.data.holdExpiresAt).getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(170);
    expect(mins).toBeLessThanOrEqual(180);
    expect((await notificationsFor(guest.id)).map((n) => n.type)).toContain('BOOKING_APPROVED');
    expect(outbox.some((m) => m.subject === `Accepted: pay now to confirm ${b.code}`)).toBe(true);
    const mine = await call(getBooking, { method: 'GET', token: guest.token, params: { id: b.id } });
    expect(mine.body.data.actions).toEqual(expect.arrayContaining(['pay', 'cancel']));
    expect((await pay(guest.token, b.id)).checkout.body.data.status).toBe('CAPTURED');
    expect((await row(b.id)).status).toBe('CONFIRMED');
    expect((await prisma.bookingStatusHistory.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: 'asc' } })).map((h) => `${h.fromStatus}>${h.toStatus}:${h.actorRole}`)).toEqual([
      'null>PENDING_APPROVAL:GUEST', 'PENDING_APPROVAL>PENDING_PAYMENT:OWNER', 'PENDING_PAYMENT>CONFIRMED:SYSTEM',
    ]);
  });

  it('reject releases the beds and the coupon and tells the guest why; nothing can be approved twice', async () => {
    const host = await makeHost({ bookingMode: 'APPROVAL', rooms: [{ units: 1, price: 80000 }] });
    const guest = await makeGuest();
    const b = (await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id))).body.data;
    expect((await call(ownerReject, { token: host.owner.token, params: { id: b.id }, body: { reason: 'no' } })).status).toBe(422); // a reason is required
    const rej = await call(ownerReject, { token: host.owner.token, params: { id: b.id }, body: { reason: 'Fully booked that weekend for a group.' } });
    expect(rej.body.data).toMatchObject({ status: 'REJECTED', cancelReason: 'Fully booked that weekend for a group.' });
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [0, 0] });
    expect((await notificationsFor(guest.id)).find((n) => n.type === 'BOOKING_REJECTED')?.body).toContain('Fully booked that weekend');
    expect((await call(ownerApprove, { token: host.owner.token, params: { id: b.id } })).status).toBe(409);
    expect((await pay(guest.token, b.id)).init.status).toBe(409);
    expect((await book((await makeGuest()).token, bookingBody(host.hostel.id, host.rooms[0]!.id))).status).toBe(201); // the bed is free again
  });

  it('only the property\'s own owner can decide; guests and other owners cannot', async () => {
    const host = await makeHost({ bookingMode: 'APPROVAL', ...PRICE });
    const other = await makeHost();
    const guest = await makeGuest();
    const b = (await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id))).body.data;
    expect((await call(ownerApprove, { token: other.owner.token, params: { id: b.id } })).status).toBe(404);
    expect((await call(ownerApprove, { token: guest.token, params: { id: b.id } })).status).toBe(403);
    expect((await row(b.id)).status).toBe('PENDING_APPROVAL');
  });

  it('an unanswered request expires with a notice, and a late approval is refused', async () => {
    const host = await makeHost({ bookingMode: 'APPROVAL', rooms: [{ units: 1 }] });
    const guest = await makeGuest();
    const b = (await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id))).body.data;
    await prisma.booking.update({ where: { id: b.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const late = await call(ownerApprove, { token: host.owner.token, params: { id: b.id } }); // deadline passed, sweeper has not run yet
    expect(late.status).toBe(409);
    expect(late.body.error.message).toMatch(/expired/);
    expect(await expireDueBookings({ hostelId: host.hostel.id })).toBe(1);
    expect(await row(b.id)).toMatchObject({ status: 'EXPIRED' });
    expect((await prisma.bookingStatusHistory.findFirstOrThrow({ where: { bookingId: b.id, toStatus: 'EXPIRED' } })).reason).toMatch(/No response from the property/);
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [0, 0] });
    expect((await call(ownerApprove, { token: host.owner.token, params: { id: b.id } })).status).toBe(409);
  });

  it('owners cannot cancel a pending request (they must reject it); admins can', async () => {
    const host = await makeHost({ bookingMode: 'APPROVAL', ...PRICE });
    const guest = await makeGuest();
    const admin = await makeUser({ roles: ['ADMIN'] });
    const b = (await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id))).body.data;
    const res = await call(ownerCancel, { token: host.owner.token, params: { id: b.id }, body: { reason: 'Changed my mind' } });
    expect(res.status).toBe(403);
    expect((await call(adminCancel, { token: admin.token, params: { id: b.id }, body: { reason: 'Requested by support' } })).status).toBe(200);
  });
});

describe('cancellation refunds follow the policy (and the ledger always balances)', () => {
  const cases: [string, 'FLEXIBLE' | 'MODERATE' | 'STRICT', number, number][] = [
    ['FLEXIBLE 48h before', 'FLEXIBLE', 48, 100], ['FLEXIBLE 12h before', 'FLEXIBLE', 12, 0],
    ['MODERATE 8 days before', 'MODERATE', 192, 100], ['MODERATE 3 days before', 'MODERATE', 72, 50], ['MODERATE 10h before', 'MODERATE', 10, 0],
    ['STRICT 8 days before', 'STRICT', 192, 50], ['STRICT 4 days before', 'STRICT', 96, 0],
  ];
  it.each(cases)('%s -> %i%% refund', async (_name, policy, hoursBefore, percent) => {
    const host = await makeHost({ cancellationPolicy: policy, ...PRICE });
    const guest = await makeGuest();
    const id = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id);
    const now = new Date(checkInAt(STAY.checkIn).getTime() - hoursBefore * 3_600_000);

    const res = await bookingsService.cancel(actor(guest, 'GUEST'), 'GUEST', id, 'Plans changed', now);
    const refund = Math.floor((168000 * percent) / 100);
    expect(res).toMatchObject({ status: 'CANCELLED_BY_GUEST', cancelledBy: 'GUEST', cancelReason: 'Plans changed' });
    expect(res.refund).toEqual(refund > 0 ? { amountPaise: refund, status: 'PROCESSED', reason: expect.stringContaining(`${percent}%`) } : null);
    expect(res.payment).toMatchObject({ amountPaise: 168000, refundedPaise: refund, status: refund === 168000 ? 'REFUNDED' : refund > 0 ? 'PARTIALLY_REFUNDED' : 'CAPTURED' });

    const bal = await ledgerBalances(id);
    expect(bal).toMatchObject({ PLATFORM_ESCROW: 0, REFUND_PAYABLE: 0, GUEST: 0 - (168000 - refund) });
    const retained = 168000 - refund;
    expect(bal.TAX_PAYABLE).toBe(Math.round((8000 * retained) / 168000));
    expect(bal.OWNER_PAYABLE + bal.PLATFORM_REVENUE + bal.TAX_PAYABLE).toBe(retained); // every retained paisa is accounted for
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [0, 0], booked: [0, 0] }); // beds back on sale
    expect((await notificationsFor(host.owner.id)).map((n) => n.type)).toContain('BOOKING_CANCELLED');
    expect((await notificationsFor(guest.id)).filter((n) => n.type === 'BOOKING_CANCELLED')).toHaveLength(1);
  });

  it('the preview endpoint tells the guest exactly what cancelling would refund', async () => {
    const host = await makeHost({ cancellationPolicy: 'MODERATE', ...PRICE });
    const guest = await makeGuest();
    const id = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id);
    const p = await call(preview, { method: 'GET', token: guest.token, params: { id } }); // check-in is 20 days away
    expect(p.body.data).toEqual({ refundPercent: 100, refundPaise: 168000, retainedPaise: 0, currency: 'INR' });
    const dto = (await call(getBooking, { method: 'GET', token: guest.token, params: { id } })).body.data;
    expect(dto.cancellation).toMatchObject({ refundPercentNow: 100, refundPaiseNow: 168000, summary: expect.stringContaining('5 days') });
    expect((await call(preview, { method: 'GET', token: (await makeGuest()).token, params: { id } })).status).toBe(404);
  });

  it('cancelling an unpaid booking just releases the hold, the coupon and the open payment order', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const b = (await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id))).body.data;
    const { paymentId } = await pay(guest.token, b.id, 'DEMO_TIMEOUT');
    const res = await call(guestCancel, { token: guest.token, params: { id: b.id }, body: { reason: 'Found another place' } });
    expect(res.body.data).toMatchObject({ status: 'CANCELLED_BY_GUEST', refund: null });
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [0, 0] });
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: paymentId! } })).toMatchObject({ status: 'FAILED', failureCode: 'CANCELLED' });
    expect(await prisma.ledgerEntry.count({ where: { bookingId: b.id } })).toBe(0); // no money ever moved
  });

  it('owner and admin cancellations refund in full whatever the policy, and record who did it', async () => {
    const host = await makeHost({ cancellationPolicy: 'STRICT', ...PRICE });
    const admin = await makeUser({ roles: ['ADMIN'] });
    const g1 = await makeGuest(), g2 = await makeGuest();
    const id1 = await confirmedBooking(g1.token, host.hostel.id, host.rooms[0]!.id);
    const id2 = await confirmedBooking(g2.token, host.hostel.id, host.rooms[0]!.id);
    const o = await call(ownerCancel, { token: host.owner.token, params: { id: id1 }, body: { reason: 'Water supply is down' } });
    expect(o.body.data).toMatchObject({ status: 'CANCELLED_BY_OWNER', cancelledBy: 'OWNER', refund: { amountPaise: 168000, status: 'PROCESSED' }, payment: { status: 'REFUNDED' } });
    const a = await call(adminCancel, { token: admin.token, params: { id: id2 }, body: { reason: 'Fraud review outcome' } });
    expect(a.body.data).toMatchObject({ status: 'CANCELLED_BY_OWNER', cancelledBy: 'ADMIN', refund: { amountPaise: 168000 } });
    for (const id of [id1, id2]) expect(await ledgerBalances(id)).toMatchObject({ GUEST: 0, PLATFORM_ESCROW: 0, OWNER_PAYABLE: 0, PLATFORM_REVENUE: 0, REFUND_PAYABLE: 0 });
    expect((await notificationsFor(g1.id)).find((n) => n.title === 'Booking cancelled by the property')?.body).toContain('Water supply is down');
    expect((await call(ownerCancel, { token: host.owner.token, params: { id: id1 }, body: { reason: 'Again please' } })).status).toBe(409); // already cancelled
  });

  it('five simultaneous cancellations: exactly one succeeds and the refund is paid once', async () => {
    const host = await makeHost({ cancellationPolicy: 'FLEXIBLE', ...PRICE });
    const guest = await makeGuest();
    const id = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id);
    const results = await Promise.all(Array.from({ length: 5 }, () => call(guestCancel, { token: guest.token, params: { id }, body: {} })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await prisma.refund.count({ where: { bookingId: id } })).toBe(1);
    expect((await prisma.payment.findFirstOrThrow({ where: { bookingId: id } })).refundedPaise).toBe(168000);
    expect(await ledgerBalances(id)).toMatchObject({ GUEST: 0, PLATFORM_ESCROW: 0, REFUND_PAYABLE: 0 });
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ booked: [0, 0] }); // freed once, not into the negative
  });
});

describe('refund resilience', () => {
  it('a gateway outage leaves the refund PENDING with the obligation on the ledger, and retries pay it exactly once', async () => {
    const provider = new DemoProvider();
    provider.failRefunds = 2;
    setPaymentProvider(provider);
    const host = await makeHost({ cancellationPolicy: 'FLEXIBLE', ...PRICE });
    const guest = await makeGuest();
    const id = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id);
    const res = await call(guestCancel, { token: guest.token, params: { id }, body: {} });
    expect(res.status).toBe(200); // cancelling never fails because the gateway is down
    expect(res.body.data.refund).toMatchObject({ amountPaise: 168000, status: 'PENDING' });
    expect(await ledgerBalances(id)).toMatchObject({ PLATFORM_ESCROW: 0, REFUND_PAYABLE: 168000, GUEST: -168000 }); // owed, not yet paid
    expect((await prisma.payment.findFirstOrThrow({ where: { bookingId: id } })).status).toBe('CAPTURED');

    const later = new Date(Date.now() + 60_000);
    expect(await refundsService.retryPending(later)).toMatchObject({ processed: 0 }); // second failure
    expect(await refundsService.retryPending(later)).toMatchObject({ processed: 1 }); // third call succeeds
    expect(await ledgerBalances(id)).toMatchObject({ REFUND_PAYABLE: 0, GUEST: 0 });
    expect(await prisma.payment.findFirstOrThrow({ where: { bookingId: id } })).toMatchObject({ status: 'REFUNDED', refundedPaise: 168000 });
    expect(new Set(provider.refundCalls.map((c) => c.idempotencyKey))).toEqual(new Set([`cancel:${id}`])); // one idempotent refund request, repeated
    const refund = await prisma.refund.findFirstOrThrow({ where: { bookingId: id } });
    expect(await refundsService.process(refund.id)).toBe('skipped');
    expect(await refundsService.retryPending(later)).toMatchObject({ processed: 0 });
    expect((await notificationsFor(guest.id)).filter((n) => n.type === 'REFUND_PROCESSED')).toHaveLength(1);
  });

  it('processing the same refund from many workers at once pays it once', async () => {
    const provider = new DemoProvider();
    provider.failRefunds = 1; // the cancellation's own attempt fails, leaving it PENDING
    setPaymentProvider(provider);
    const host = await makeHost({ cancellationPolicy: 'FLEXIBLE', ...PRICE });
    const guest = await makeGuest();
    const id = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id);
    await call(guestCancel, { token: guest.token, params: { id }, body: {} });
    const refund = await prisma.refund.findFirstOrThrow({ where: { bookingId: id } });
    expect(refund.status).toBe('PENDING');
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => refundsService.process(refund.id)));
    expect(outcomes.filter((o) => o === 'processed')).toHaveLength(1);
    expect((await prisma.payment.findFirstOrThrow({ where: { bookingId: id } })).refundedPaise).toBe(168000); // not 6 x
    expect(await prisma.ledgerEntry.count({ where: { bookingId: id, debitAccount: 'REFUND_PAYABLE' } })).toBe(1);
  });

  it('a refund stuck for 48 hours is marked FAILED and escalated to admins', async () => {
    const provider = new DemoProvider();
    provider.failRefunds = 1000;
    setPaymentProvider(provider);
    const host = await makeHost({ cancellationPolicy: 'FLEXIBLE', ...PRICE });
    const admin = await makeUser({ roles: ['ADMIN'] });
    const guest = await makeGuest();
    const id = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id);
    await call(guestCancel, { token: guest.token, params: { id }, body: {} });
    const result = await refundsService.retryPending(new Date(Date.now() + 49 * 3_600_000));
    expect(result.stuck).toBeGreaterThanOrEqual(1);
    expect((await prisma.refund.findFirstOrThrow({ where: { bookingId: id } })).status).toBe('FAILED');
    expect((await notificationsFor(admin.id)).some((n) => n.title === 'Refund needs manual attention')).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'refund.failed', entityId: id, outcome: 'FAILURE' } })).toBe(1);
  });
});

describe('the stay: check-in, completion and no-show', () => {
  const today = { checkIn: TODAY, checkOut: addDays(TODAY, 2) };

  it('check-in opens on the check-in date, completion on the check-out date, and completing settles the ledger', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const early = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id); // checks in in 20 days
    expect((await call(ownerCheckIn, { token: host.owner.token, params: { id: early }, body: {} })).status).toBe(409);

    const id = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id, today);
    const ci = await call(ownerCheckIn, { token: host.owner.token, params: { id }, body: { notes: 'ID verified: Aadhaar' } });
    expect(ci.body.data).toMatchObject({ status: 'CHECKED_IN', actions: [], guest: { email: expect.any(String), phone: '+919876543210' } }); // contact is shown once confirmed
    expect(ci.body.data.checkedInAt).toBeTruthy();
    expect((await call(ownerCheckIn, { token: host.owner.token, params: { id }, body: {} })).status).toBe(409);
    expect((await call(guestCancel, { token: guest.token, params: { id }, body: {} })).status).toBe(409); // too late to cancel
    await expect(bookingLifecycle.complete(actor(host.owner, 'OWNER'), 'OWNER', id, at(addDays(TODAY, 1)))).rejects.toMatchObject({ code: 'CONFLICT' }); // the stay has not ended

    const done = await bookingLifecycle.complete(actor(host.owner, 'OWNER'), 'OWNER', id, at(addDays(TODAY, 2)));
    expect(done).toMatchObject({ status: 'COMPLETED', actions: [] });
    expect(await ledgerBalances(id)).toMatchObject({ PLATFORM_ESCROW: 0, OWNER_PAYABLE: 144000, PLATFORM_REVENUE: 16000, TAX_PAYABLE: 8000, GUEST: -168000 });
    expect((await notificationsFor(guest.id)).map((n) => n.type)).toContain('REVIEW_REQUESTED');
    expect(outbox.some((m) => m.subject === `How was ${host.hostel.name}?`)).toBe(true);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: { in: ['booking.checked_in', 'booking.completed'] } } })).toBe(2);
  });

  it('no-show keeps the payment, settles it, and returns the nights still ahead to sale', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const early = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id);
    expect((await call(ownerNoShow, { token: host.owner.token, params: { id: early } })).status).toBe(409); // not before the check-in date

    const id = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id, today);
    expect((await inventoryOf(host.rooms[0]!.id, today.checkIn, today.checkOut)).booked).toEqual([1, 1]);
    const res = await call(ownerNoShow, { token: host.owner.token, params: { id } });
    expect(res.body.data).toMatchObject({ status: 'NO_SHOW', payment: { status: 'CAPTURED', refundedPaise: 0 }, refund: null });
    expect((await inventoryOf(host.rooms[0]!.id, today.checkIn, today.checkOut)).booked).toEqual([0, 0]);
    expect(await ledgerBalances(id)).toMatchObject({ PLATFORM_ESCROW: 0, OWNER_PAYABLE: 144000, PLATFORM_REVENUE: 16000, TAX_PAYABLE: 8000, REFUND_PAYABLE: 0 });
    expect((await notificationsFor(guest.id)).some((n) => n.title === 'Marked as no-show')).toBe(true);
  });

  it('a platform-funded coupon is absorbed by the platform; an owner-funded one reduces the owner\'s share', async () => {
    const host = await makeHost(PRICE);
    const admin = await makeUser({ roles: ['ADMIN'] });
    const mk = (hostelId: string | null, createdById: string) => prisma.coupon.create({ data: { code: uniq('SET').toUpperCase(), discountType: 'PERCENT', percentBps: 1000, maxDiscountPaise: 100000, hostelId, createdById, validFrom: D(addDays(TODAY, -2)), validTo: D(addDays(TODAY, 90)), usageLimit: 10, perUserLimit: 1 } });
    const platform = await mk(null, admin.id);
    const ownerFunded = await mk(host.hostel.id, host.owner.id);
    const g1 = await makeGuest(), g2 = await makeGuest();
    const p1 = await confirmedBooking(g1.token, host.hostel.id, host.rooms[0]!.id, { ...today, couponCode: platform.code });
    const p2 = await confirmedBooking(g2.token, host.hostel.id, host.rooms[0]!.id, { ...today, couponCode: ownerFunded.code });
    for (const id of [p1, p2]) await bookingLifecycle.noShow(actor(host.owner, 'OWNER'), 'OWNER', id); // settles like a completion
    // subtotal 160000, 10% off = 16000, GST 5% of 144000 = 7200, guest paid 151200
    expect(await ledgerBalances(p1)).toMatchObject({ PLATFORM_ESCROW: 0, GUEST: -151200, OWNER_PAYABLE: 144000, PLATFORM_REVENUE: 0, TAX_PAYABLE: 7200 }); // owner earns on the full 160000 less 10%; platform nets 16000 - 16000
    expect(await ledgerBalances(p2)).toMatchObject({ PLATFORM_ESCROW: 0, GUEST: -151200, OWNER_PAYABLE: 129600, PLATFORM_REVENUE: 14400, TAX_PAYABLE: 7200 });
  });
});

describe('scheduled sweeps', () => {
  it('auto-completes stays after check-out, and records no-shows two days after the check-in date', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const ownerA = actor(host.owner, 'OWNER');
    const stayId = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id, { checkIn: TODAY, checkOut: addDays(TODAY, 2) });
    await bookingLifecycle.checkIn(ownerA, 'OWNER', stayId, undefined);
    const ghostId = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id); // checks in on STAY.checkIn and never shows

    expect(await bookingLifecycle.sweep(at(addDays(TODAY, 2)), { hostelId: host.hostel.id })).toEqual({ completed: 0, noShows: 0 }); // check-out day itself: still the owner's call
    expect((await row(stayId)).status).toBe('CHECKED_IN');
    expect(await bookingLifecycle.sweep(at(addDays(TODAY, 3)), { hostelId: host.hostel.id })).toEqual({ completed: 1, noShows: 0 });
    expect((await row(stayId)).status).toBe('COMPLETED');
    expect(await ledgerBalances(stayId)).toMatchObject({ PLATFORM_ESCROW: 0, OWNER_PAYABLE: 144000 });
    expect((await prisma.bookingStatusHistory.findFirstOrThrow({ where: { bookingId: stayId, toStatus: 'COMPLETED' } })).actorRole).toBe('SYSTEM');

    expect(await bookingLifecycle.sweep(at(addDays(STAY.checkIn, 1)), { hostelId: host.hostel.id })).toEqual({ completed: 0, noShows: 0 }); // one day late: still allowed to arrive
    expect(await bookingLifecycle.sweep(at(addDays(STAY.checkIn, 2)), { hostelId: host.hostel.id })).toEqual({ completed: 0, noShows: 1 });
    expect((await row(ghostId)).status).toBe('NO_SHOW');
    expect(await ledgerBalances(ghostId)).toMatchObject({ PLATFORM_ESCROW: 0, OWNER_PAYABLE: 144000, PLATFORM_REVENUE: 16000 });
    expect(await bookingLifecycle.sweep(at(addDays(STAY.checkIn, 9)), { hostelId: host.hostel.id })).toEqual({ completed: 0, noShows: 0 }); // idempotent
  });

  it('sends one reminder, the day before check-in', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const id = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id);
    expect(await bookingLifecycle.sendReminders(at(addDays(STAY.checkIn, -3)), { hostelId: host.hostel.id })).toBe(0);
    expect(await bookingLifecycle.sendReminders(at(addDays(STAY.checkIn, -1)), { hostelId: host.hostel.id })).toBe(1);
    expect(await bookingLifecycle.sendReminders(at(addDays(STAY.checkIn, -1)), { hostelId: host.hostel.id })).toBe(0); // never twice
    expect((await notificationsFor(guest.id)).filter((n) => n.type === 'BOOKING_REMINDER')).toHaveLength(1);
    expect(outbox.some((m) => m.subject === `Tomorrow: ${host.hostel.name}`)).toBe(true);
    expect(await row(id)).toMatchObject({ status: 'CONFIRMED' });
  });
});

describe('earnings, ledger and audit views', () => {
  it('owner earnings reconcile with the ledger', async () => {
    const hostA = await makeHost({ rooms: [{ units: 6, price: 80000 }] });
    const hostB = await makeHost({ ownerId: undefined, rooms: [{ units: 6, price: 80000 }] });
    const guest = await makeGuest();
    const ownerA = actor(hostA.owner, 'OWNER');
    const today = { checkIn: TODAY, checkOut: addDays(TODAY, 2) };
    const done1 = await confirmedBooking(guest.token, hostA.hostel.id, hostA.rooms[0]!.id, today);
    const done2 = await confirmedBooking(guest.token, hostA.hostel.id, hostA.rooms[0]!.id, today);
    const upcoming = await confirmedBooking(guest.token, hostA.hostel.id, hostA.rooms[0]!.id);
    for (const id of [done1, done2]) { await bookingLifecycle.checkIn(ownerA, 'OWNER', id, undefined); await bookingLifecycle.complete(ownerA, 'OWNER', id, at(addDays(TODAY, 2))); }
    const cancelled = await confirmedBooking(guest.token, hostA.hostel.id, hostA.rooms[0]!.id, { checkIn: addDays(TODAY, 40), checkOut: addDays(TODAY, 42) });
    await bookingsService.cancel(actor(guest, 'GUEST'), 'GUEST', cancelled, undefined, at(addDays(TODAY, 40))); // on the check-in day itself: no refund, the amount is kept
    expect((await row(cancelled)).status).toBe('CANCELLED_BY_GUEST');
    await confirmedBooking(guest.token, hostB.hostel.id, hostB.rooms[0]!.id, today); // someone else's property

    const res = await call(earnings, { method: 'GET', token: hostA.owner.token });
    expect(issues(earningsSchema, res.body.data)).toEqual([]);
    expect(res.body.data.settled).toEqual({ bookings: 3, ownerPayablePaise: 3 * 144000, commissionPaise: 3 * 16000, taxPaise: 3 * 8000, refundedPaise: 0 });
    expect(res.body.data.upcoming).toEqual({ bookings: 1, expectedOwnerPaise: 144000 });
    expect(res.body.data.byHostel).toEqual([{ hostelId: hostA.hostel.id, name: hostA.hostel.name, bookings: 3, ownerPayablePaise: 3 * 144000 }]);
    expect((await call(earnings, { method: 'GET', token: hostA.owner.token, query: `?hostelId=${hostB.hostel.id}` })).body.data.settled.ownerPayablePaise).toBe(0);
    expect((await call(earnings, { method: 'GET', token: hostA.owner.token, query: `?from=${addDays(TODAY, -60)}&to=${addDays(TODAY, -40)}` })).body.data.settled.ownerPayablePaise).toBe(0); // outside the range
    expect((await call(earnings, { method: 'GET', token: hostB.owner.token })).body.data.settled.ownerPayablePaise).toBe(0); // B has nothing settled yet
    expect((await call(earnings, { method: 'GET', token: guest.token })).status).toBe(403);
    expect((await call(earnings, { method: 'GET', token: hostA.owner.token, query: '?from=nope' })).status).toBe(422);
    void upcoming;
  });

  it('admins can inspect a booking\'s money trail and the audit log; nobody else can', async () => {
    const host = await makeHost({ cancellationPolicy: 'FLEXIBLE', ...PRICE });
    const admin = await makeUser({ roles: ['ADMIN'] });
    const guest = await makeGuest();
    const id = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id);
    await call(guestCancel, { token: guest.token, params: { id }, body: { reason: 'Plans changed' } });

    const ledger = await call(adminLedger, { method: 'GET', token: admin.token, params: { id } });
    expect(ledger.body.data.entries.map((e: { from: string; to: string }) => `${e.from}>${e.to}`)).toEqual(['GUEST>PLATFORM_ESCROW', 'PLATFORM_ESCROW>REFUND_PAYABLE', 'REFUND_PAYABLE>GUEST']);
    expect(ledger.body.data.balances).toMatchObject({ PLATFORM_ESCROW: 0, REFUND_PAYABLE: 0, GUEST: 0 });
    expect((await call(adminLedger, { method: 'GET', token: host.owner.token, params: { id } })).status).toBe(403);
    expect((await call(adminLedger, { method: 'GET', token: admin.token, params: { id: '00000000-0000-4000-8000-000000000000' } })).status).toBe(404);

    const trail = await call(auditLogs, { method: 'GET', token: admin.token, query: `?entityType=booking&entityId=${id}&limit=50` });
    for (const e of trail.body.data) expect(issues(auditEntrySchema, e)).toEqual([]);
    const actions = [...trail.body.data].reverse().map((e: { action: string }) => e.action); // oldest first
    expect(actions.slice(0, 2)).toEqual(['booking.created', 'payment.initiated']);
    expect(actions).toEqual(expect.arrayContaining(['payment.captured', 'booking.confirmed', 'booking.cancelled_by_guest', 'refund.processed']));
    const cancelEntry = trail.body.data.find((e: { action: string }) => e.action === 'booking.cancelled_by_guest');
    expect(cancelEntry).toMatchObject({ actorId: guest.id, actorRole: 'GUEST', before: { status: 'CONFIRMED' }, after: { status: 'CANCELLED_BY_GUEST' }, metadata: { reason: 'Plans changed' } });
    expect(cancelEntry.hash).toHaveLength(64);

    const page1 = await call(auditLogs, { method: 'GET', token: admin.token, query: `?entityId=${id}&limit=3` });
    expect(page1.body.data).toHaveLength(3);
    const page2 = await call(auditLogs, { method: 'GET', token: admin.token, query: `?entityId=${id}&limit=3&cursor=${page1.body.meta.nextCursor}` });
    expect(page2.body.data[0].id < page1.body.data[2].id || BigInt(page2.body.data[0].id) < BigInt(page1.body.data[2].id)).toBe(true);
    expect((await call(auditLogs, { method: 'GET', token: admin.token, query: `?action=booking.&entityId=${id}` })).body.data.every((e: { action: string }) => e.action.startsWith('booking.'))).toBe(true);
    expect((await call(auditLogs, { method: 'GET', token: host.owner.token })).status).toBe(403);
    expect((await call(auditLogs, { method: 'GET', token: admin.token, query: '?cursor=abc' })).status).toBe(422);

    const verify = await call(auditVerify, { method: 'GET', token: admin.token });
    expect(issues(auditVerifySchema, verify.body.data)).toEqual([]);
    expect(verify.body.data).toMatchObject({ intact: true, broken: [] });
    expect((await call(auditVerify, { method: 'GET', token: guest.token })).status).toBe(403);
  });
});
