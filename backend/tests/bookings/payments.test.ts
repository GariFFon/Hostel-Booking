import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { outbox } from '@/infra/mail/mailer';
import { captured, runCaptured, setQueueMode } from '@/infra/queue/queue';
import { signDemoPayload } from '@/infra/payments/demo.provider';
import { POST as initiate } from '@/app/api/v1/bookings/[id]/payments/route';
import { GET as getPayment } from '@/app/api/v1/payments/[id]/route';
import { POST as demoCheckout } from '@/app/api/v1/payments/[id]/demo-checkout/route';
import { expireDueBookings } from '@/modules/bookings/booking-expiry';
import { processDemoWebhook } from '@/modules/payments/webhooks.service';
import { paymentDtoSchema } from '@/modules/payments/payments.schema';
import { call } from '../helpers/http';
import { book, bookingBody, inventoryOf, ledgerBalances, makeGuest, makeHost, notificationsFor, pay } from '../helpers/booking';
import { buildEvent, deliver } from '../helpers/webhooks';

beforeAll(async () => {
  await redis.flushdb();
});
afterEach(() => setQueueMode(null));

async function freshBooking(over: Record<string, unknown> = {}, hostSpec: Parameters<typeof makeHost>[0] = { rooms: [{ units: 4, price: 80000 }] }) {
  const host = await makeHost(hostSpec);
  const guest = await makeGuest();
  const res = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, over));
  expect(res.status).toBe(201);
  return { host, guest, booking: res.body.data, room: host.rooms[0]! };
}
const statusOf = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;

