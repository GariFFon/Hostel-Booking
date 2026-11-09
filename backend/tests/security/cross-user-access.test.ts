import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { GET as getBooking } from '@/app/api/v1/bookings/[id]/route';
import { GET as cancelPreview } from '@/app/api/v1/bookings/[id]/cancellation-preview/route';
import { POST as cancelBooking } from '@/app/api/v1/bookings/[id]/cancel/route';
import { POST as startPayment } from '@/app/api/v1/bookings/[id]/payments/route';
import { GET as getPayment } from '@/app/api/v1/payments/[id]/route';
import { POST as demoCheckout } from '@/app/api/v1/payments/[id]/demo-checkout/route';
import { GET as ownerBooking } from '@/app/api/v1/owner/bookings/[id]/route';
import { POST as ownerCancel } from '@/app/api/v1/owner/bookings/[id]/cancel/route';
import { POST as ownerApprove } from '@/app/api/v1/owner/bookings/[id]/approve/route';
import { GET as ownerHostel, PATCH as patchHostel, DELETE as deleteHostel } from '@/app/api/v1/owner/hostels/[id]/route';
import { POST as submitHostel } from '@/app/api/v1/owner/hostels/[id]/submit/route';
import { POST as addRoom } from '@/app/api/v1/owner/hostels/[id]/room-types/route';
import { PATCH as patchRoom, DELETE as deleteRoom } from '@/app/api/v1/owner/room-types/[id]/route';
import { GET as roomCalendar } from '@/app/api/v1/owner/room-types/[id]/calendar/route';
import { POST as markRead } from '@/app/api/v1/me/notifications/[id]/read/route';
import { DELETE as deleteNotification } from '@/app/api/v1/me/notifications/[id]/route';
import { GET as adminBookings } from '@/app/api/v1/admin/bookings/route';
import { GET as adminAudit } from '@/app/api/v1/admin/audit-logs/route';
import { POST as adminApprove } from '@/app/api/v1/admin/hostels/[id]/approve/route';
import { GET as ownerEarnings } from '@/app/api/v1/owner/earnings/route';
import { GET as ownerHostels } from '@/app/api/v1/owner/hostels/route';
import { PATCH as patchMe } from '@/app/api/v1/me/route';
import { POST as register } from '@/app/api/v1/auth/register/route';
import { call } from '../helpers/http';
import { book, bookingBody, confirmedBooking, makeGuest, makeHost, notificationsFor } from '../helpers/booking';
import { uniq } from '../helpers/publish';

/**
 * Convention under test: someone else's object looks exactly like a missing one (404, no existence leak);
 * the wrong *role* gets 403; request bodies can never grant privileges.
 */
let hostA: Awaited<ReturnType<typeof makeHost>>;
let hostB: Awaited<ReturnType<typeof makeHost>>;
let guestA: Awaited<ReturnType<typeof makeGuest>>;
let guestB: Awaited<ReturnType<typeof makeGuest>>;
let confirmedId: string;
let pendingId: string;
let paymentId: string;
let roomId: string;
let notificationId: string;

beforeAll(async () => {
  await redis.flushdb();
  [hostA, hostB, guestA, guestB] = await Promise.all([makeHost(), makeHost(), makeGuest(), makeGuest()]);
  roomId = hostA.rooms[0]!.id;
  confirmedId = await confirmedBooking(guestA.token, hostA.hostel.id, roomId);
  const pending = await book(guestA.token, bookingBody(hostA.hostel.id, roomId, { checkIn: '2027-03-01', checkOut: '2027-03-03' }));
  expect(pending.status).toBe(201);
  pendingId = pending.body.data.id;
  const init = await call(startPayment, { token: guestA.token, params: { id: pendingId } });
  expect(init.status).toBe(201);
  paymentId = init.body.data.id;
  notificationId = (await notificationsFor(guestA.id))[0]!.id;
});

const as = (token: string, params: Record<string, string>, method?: string, body?: unknown) => ({ token, params, method, ...(body === undefined ? {} : { body }) });

describe("another guest cannot touch a guest's booking or payment (404, not 403)", () => {
  it.each([
    ['read the booking', () => call(getBooking, as(guestB.token, { id: confirmedId }, 'GET'))],
    ['see its cancellation preview', () => call(cancelPreview, as(guestB.token, { id: confirmedId }, 'GET'))],
    ['cancel it', () => call(cancelBooking, as(guestB.token, { id: confirmedId }, 'POST', {}))],
    ['start a payment for it', () => call(startPayment, as(guestB.token, { id: pendingId }, 'POST'))],
    ['read its payment', () => call(getPayment, as(guestB.token, { id: paymentId }, 'GET'))],
    ["pay with someone else's payment order", () => call(demoCheckout, as(guestB.token, { id: paymentId }, 'POST', { instrument: 'DEMO_SUCCESS', method: 'UPI' }))],
    ['read it through the host endpoint', () => call(ownerBooking, as(guestB.token, { id: confirmedId }, 'GET'))],
  ])('cannot %s', async (_name, run) => {
    const res = await run();
    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });

  it('answers 404 (not 403) for the guest endpoints, so booking ids cannot be probed', async () => {
    expect((await call(getBooking, as(guestB.token, { id: confirmedId }, 'GET'))).status).toBe(404);
    expect((await call(getPayment, as(guestB.token, { id: paymentId }, 'GET'))).status).toBe(404);
  });

  it("the owner of a different property cannot read, cancel or approve the booking", async () => {
    expect((await call(getBooking, as(hostB.owner.token, { id: confirmedId }, 'GET'))).status).toBe(404);
    expect((await call(ownerBooking, as(hostB.owner.token, { id: confirmedId }, 'GET'))).status).toBe(404);
    expect((await call(ownerCancel, as(hostB.owner.token, { id: confirmedId }, 'POST', { reason: 'nope nope' }))).status).toBe(404);
    expect((await call(ownerApprove, as(hostB.owner.token, { id: confirmedId }, 'POST', {}))).status).toBe(404);
  });

  it('the booking is unchanged after all of that', async () => {
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: confirmedId } });
    expect(b.status).toBe('CONFIRMED');
  });
});

