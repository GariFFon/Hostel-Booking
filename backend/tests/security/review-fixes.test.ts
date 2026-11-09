import { NextRequest } from 'next/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { addDays } from '@/core/dates';
import { clientIp } from '@/core/http/wrap';
import { withIdempotency } from '@/core/idempotency/idempotency';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { refundsService } from '@/modules/payments/refunds.service';
import { GET as listBookings } from '@/app/api/v1/bookings/route';
import { POST as startPayment } from '@/app/api/v1/bookings/[id]/payments/route';
import { POST as demoCheckout } from '@/app/api/v1/payments/[id]/demo-checkout/route';
import { call } from '../helpers/http';
import { book, bookingBody, confirmedBooking, makeGuest, makeHost } from '../helpers/booking';
import { TODAY } from '../helpers/publish';

/** Regression tests for defects found by the Phase 9 code review. */
beforeAll(async () => {
  await redis.flushdb();
});
afterEach(() => vi.restoreAllMocks());

describe('open-booking cap holds under concurrency', () => {
  it('one guest firing many parallel requests (different keys, different dates) ends with at most the cap', async () => {
    const host = await makeHost();
    const guest = await makeGuest();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { checkIn: addDays(TODAY, 30 + i * 3), checkOut: addDays(TODAY, 31 + i * 3) }))),
    );
    const created = results.filter((r) => r.status === 201).length;
    expect(created).toBe(3); // MAX_OPEN_BOOKINGS_PER_USER default
    expect(results.filter((r) => r.status === 409).length).toBe(5);
    expect(await prisma.booking.count({ where: { guestId: guest.id, status: { in: ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'HOLD'] } } })).toBe(3);
  });
});

describe('refunds never exceed what was captured, even before earlier ones are paid out', () => {
  it('a second pending refund that would push the total past the amount is refused', async () => {
    const host = await makeHost();
    const guest = await makeGuest();
    const bookingId = await confirmedBooking(guest.token, host.hostel.id, host.rooms[0]!.id);
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId, status: 'CAPTURED' } });
    const make = (n: string, amountPaise: number) => prisma.$transaction((tx) => refundsService.create(tx, { paymentId: payment.id, bookingId, amountPaise, reason: 'test', idempotencyKey: `over-${n}-${bookingId}` }));
    const sixty = Math.floor(payment.amountPaise * 0.6);
    await make('a', sixty);
    await expect(make('b', sixty)).rejects.toMatchObject({ code: 'CONFLICT' });
    await make('c', payment.amountPaise - sixty); // exactly the rest is fine
  });
});

describe('an abandoned payment attempt does not block retries forever', () => {
  async function pendingPayment() {
    const host = await makeHost();
    const guest = await makeGuest();
    const b = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id));
    const init = await call(startPayment, { token: guest.token, params: { id: b.body.data.id } });
    return { guest, paymentId: init.body.data.id as string };
  }
  const checkout = (g: { token: string }, id: string) => call(demoCheckout, { token: g.token, params: { id }, body: { instrument: 'DEMO_TIMEOUT', method: 'UPI' } });

  it('a fresh unanswered attempt still blocks a second one', async () => {
    const { guest, paymentId } = await pendingPayment();
    expect((await checkout(guest, paymentId)).status).toBe(200); // DEMO_TIMEOUT: nothing ever comes back
    expect((await checkout(guest, paymentId)).status).toBe(409);
  });

  it('after a couple of minutes of silence the attempt is closed and the guest can try again', async () => {
    const { guest, paymentId } = await pendingPayment();
    expect((await checkout(guest, paymentId)).status).toBe(200);
    await prisma.paymentAttempt.updateMany({ where: { paymentId }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    expect((await checkout(guest, paymentId)).status).toBe(200);
    const attempts = await prisma.paymentAttempt.findMany({ where: { paymentId }, orderBy: { createdAt: 'asc' } });
    expect(attempts.map((a) => a.status)).toEqual(['FAILED', 'INITIATED']);
  });
});

describe('cursors', () => {
  it('a tampered cursor is an error, not "start again from page one"', async () => {
    const guest = await makeGuest();
    expect((await call(listBookings, { token: guest.token, method: 'GET', query: '?cursor=not-a-real-cursor' })).status).toBe(422);
    const ok = await call(listBookings, { token: guest.token, method: 'GET' });
    expect(ok.status).toBe(200);
  });
});

describe('client IP behind a proxy', () => {
  const req = (xff: string) => new NextRequest('http://localhost/x', { headers: { 'x-forwarded-for': xff } });
  it('takes the address our proxy appended, not whatever the client claimed', () => {
    expect(clientIp(req('198.51.100.7'))).toBe('198.51.100.7');
    expect(clientIp(req('6.6.6.6, 203.0.113.9'))).toBe('203.0.113.9');
    expect(clientIp(req('1.1.1.1, 2.2.2.2, 203.0.113.9'))).toBe('203.0.113.9');
  });
});

describe('idempotency keeps its promise when only the bookkeeping fails', () => {
  const scope = () => ({ userId: '00000000-0000-4000-8000-000000000001', key: `idem-${Math.random().toString(36).slice(2)}-padding`, method: 'POST', path: '/x', body: { a: 1 } });

  it('a transient failure recording the response is retried, and the handler still ran once', async () => {
    const s = scope();
    await prisma.user.upsert({ where: { id: s.userId }, update: {}, create: { id: s.userId, email: `idem${Date.now()}@test.dev`, status: 'ACTIVE' } });
    let runs = 0;
    const real = prisma.idempotencyKey.update.bind(prisma.idempotencyKey);
    let failures = 2;
    vi.spyOn(prisma.idempotencyKey, 'update').mockImplementation(((args: never) => (failures-- > 0 ? Promise.reject(new Error('blip')) : real(args))) as never);
    const first = await withIdempotency(s, async () => { runs++; return { status: 201, body: { ok: true } }; });
    expect(first.replayed).toBe(false);
    vi.restoreAllMocks();
    const second = await withIdempotency(s, async () => { runs++; return { status: 201, body: { ok: true } }; });
    expect(second.replayed).toBe(true);
    expect(runs).toBe(1);
  });

  it('if recording keeps failing the key is NOT released, so a retry cannot repeat the side effect', async () => {
    const s = scope();
    await prisma.user.upsert({ where: { id: s.userId }, update: {}, create: { id: s.userId, email: `idem${Date.now()}x@test.dev`, status: 'ACTIVE' } });
    vi.spyOn(prisma.idempotencyKey, 'update').mockRejectedValue(new Error('db down'));
    await expect(withIdempotency(s, async () => ({ status: 201, body: {} }))).rejects.toThrow('db down');
    vi.restoreAllMocks();
    expect(await prisma.idempotencyKey.count({ where: { userId: s.userId, key: s.key } })).toBe(1);
    await expect(withIdempotency(s, async () => ({ status: 201, body: {} }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});