describe('starting a payment', () => {
  it('creates one open order and resumes it on repeat calls', async () => {
    const { guest, booking } = await freshBooking();
    const a = await call(initiate, { token: guest.token, params: { id: booking.id } });
    const b = await call(initiate, { token: guest.token, params: { id: booking.id } });
    expect(a.status).toBe(201);
    expect(paymentDtoSchema.safeParse(a.body.data).error?.issues ?? []).toEqual([]);
    expect(a.body.data).toMatchObject({ status: 'CREATED', amountPaise: 168000, currency: 'INR', provider: 'demo', checkout: { type: 'demo' } });
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(a.body.data.providerOrderId).toMatch(/^demo_order_/);
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(1);
    expect(new Date(a.body.data.expiresAt).getTime()).toBe(new Date(booking.holdExpiresAt).getTime());
  });

  it('refuses other people, expired holds and bookings that are not waiting for payment', async () => {
    const { guest, booking, host } = await freshBooking();
    expect((await call(initiate, { token: (await makeGuest()).token, params: { id: booking.id } })).status).toBe(404);
    await prisma.booking.update({ where: { id: booking.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const late = await call(initiate, { token: guest.token, params: { id: booking.id } });
    expect(late.status).toBe(409);
    expect(await statusOf(booking.id)).toBe('EXPIRED'); // noticed and released on the spot
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [0, 0] });
    expect((await call(initiate, { token: guest.token, params: { id: booking.id } })).status).toBe(409);
  });
});

describe('demo gateway outcomes', () => {
  it('DEMO_SUCCESS: payment captured, booking confirmed, beds sold, everyone told, money in escrow', async () => {
    const { guest, host, booking, room } = await freshBooking();
    const { checkout, paymentId } = await pay(guest.token, booking.id, 'DEMO_SUCCESS');
    expect(checkout.status).toBe(200);
    expect(checkout.body.data).toMatchObject({ status: 'CAPTURED', method: 'UPI', checkout: null });
    expect(checkout.body.data.attempts).toMatchObject([{ status: 'SUCCEEDED', instrument: 'DEMO_SUCCESS' }]);

    const b = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { history: { orderBy: { createdAt: 'asc' } } } });
    expect(b).toMatchObject({ status: 'CONFIRMED', holdExpiresAt: null });
    expect(b.confirmedAt).toBeInstanceOf(Date);
    expect(b.history.map((h) => [h.fromStatus, h.toStatus, h.actorRole])).toEqual([[null, 'PENDING_PAYMENT', 'GUEST'], ['PENDING_PAYMENT', 'CONFIRMED', 'SYSTEM']]);
    expect(await inventoryOf(room.id)).toMatchObject({ held: [0, 0], booked: [1, 1] });
    expect(await ledgerBalances(booking.id)).toMatchObject({ GUEST: -168000, PLATFORM_ESCROW: 168000 });

    expect((await notificationsFor(guest.id)).map((n) => n.type)).toContain('BOOKING_CONFIRMED');
    expect((await notificationsFor(host.owner.id)).map((n) => n.type)).toContain('BOOKING_CREATED');
    expect(outbox.some((m) => m.subject === `Booking confirmed ${booking.code}`)).toBe(true);
    const audit = await prisma.auditLog.findMany({ where: { entityId: booking.id }, orderBy: { id: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['booking.created', 'payment.initiated', 'payment.attempt', 'payment.captured', 'booking.confirmed']));
    const after = await call((await import('@/app/api/v1/bookings/[id]/route')).GET, { method: 'GET', token: guest.token, params: { id: booking.id } });
    expect(after.body.data).toMatchObject({ status: 'CONFIRMED', actions: ['cancel'], payment: { status: 'CAPTURED', amountPaise: 168000 }, hostel: { phone: '+919800000000' } });
    expect(paymentId).toBeTruthy();
  });

  it('DEMO_FAIL: payment fails, the hold survives, and a retry creates a fresh order that can succeed', async () => {
    const { guest, booking, room } = await freshBooking();
    const first = await pay(guest.token, booking.id, 'DEMO_FAIL');
    expect(first.checkout.body.data).toMatchObject({ status: 'FAILED', failureCode: 'DEMO_DECLINED', checkout: null });
    expect(first.checkout.body.data.attempts[0]).toMatchObject({ status: 'FAILED' });
    expect(await statusOf(booking.id)).toBe('PENDING_PAYMENT');
    expect(await inventoryOf(room.id)).toMatchObject({ held: [1, 1] });
    expect((await notificationsFor(guest.id)).map((n) => n.type)).toContain('PAYMENT_FAILED');
    expect(await ledgerBalances(booking.id)).toMatchObject({ PLATFORM_ESCROW: 0 }); // no money moved

    const retry = await pay(guest.token, booking.id, 'DEMO_SUCCESS');
    expect(retry.paymentId).not.toBe(first.paymentId);
    expect(retry.checkout.body.data.status).toBe('CAPTURED');
    expect(await statusOf(booking.id)).toBe('CONFIRMED');
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(2);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: first.paymentId } })).status).toBe('FAILED');
  });

  it('DEMO_PENDING: shows PENDING first, then captures when the gateway settles', async () => {
    setQueueMode('capture');
    const { guest, booking } = await freshBooking();
    const { checkout, paymentId } = await pay(guest.token, booking.id, 'DEMO_PENDING');
    expect(checkout.body.data.status).toBe('PENDING');
    expect(await runCaptured((j) => j.name === 'demo-webhook')).toBe(2); // primary stage schedules the settle stage, which then delivers
    const done = await call(getPayment, { method: 'GET', token: guest.token, params: { id: paymentId! } });
    expect(done.body.data.status).toBe('CAPTURED');
    expect(await statusOf(booking.id)).toBe('CONFIRMED');
    captured.length = 0;
  });

  it('DEMO_TIMEOUT: nothing ever arrives, so the hold expires and everything is released', async () => {
    setQueueMode('capture');
    const { guest, booking, room } = await freshBooking();
    const { paymentId } = await pay(guest.token, booking.id, 'DEMO_TIMEOUT');
    expect(await runCaptured((j) => j.name === 'demo-webhook')).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId! } })).status).toBe('CREATED');
    expect(await expireDueBookings({ now: new Date(Date.now() + 20 * 60_000) })).toBeGreaterThanOrEqual(1);
    expect(await statusOf(booking.id)).toBe('EXPIRED');
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: paymentId! } })).toMatchObject({ status: 'FAILED', failureCode: 'EXPIRED' });
    expect(await inventoryOf(room.id)).toMatchObject({ held: [0, 0], booked: [0, 0] });
    captured.length = 0;
  });

  it('refuses a second checkout while an attempt is in flight, and checkouts for other people\'s payments', async () => {
    setQueueMode('capture');
    const { guest, booking } = await freshBooking();
    const { paymentId } = await pay(guest.token, booking.id, 'DEMO_SUCCESS'); // webhook is queued, not yet delivered
    const again = await call(demoCheckout, { token: guest.token, params: { id: paymentId! }, body: { instrument: 'DEMO_SUCCESS', method: 'UPI' } });
    expect(again.status).toBe(409);
    expect((await call(demoCheckout, { token: (await makeGuest()).token, params: { id: paymentId! }, body: { instrument: 'DEMO_SUCCESS' } })).status).toBe(404);
    expect((await call(demoCheckout, { token: guest.token, params: { id: paymentId! }, body: { instrument: 'CARD_NUMBER_1234' } })).status).toBe(422);
    await runCaptured();
    expect(await statusOf(booking.id)).toBe('CONFIRMED');
  });
});