describe("an owner cannot manage another owner's listing", () => {
  const hostelOfA = () => ({ id: hostA.hostel.id });
  it.each([
    ['read it', () => call(ownerHostel, as(hostB.owner.token, hostelOfA(), 'GET'))],
    ['edit it', () => call(patchHostel, as(hostB.owner.token, hostelOfA(), 'PATCH', { name: 'Hijacked' }))],
    ['delete it', () => call(deleteHostel, as(hostB.owner.token, hostelOfA(), 'DELETE'))],
    ['submit it for review', () => call(submitHostel, as(hostB.owner.token, hostelOfA(), 'POST', {}))],
    ['add a room to it', () => call(addRoom, as(hostB.owner.token, hostelOfA(), 'POST', { name: 'Fake', kind: 'DORM', gender: 'MIXED', totalUnits: 1, capacity: 1, maxOccupancyPerUnit: 1, basePricePaise: 100 }))],
    ['edit its rooms', () => call(patchRoom, as(hostB.owner.token, { id: roomId }, 'PATCH', { name: 'Hijacked' }))],
    ['delete its rooms', () => call(deleteRoom, as(hostB.owner.token, { id: roomId }, 'DELETE'))],
    ["read a room's calendar", () => call(roomCalendar, { ...as(hostB.owner.token, { id: roomId }, 'GET'), query: '?from=2027-01-01&to=2027-01-10' })],
  ])('cannot %s', async (_name, run) => {
    const res = await run();
    expect(res.status).toBe(404);
  });

  it('nothing changed', async () => {
    const h = await prisma.hostel.findUniqueOrThrow({ where: { id: hostA.hostel.id } });
    expect(h.name).not.toBe('Hijacked');
    expect(h.deletedAt).toBeNull();
    expect(await prisma.roomType.count({ where: { id: roomId, deletedAt: null } })).toBe(1);
  });
});

describe('notifications are private', () => {
  it("another user cannot mark or delete someone else's notification", async () => {
    expect((await call(markRead, as(guestB.token, { id: notificationId }, 'POST', {}))).status).toBe(404);
    expect((await call(deleteNotification, as(guestB.token, { id: notificationId }, 'DELETE'))).status).toBe(404);
    expect(await prisma.notification.count({ where: { id: notificationId } })).toBe(1);
  });
});

describe('roles gate whole areas (403)', () => {
  it('a guest cannot use host endpoints', async () => {
    expect((await call(ownerEarnings, { token: guestA.token, method: 'GET' })).status).toBe(403);
    expect((await call(ownerHostels, { token: guestA.token, method: 'GET' })).status).toBe(403);
  });
  it('guests and owners cannot use admin endpoints', async () => {
    for (const token of [guestA.token, hostA.owner.token]) {
      expect((await call(adminBookings, { token, method: 'GET' })).status).toBe(403);
      expect((await call(adminAudit, { token, method: 'GET' })).status).toBe(403);
      expect((await call(adminApprove, as(token, { id: hostA.hostel.id }, 'POST', {}))).status).toBe(403);
    }
  });
});

describe('request bodies can never grant privileges', () => {
  it('PATCH /me ignores or rejects roles, verification and status fields', async () => {
    const before = await prisma.userRoleAssignment.findMany({ where: { userId: guestA.id } });
    const res = await call(patchMe, { token: guestA.token, method: 'PATCH', body: { fullName: 'Asha', roles: ['ADMIN'], emailVerified: true, status: 'ACTIVE', id: hostA.owner.id } });
    expect([200, 422]).toContain(res.status);
    const after = await prisma.userRoleAssignment.findMany({ where: { userId: guestA.id } });
    expect(after.map((r) => r.role).sort()).toEqual(before.map((r) => r.role).sort());
    expect(after.some((r) => r.role === 'ADMIN')).toBe(false);
  });

  it('registration cannot create an admin', async () => {
    const email = `${uniq('evil')}@test.dev`;
    const res = await call(register, { body: { fullName: 'Eve', email, password: 'Password@123', role: 'ADMIN' } });
    expect(res.status).toBe(422);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });
});