describe('webhook authenticity', () => {
  it('rejects missing, forged, tampered and stale signatures without touching anything', async () => {
    const { guest, booking } = await freshBooking();
    const init = await call(initiate, { token: guest.token, params: { id: booking.id } });
    const event = await buildEvent(init.body.data.id);
    const raw = JSON.stringify(event);
    expect((await deliver(event, { signature: null })).status).toBe(401);
    expect((await deliver(event, { signature: 't=1,v1=abcd' })).status).toBe(401);
    expect((await deliver(event, { signature: signDemoPayload(raw, 'wrong-secret') })).status).toBe(401);
    expect((await deliver(event, { raw: raw.replace('"amountPaise":168000', '"amountPaise":1'), signature: signDemoPayload(raw) })).status).toBe(401); // body changed after signing
    expect((await deliver(event, { at: new Date(Date.now() - 10 * 60_000) })).status).toBe(401); // replay of an old signed request
    expect((await deliver(event, { at: new Date(Date.now() + 10 * 60_000) })).status).toBe(401);
    expect(await statusOf(booking.id)).toBe('PENDING_PAYMENT');
    expect(await prisma.webhookEvent.count({ where: { eventId: event.id } })).toBe(0);
    expect((await deliver(event)).status).toBe(200);
    expect(await statusOf(booking.id)).toBe('CONFIRMED');
  });

  it('rejects malformed payloads, ignores unknown orders, and refuses an amount that does not match the order', async () => {
    const { guest, booking } = await freshBooking();
    const init = await call(initiate, { token: guest.token, params: { id: booking.id } });
    const raw = 'this is not json';
    expect((await deliver({}, { raw, signature: signDemoPayload(raw) })).status).toBe(422);
    const unknown = await buildEvent(init.body.data.id, { orderId: 'demo_order_does_not_exist' });
    const ignored = await deliver(unknown);
    expect([ignored.status, ignored.body.data.outcome]).toEqual([200, 'ignored']); // 200 so the gateway stops retrying
    const wrongAmount = await buildEvent(init.body.data.id, { amountPaise: 100 });
    const res = await deliver(wrongAmount);
    expect(res.status).toBe(422);
    expect(await statusOf(booking.id)).toBe('PENDING_PAYMENT');
    expect(await prisma.auditLog.count({ where: { action: 'payment.amount_mismatch', entityId: booking.id, outcome: 'DENIED' } })).toBe(1);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: 'demo', eventId: wrongAmount.id } } })).status).toBe('FAILED');
  });
});

describe('webhook idempotency and ordering', () => {
  it('replaying the same event changes nothing: one confirmation, one ledger entry, one notification', async () => {
    const { guest, host, booking } = await freshBooking();
    const init = await call(initiate, { token: guest.token, params: { id: booking.id } });
    const event = await buildEvent(init.body.data.id);
    expect((await deliver(event)).body.data.outcome).toBe('processed');
    expect((await deliver(event)).body.data.outcome).toBe('duplicate');
    expect((await deliver(event)).body.data.outcome).toBe('duplicate');
    expect(await prisma.ledgerEntry.count({ where: { bookingId: booking.id } })).toBe(1);
    expect(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id, toStatus: 'CONFIRMED' } })).toBe(1);
    expect((await notificationsFor(guest.id)).filter((n) => n.type === 'BOOKING_CONFIRMED')).toHaveLength(1);
    expect((await notificationsFor(host.owner.id)).filter((n) => n.type === 'BOOKING_CREATED')).toHaveLength(1);
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [0, 0], booked: [1, 1] });
  });

  it('ten simultaneous deliveries of the same event: exactly one is processed', async () => {
    const { guest, booking } = await freshBooking();
    const init = await call(initiate, { token: guest.token, params: { id: booking.id } });
    const event = await buildEvent(init.body.data.id);
    const results = await Promise.all(Array.from({ length: 10 }, () => deliver(event)));
    const outcomes = results.map((r) => (r.status === 200 ? r.body.data.outcome : `http${r.status}`));
    expect(outcomes.filter((o) => o === 'processed')).toHaveLength(1);
    expect(outcomes.every((o) => ['processed', 'duplicate', 'ignored'].includes(o))).toBe(true);
    expect(await prisma.ledgerEntry.count({ where: { bookingId: booking.id } })).toBe(1);
    expect(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id, toStatus: 'CONFIRMED' } })).toBe(1);
  });

  it('a stale "failed" arriving after "captured" is ignored, and the money is not lost', async () => {
    const { guest, booking } = await freshBooking();
    const init = await call(initiate, { token: guest.token, params: { id: booking.id } });
    await deliver(await buildEvent(init.body.data.id, { type: 'payment.captured' }));
    const stale = await deliver(await buildEvent(init.body.data.id, { type: 'payment.failed' }));
    expect(stale.body.data.outcome).toBe('ignored');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: init.body.data.id } })).status).toBe('CAPTURED');
    expect(await statusOf(booking.id)).toBe('CONFIRMED');
  });

  it('"captured" after "failed" is honoured: what the gateway actually took is the truth', async () => {
    const { guest, booking } = await freshBooking();
    const init = await call(initiate, { token: guest.token, params: { id: booking.id } });
    await deliver(await buildEvent(init.body.data.id, { type: 'payment.failed' }));
    expect(await statusOf(booking.id)).toBe('PENDING_PAYMENT');
    await deliver(await buildEvent(init.body.data.id, { type: 'payment.captured' }));
    expect(await statusOf(booking.id)).toBe('CONFIRMED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: init.body.data.id } })).status).toBe('CAPTURED');
  });

  it('records every event, and a crash mid-processing is retried by the next delivery', async () => {
    const { guest, booking } = await freshBooking();
    const init = await call(initiate, { token: guest.token, params: { id: booking.id } });
    const event = await buildEvent(init.body.data.id);
    await prisma.webhookEvent.create({ data: { provider: 'demo', eventId: event.id, type: event.type, payload: event, signatureValid: true, status: 'RECEIVED' } }); // as if an earlier delivery died after recording
    expect((await deliver(event)).body.data.outcome).toBe('processed');
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: 'demo', eventId: event.id } } })).status).toBe('PROCESSED');
  });
});

describe('payments that arrive when the booking cannot use them', () => {
  it('late payment after expiry is refunded in full automatically, and no inventory leaks', async () => {
    const { guest, booking, room } = await freshBooking();
    const init = await call(initiate, { token: guest.token, params: { id: booking.id } });
    await prisma.booking.update({ where: { id: booking.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
    await expireDueBookings();
    expect(await statusOf(booking.id)).toBe('EXPIRED');

    const res = await deliver(await buildEvent(init.body.data.id));
    expect(res.body.data.outcome).toBe('processed');
    expect(await statusOf(booking.id)).toBe('EXPIRED'); // not resurrected
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: init.body.data.id } });
    expect(payment).toMatchObject({ status: 'REFUNDED', refundedPaise: 168000 });
    const refund = await prisma.refund.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(refund).toMatchObject({ status: 'PROCESSED', amountPaise: 168000, idempotencyKey: `auto:${payment.id}` });
    expect(refund.reason).toMatch(/after the booking expired/);
    expect(await ledgerBalances(booking.id)).toMatchObject({ GUEST: 0, PLATFORM_ESCROW: 0, REFUND_PAYABLE: 0, OWNER_PAYABLE: 0 }); // the guest is made whole
    expect(await inventoryOf(room.id)).toMatchObject({ held: [0, 0], booked: [0, 0] });
    expect(await prisma.auditLog.count({ where: { action: 'payment.auto_refund', entityId: booking.id } })).toBe(1);
    expect((await notificationsFor(guest.id)).map((n) => n.type)).toContain('REFUND_PROCESSED');
  });

  it('a duplicate second payment for an already-confirmed booking is refunded, the first stands', async () => {
    const { guest, booking, room } = await freshBooking();
    const p1 = await call(initiate, { token: guest.token, params: { id: booking.id } });
    const p2 = await prisma.payment.create({ data: { bookingId: booking.id, provider: 'demo', providerOrderId: `demo_order_dup_${Date.now()}`, amountPaise: 168000 } });
    await deliver(await buildEvent(p1.body.data.id));
    await deliver(await buildEvent(p2.id));
    expect(await statusOf(booking.id)).toBe('CONFIRMED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p1.body.data.id } })).status).toBe('CAPTURED');
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: p2.id } })).toMatchObject({ status: 'REFUNDED', refundedPaise: 168000 });
    expect((await prisma.refund.findFirstOrThrow({ where: { paymentId: p2.id } })).reason).toBe('Duplicate payment');
    expect(await inventoryOf(room.id)).toMatchObject({ held: [0, 0], booked: [1, 1] }); // sold once
    expect(await ledgerBalances(booking.id)).toMatchObject({ PLATFORM_ESCROW: 168000, GUEST: -168000 }); // net: one payment held
  });

  it('payment after the guest cancelled is refunded', async () => {
    const { guest, booking } = await freshBooking();
    const init = await call(initiate, { token: guest.token, params: { id: booking.id } });
    const { POST: cancel } = await import('@/app/api/v1/bookings/[id]/cancel/route');
    expect((await call(cancel, { token: guest.token, params: { id: booking.id }, body: {} })).status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: init.body.data.id } })).failureCode).toBe('CANCELLED');
    await deliver(await buildEvent(init.body.data.id));
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: init.body.data.id } })).toMatchObject({ status: 'REFUNDED' });
    expect(await statusOf(booking.id)).toBe('CANCELLED_BY_GUEST');
  });
});

describe('races between payment, expiry and cancellation', () => {
  it('a webhook racing the expiry sweeper always leaves a consistent result (confirmed XOR expired+refunded)', async () => {
    const host = await makeHost({ rooms: [{ units: 12, price: 80000 }] });
    const guests = await Promise.all(Array.from({ length: 12 }, () => makeGuest()));
    const bookings: { id: string; paymentId: string }[] = [];
    for (const g of guests) {
      const b = (await book(g.token, bookingBody(host.hostel.id, host.rooms[0]!.id))).body.data;
      const init = await call(initiate, { token: g.token, params: { id: b.id } });
      bookings.push({ id: b.id, paymentId: init.body.data.id });
      await prisma.booking.update({ where: { id: b.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } }); // overdue, but the sweeper has not run yet
    }
    const events = await Promise.all(bookings.map((b) => buildEvent(b.paymentId)));
    const outcomes = await Promise.all([
      expireDueBookings({ hostelId: host.hostel.id }),
      ...events.map((e) => deliver(e)),
      expireDueBookings({ hostelId: host.hostel.id }),
    ]);
    expect(outcomes.slice(1, -1).every((r) => typeof r !== 'number' && r.status === 200)).toBe(true); // nothing errored, nothing deadlocked

    let confirmed = 0;
    for (const b of bookings) {
      const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
      const bal = await ledgerBalances(b.id);
      const pay = await prisma.payment.findUniqueOrThrow({ where: { id: b.paymentId } });
      expect(pay.status === 'CAPTURED' || pay.status === 'REFUNDED').toBe(true); // the money was taken either way
      if (row.status === 'CONFIRMED') { confirmed++; expect(pay.status).toBe('CAPTURED'); expect(bal).toMatchObject({ PLATFORM_ESCROW: 168000, REFUND_PAYABLE: 0 }); }
      else { expect(row.status).toBe('EXPIRED'); expect(pay.status).toBe('REFUNDED'); expect(bal).toMatchObject({ PLATFORM_ESCROW: 0, GUEST: 0, REFUND_PAYABLE: 0 }); }
    }
    const inv = await inventoryOf(host.rooms[0]!.id);
    expect(inv.held).toEqual([0, 0]); // no hold leaked
    expect(inv.booked).toEqual([confirmed, confirmed]); // sold exactly what was confirmed
  });

  it('cancel racing the payment webhook: either the booking is confirmed then cancelled with a refund, or cancelled and the late payment refunded', async () => {
    for (let i = 0; i < 6; i++) {
      const { guest, booking, room } = await freshBooking();
      const init = await call(initiate, { token: guest.token, params: { id: booking.id } });
      const event = await buildEvent(init.body.data.id);
      const { POST: cancel } = await import('@/app/api/v1/bookings/[id]/cancel/route');
      await Promise.all([deliver(event), call(cancel, { token: guest.token, params: { id: booking.id }, body: {} })]);
      const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(['CANCELLED_BY_GUEST', 'CONFIRMED']).toContain(row.status); // if the cancel lost the race against the payment, it saw an unpaid booking only if it ran first
      const bal = await ledgerBalances(booking.id);
      expect(bal.PLATFORM_ESCROW === 0 || (row.status === 'CONFIRMED' && bal.PLATFORM_ESCROW === 168000)).toBe(true);
      const inv = await inventoryOf(room.id);
      expect(inv.held).toEqual([0, 0]);
      expect(inv.booked).toEqual(row.status === 'CONFIRMED' ? [1, 1] : [0, 0]);
      const pay = await prisma.payment.findUniqueOrThrow({ where: { id: init.body.data.id } });
      if (row.status === 'CANCELLED_BY_GUEST') expect(pay.status).toBe('REFUNDED'); // never keep the guest's money for a cancelled, unconfirmed booking
    }
  });
});

describe('processDemoWebhook (service)', () => {
  it('accepts a signed event directly', async () => {
    const { guest, booking } = await freshBooking();
    const init = await call(initiate, { token: guest.token, params: { id: booking.id } });
    const raw = JSON.stringify(await buildEvent(init.body.data.id));
    expect(await processDemoWebhook(raw, signDemoPayload(raw))).toBe('processed');
    await expect(processDemoWebhook(raw, 't=1,v1=00')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
