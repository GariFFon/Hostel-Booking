import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { outbox } from '@/infra/mail/mailer';
import { GET as listBookings } from '@/app/api/v1/bookings/route';
import { GET as getBooking } from '@/app/api/v1/bookings/[id]/route';
import { GET as ownerGet } from '@/app/api/v1/owner/bookings/[id]/route';
import { GET as adminList } from '@/app/api/v1/admin/bookings/route';
import { expireDueBookings } from '@/modules/bookings/booking-expiry';
import { bookingDtoSchema, bookingSummarySchema } from '@/modules/bookings/bookings.schema';
import { call } from '../helpers/http';
import { STAY, book, bookingBody, idemKey, inventoryOf, makeGuest, makeHost, notificationsFor, pay } from '../helpers/booking';
import { D, TODAY, uniq } from '../helpers/publish';
import { makeUser } from '../helpers/users';

beforeAll(async () => {
  await redis.flushdb();
});

const issues = (schema: { safeParse: (v: unknown) => { error?: { issues: unknown[] } } }, v: unknown) => schema.safeParse(v).error?.issues ?? [];

describe('creating a booking', () => {
  it('holds the beds, prices from the live quote, and returns a contract-valid PENDING_PAYMENT booking', async () => {
    const host = await makeHost({ rooms: [{ units: 4, price: 80000 }] });
    const guest = await makeGuest();
    const res = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { items: [{ roomTypeId: host.rooms[0]!.id, units: 2 }], guests: [{ fullName: 'A One', gender: 'FEMALE' }, { fullName: 'B Two', gender: 'MALE' }], specialRequests: 'Late arrival' }));
    expect(res.status).toBe(201);
    const b = res.body.data;
    expect(issues(bookingDtoSchema, b)).toEqual([]);
    expect(b.code).toMatch(/^HB-[A-HJKMNP-Z2-9]{6}$/); // no ambiguous characters
    expect(b).toMatchObject({ status: 'PENDING_PAYMENT', viewer: 'GUEST', nights: 2, guestsCount: 2, bookingMode: 'INSTANT', contactPhone: '+919876543210', specialRequests: 'Late arrival' });
    expect(b.pricing).toMatchObject({ subtotalPaise: 320000, taxPaise: 16000, totalPaise: 336000, discountPaise: 0 });
    expect(b.actions).toEqual(expect.arrayContaining(['pay', 'cancel']));
    expect(b.hostel.phone).toBeNull(); // the property's number is only revealed once the stay is confirmed
    expect(b.guest).toBeNull();
    expect(b.items[0].nightly.map((n: { unitPricePaise: number }) => n.unitPricePaise)).toEqual([80000, 80000]);
    const mins = (new Date(b.holdExpiresAt).getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(13);
    expect(mins).toBeLessThanOrEqual(15);
    expect(b.timeline.map((t: { status: string }) => t.status)).toEqual(['PENDING_PAYMENT']);
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [2, 2], booked: [0, 0] });
    expect(await prisma.auditLog.count({ where: { action: 'booking.created', entityId: b.id } })).toBe(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).commissionBps).toBe(1000); // snapshot of the platform rate
  });

  it('refuses stale prices (PRICE_CHANGED) but accepts the current total', async () => {
    const host = await makeHost({ rooms: [{ units: 4, price: 80000 }] });
    const guest = await makeGuest();
    const stale = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { expectedTotalPaise: 100 }));
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'PRICE_CHANGED', details: { expectedTotalPaise: 100, totalPaise: 168000 } });
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [0, 0] }); // nothing was held
    expect((await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { expectedTotalPaise: 168000 }))).status).toBe(201);
  });

  it('rejects own listings, unverified emails, unpublished listings and bad input', async () => {
    const host = await makeHost();
    const guest = await makeGuest();
    const body = bookingBody(host.hostel.id, host.rooms[0]!.id);
    expect((await book(host.owner.token, body)).status).toBe(403); // cannot book your own property
    expect((await book((await makeGuest({ verified: false })).token, body)).status).toBe(403);
    expect((await call((await import('@/app/api/v1/bookings/route')).POST, { body, headers: { 'idempotency-key': idemKey() } })).status).toBe(401);
    const draft = await makeHost({ status: 'DRAFT' });
    expect((await book(guest.token, bookingBody(draft.hostel.id, draft.rooms[0]!.id))).status).toBe(404);
    expect((await book(guest.token, { ...body, contactPhone: '12' })).status).toBe(422);
    expect((await book(guest.token, { ...body, guests: [] })).status).toBe(422);
    expect((await book(guest.token, { ...body, guests: [{ fullName: 'X' }] })).status).toBe(422);
    expect((await book(guest.token, { ...body, guests: [{ fullName: 'Valid Name', idLast4: '123456789' }] })).status).toBe(422); // never accept full ID numbers
    const tooMany = await book(guest.token, { ...body, guests: [{ fullName: 'One Guest' }, { fullName: 'Two Guest' }] });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.details[0].path).toBe('guests');
  });

  it('enforces gender rules for women-only listings and gender-specific dorms', async () => {
    const women = await makeHost({ genderPolicy: 'FEMALE_ONLY', rooms: [{ gender: 'FEMALE', units: 4 }] });
    const guest = await makeGuest();
    const man = await book(guest.token, bookingBody(women.hostel.id, women.rooms[0]!.id, { guests: [{ fullName: 'Rahul Verma', gender: 'MALE' }] }));
    expect(man.status).toBe(422);
    expect(man.body.error.details.map((d: { path: string }) => d.path)).toContain('guests.0.gender');
    expect((await book(guest.token, bookingBody(women.hostel.id, women.rooms[0]!.id, { guests: [{ fullName: 'Asha Rao' }] }))).status).toBe(422); // gender required
    expect((await book(guest.token, bookingBody(women.hostel.id, women.rooms[0]!.id))).status).toBe(201);

    const mixedHostelFemaleDorm = await makeHost({ rooms: [{ gender: 'FEMALE', units: 4 }, { name: 'Mixed', units: 4 }] });
    const g2 = await makeGuest();
    const items = [{ roomTypeId: mixedHostelFemaleDorm.rooms[0]!.id, units: 2 }];
    const wrong = await book(g2.token, bookingBody(mixedHostelFemaleDorm.hostel.id, '', { items, guests: [{ fullName: 'A One', gender: 'FEMALE' }, { fullName: 'B Two', gender: 'MALE' }] }));
    expect(wrong.status).toBe(422); // 2 female beds need 2 female guests
    expect((await book(g2.token, bookingBody(mixedHostelFemaleDorm.hostel.id, '', { items, guests: [{ fullName: 'A One', gender: 'FEMALE' }, { fullName: 'B Two', gender: 'FEMALE' }] }))).status).toBe(201);
  });

  it('limits how many unpaid holds one guest can sit on', async () => {
    const host = await makeHost({ rooms: [{ units: 20 }] });
    const guest = await makeGuest();
    for (let i = 0; i < 3; i++) expect((await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { checkIn: addDays(STAY.checkIn, i * 3), checkOut: addDays(STAY.checkIn, i * 3 + 2) }))).status).toBe(201);
    const fourth = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { checkIn: addDays(STAY.checkIn, 12), checkOut: addDays(STAY.checkIn, 14) }));
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.message).toMatch(/already have 3 bookings/);
  });
});

describe('idempotency', () => {
  it('requires a well-formed Idempotency-Key', async () => {
    const host = await makeHost();
    const guest = await makeGuest();
    const body = bookingBody(host.hostel.id, host.rooms[0]!.id);
    const { POST } = await import('@/app/api/v1/bookings/route');
    expect((await call(POST, { token: guest.token, body })).status).toBe(422);
    expect((await call(POST, { token: guest.token, body, headers: { 'idempotency-key': 'short' } })).status).toBe(422);
    expect((await call(POST, { token: guest.token, body, headers: { 'idempotency-key': 'has spaces in it!' } })).status).toBe(422);
  });

  it('replays the stored response for a retry, and creates one booking only', async () => {
    const host = await makeHost({ rooms: [{ units: 4 }] });
    const guest = await makeGuest();
    const key = idemKey();
    const body = bookingBody(host.hostel.id, host.rooms[0]!.id);
    const first = await book(guest.token, body, key);
    const retry = await book(guest.token, body, key);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(retry.headers.get('idempotent-replayed')).toBe('true');
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    expect(await prisma.booking.count({ where: { guestId: guest.id } })).toBe(1);
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [1, 1] }); // held once, not twice
  });

  it('rejects the same key with a different request', async () => {
    const host = await makeHost({ rooms: [{ units: 4 }] });
    const guest = await makeGuest();
    const key = idemKey();
    await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id), key);
    const clash = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { checkIn: addDays(STAY.checkIn, 5), checkOut: addDays(STAY.checkIn, 7) }), key);
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('collapses concurrent duplicates into a single booking', async () => {
    const host = await makeHost({ rooms: [{ units: 4 }] });
    const guest = await makeGuest();
    const key = idemKey();
    const body = bookingBody(host.hostel.id, host.rooms[0]!.id);
    const results = await Promise.all(Array.from({ length: 10 }, () => book(guest.token, body, key)));
    const ok = results.filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map((r) => r.body.data.id)).size).toBe(1);
    for (const r of results.filter((x) => x.status !== 201)) expect(r.body.error).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', details: { inProgress: true } }); // told to retry, never a second booking
    expect(await prisma.booking.count({ where: { guestId: guest.id } })).toBe(1);
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [1, 1] });
  });

  it('releases the key after a failure so a corrected retry can run', async () => {
    const host = await makeHost({ rooms: [{ units: 4 }] });
    const guest = await makeGuest();
    const key = idemKey();
    expect((await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { contactPhone: 'bad' }), key)).status).toBe(422);
    expect((await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { expectedTotalPaise: 1 }), key)).status).toBe(409);
    expect((await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id), key)).status).toBe(201);
  });

  it('keys are per user', async () => {
    const host = await makeHost({ rooms: [{ units: 4 }] });
    const a = await makeGuest(), b = await makeGuest();
    const key = idemKey();
    const body = bookingBody(host.hostel.id, host.rooms[0]!.id);
    const ra = await book(a.token, body, key), rb = await book(b.token, body, key);
    expect([ra.status, rb.status]).toEqual([201, 201]);
    expect(ra.body.data.id).not.toBe(rb.body.data.id);
  });
});

describe('no overbooking under concurrency', () => {
  it('40 guests racing for 4 beds: exactly 4 win, 36 get SOLD_OUT, counters are exact', async () => {
    const host = await makeHost({ rooms: [{ units: 4 }] });
    const guests = await Promise.all(Array.from({ length: 40 }, () => makeGuest()));
    const results = await Promise.all(guests.map((g) => book(g.token, bookingBody(host.hostel.id, host.rooms[0]!.id))));
    const wins = results.filter((r) => r.status === 201);
    const losses = results.filter((r) => r.status === 409);
    expect(wins).toHaveLength(4);
    expect(losses).toHaveLength(36);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true); // no 500s, no deadlocks
    for (const l of losses) expect(l.body.error.code).toBe('SOLD_OUT');
    expect(await inventoryOf(host.rooms[0]!.id)).toEqual({ held: [4, 4], booked: [0, 0], blocked: [0, 0], total: [4, 4] });
    expect(await prisma.booking.count({ where: { hostelId: host.hostel.id } })).toBe(4);
  });

  it('overlapping date ranges contend correctly: one bed, two overlapping stays, one winner', async () => {
    const host = await makeHost({ rooms: [{ units: 1 }] });
    const [a, b] = await Promise.all([makeGuest(), makeGuest()]);
    const [r1, r2] = await Promise.all([
      book(a.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { checkIn: addDays(TODAY, 30), checkOut: addDays(TODAY, 33) })),
      book(b.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { checkIn: addDays(TODAY, 32), checkOut: addDays(TODAY, 35) })),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const rows = await prisma.inventoryNight.findMany({ where: { roomTypeId: host.rooms[0]!.id, date: { gte: D(addDays(TODAY, 30)), lt: D(addDays(TODAY, 35)) } } });
    expect(rows.every((r) => r.heldUnits <= r.totalUnits)).toBe(true);
    expect(rows.reduce((s, r) => s + r.heldUnits, 0)).toBe(3); // exactly the winner's 3 nights
  });

  it('multi-room bookings locking in different orders never deadlock', async () => {
    const host = await makeHost({ rooms: [{ name: 'A dorm', units: 6 }, { name: 'B dorm', units: 6 }] });
    const a = host.rooms[0]!;
    const b = host.rooms[1]!;
    const guests = await Promise.all(Array.from({ length: 24 }, () => makeGuest()));
    const results = await Promise.all(guests.map((g, i) => book(g.token, bookingBody(host.hostel.id, '', {
      items: i % 2 ? [{ roomTypeId: a.id, units: 1 }, { roomTypeId: b.id, units: 1 }] : [{ roomTypeId: b.id, units: 1 }, { roomTypeId: a.id, units: 1 }],
      guests: [{ fullName: 'G One', gender: 'FEMALE' }, { fullName: 'G Two', gender: 'FEMALE' }],
    }))));
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(6);
    expect(await inventoryOf(a.id)).toMatchObject({ held: [6, 6] });
    expect(await inventoryOf(b.id)).toMatchObject({ held: [6, 6] });
  });

  it('a failed multi-room booking leaves nothing held (all-or-nothing)', async () => {
    const host = await makeHost({ rooms: [{ name: 'Plenty', units: 5 }, { name: 'Scarce', units: 1 }] });
    const plenty = host.rooms[0]!;
    const scarce = host.rooms[1]!;
    const [a, b] = await Promise.all([makeGuest(), makeGuest()]);
    const both = (g: { token: string }) => book(g.token, bookingBody(host.hostel.id, '', { items: [{ roomTypeId: plenty.id, units: 1 }, { roomTypeId: scarce.id, units: 1 }], guests: [{ fullName: 'G One', gender: 'FEMALE' }, { fullName: 'G Two', gender: 'FEMALE' }] }));
    const results = await Promise.all([both(a), both(b)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await inventoryOf(plenty.id)).toMatchObject({ held: [1, 1] }); // the loser's plenty-bed was rolled back too
    expect(await inventoryOf(scarce.id)).toMatchObject({ held: [1, 1] });
  });

  it('a hold that ran out is released on demand, so the next guest is not blocked by a dead hold', async () => {
    const host = await makeHost({ rooms: [{ units: 1 }] });
    const [a, b] = await Promise.all([makeGuest(), makeGuest()]);
    const first = await book(a.token, bookingBody(host.hostel.id, host.rooms[0]!.id));
    expect((await book(b.token, bookingBody(host.hostel.id, host.rooms[0]!.id))).status).toBe(409);
    await prisma.booking.update({ where: { id: first.body.data.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
    const second = await book(b.token, bookingBody(host.hostel.id, host.rooms[0]!.id)); // no worker needed
    expect(second.status).toBe(201);
    const old = await prisma.booking.findUniqueOrThrow({ where: { id: first.body.data.id } });
    expect(old.status).toBe('EXPIRED');
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [1, 1] });
    expect((await notificationsFor(a.id)).map((n) => n.type)).toContain('BOOKING_EXPIRED');
  });
});

describe('coupons at booking time', () => {
  async function makeCoupon(over: Record<string, unknown> = {}) {
    const admin = await makeUser({ roles: ['ADMIN'] });
    return prisma.coupon.create({ data: { code: uniq('BK').toUpperCase(), discountType: 'PERCENT', percentBps: 1000, maxDiscountPaise: 100000, createdById: admin.id, validFrom: D(addDays(TODAY, -5)), validTo: D(addDays(TODAY, 200)), usageLimit: 100, perUserLimit: 1, ...over } });
  }

  it('applies the discount, records the redemption, and returns the use when the booking is cancelled', async () => {
    const host = await makeHost({ rooms: [{ units: 4, price: 100000 }] });
    const guest = await makeGuest();
    const c = await makeCoupon();
    const res = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { couponCode: c.code }));
    expect(res.status).toBe(201);
    expect(res.body.data.pricing).toMatchObject({ subtotalPaise: 200000, discountPaise: 20000, couponCode: c.code, totalPaise: 189000 });
    expect(await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ usedCount: 1 });
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id, bookingId: res.body.data.id } })).toBe(1);
    const { POST: cancel } = await import('@/app/api/v1/bookings/[id]/cancel/route');
    expect((await call(cancel, { token: guest.token, params: { id: res.body.data.id }, body: {} })).status).toBe(200);
    expect(await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ usedCount: 0 });
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(0);
    expect((await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { couponCode: c.code }))).status).toBe(201); // usable again
  });

  it('does not silently ignore a code that does not apply', async () => {
    const host = await makeHost({ rooms: [{ units: 4, price: 100000 }] });
    const guest = await makeGuest();
    const expired = await makeCoupon({ validTo: D(addDays(TODAY, -1)), validFrom: D(addDays(TODAY, -9)) });
    const res = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { couponCode: expired.code }));
    expect(res.status).toBe(422);
    expect(res.body.error.details[0]).toMatchObject({ path: 'couponCode', message: 'This code has expired' });
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [0, 0] });
  });

  it('a coupon with one use left goes to exactly one of many concurrent guests', async () => {
    const host = await makeHost({ rooms: [{ units: 20, price: 100000 }] });
    const c = await makeCoupon({ usageLimit: 1 });
    const guests = await Promise.all(Array.from({ length: 8 }, () => makeGuest()));
    const results = await Promise.all(guests.map((g) => book(g.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { couponCode: c.code }))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 422)).toHaveLength(7);
    expect(await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ usedCount: 1 });
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [1, 1] }); // the 7 rejected bookings held nothing
  });

  it('enforces the per-user limit', async () => {
    const host = await makeHost({ rooms: [{ units: 20, price: 100000 }] });
    const guest = await makeGuest();
    const c = await makeCoupon({ perUserLimit: 1 });
    expect((await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { couponCode: c.code }))).status).toBe(201);
    const again = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { couponCode: c.code, checkIn: addDays(STAY.checkIn, 5), checkOut: addDays(STAY.checkIn, 7) }));
    expect(again.status).toBe(422);
    expect(again.body.error.details[0].message).toMatch(/already used/);
  });

  it('a 100% coupon makes the booking free and it confirms immediately', async () => {
    const host = await makeHost({ rooms: [{ units: 4, price: 100000 }] });
    const guest = await makeGuest();
    const c = await makeCoupon({ discountType: 'FLAT', percentBps: null, flatPaise: 500000, maxDiscountPaise: null });
    const res = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { couponCode: c.code }));
    expect(res.body.data).toMatchObject({ status: 'CONFIRMED', pricing: { totalPaise: 0, taxPaise: 0 }, payment: null });
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [0, 0], booked: [1, 1] });
    const attempt = await pay(guest.token, res.body.data.id);
    expect(attempt.init.status).toBe(409); // nothing to pay
  });
});

describe('request-to-book listings', () => {
  it('start as PENDING_APPROVAL with an owner deadline, and tell the owner', async () => {
    const host = await makeHost({ bookingMode: 'APPROVAL', rooms: [{ units: 4 }] });
    const guest = await makeGuest();
    const res = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id));
    const b = res.body.data;
    expect(b).toMatchObject({ status: 'PENDING_APPROVAL', bookingMode: 'APPROVAL', actions: ['cancel'] }); // the guest cannot pay yet
    const hours = (new Date(b.approvalDeadline).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23);
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [1, 1] });
    expect((await notificationsFor(host.owner.id)).map((n) => n.type)).toContain('BOOKING_APPROVAL_REQUESTED');
    expect((await notificationsFor(guest.id)).map((n) => n.type)).toContain('BOOKING_CREATED');
    expect(outbox.some((m) => m.subject === `Booking request ${b.code}`)).toBe(true);
    const ownerEmail = (await prisma.user.findUniqueOrThrow({ where: { id: host.owner.id } })).email;
    expect(outbox.find((m) => m.subject === `Booking request ${b.code}`)?.to).toBe(ownerEmail);
    expect((await pay(guest.token, b.id)).init.status).toBe(409);
  });
});

describe('reading bookings', () => {
  it('lists my bookings with filters and cursors, and hides other people\'s bookings', async () => {
    const host = await makeHost({ rooms: [{ units: 20 }] });
    const guest = await makeGuest(), other = await makeGuest();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { checkIn: addDays(STAY.checkIn, i * 3), checkOut: addDays(STAY.checkIn, i * 3 + 2) }))).body.data.id);
    const p1 = await call(listBookings, { method: 'GET', token: guest.token, query: '?limit=2' });
    expect(p1.body.data).toHaveLength(2);
    const p2 = await call(listBookings, { method: 'GET', token: guest.token, query: `?limit=2&cursor=${p1.body.meta.nextCursor}` });
    expect([...p1.body.data, ...p2.body.data].map((b: { id: string }) => b.id).sort()).toEqual([...ids].sort());
    for (const item of p1.body.data) expect(issues(bookingSummarySchema, item)).toEqual([]);
    expect((await call(listBookings, { method: 'GET', token: guest.token, query: '?when=past' })).body.data).toEqual([]);
    expect((await call(listBookings, { method: 'GET', token: guest.token, query: '?when=upcoming' })).body.data).toHaveLength(3);
    expect((await call(listBookings, { method: 'GET', token: other.token })).body.data).toEqual([]);
    expect((await call(getBooking, { method: 'GET', token: other.token, params: { id: ids[0]! } })).status).toBe(404);
    expect((await call(getBooking, { method: 'GET', token: guest.token, params: { id: 'nope' } })).status).toBe(404);
    expect((await call(listBookings, { method: 'GET', token: guest.token, query: '?status=BOGUS' })).status).toBe(422);
  });

  it('owners see their own bookings (without guest contact until confirmed); admins see everything', async () => {
    const host = await makeHost({ rooms: [{ units: 4 }] });
    const other = await makeHost();
    const guest = await makeGuest({ name: 'Priya Guest' });
    const b = (await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id))).body.data;
    const asOwner = await call(ownerGet, { method: 'GET', token: host.owner.token, params: { id: b.id } });
    expect(issues(bookingDtoSchema, asOwner.body.data)).toEqual([]);
    expect(asOwner.body.data).toMatchObject({ viewer: 'OWNER', guest: { name: 'Priya Guest', email: null, phone: null }, contactPhone: null });
    expect(asOwner.body.data.ownerShare).toMatchObject({ commissionPaise: 16000, ownerNetPaise: 144000 });
    expect((await call(ownerGet, { method: 'GET', token: other.owner.token, params: { id: b.id } })).status).toBe(404);
    expect((await call(ownerGet, { method: 'GET', token: guest.token, params: { id: b.id } })).status).toBe(403);
    const admin = await makeUser({ roles: ['ADMIN'] });
    const all = await call(adminList, { method: 'GET', token: admin.token, query: '?limit=50' });
    expect(all.body.data.some((x: { id: string }) => x.id === b.id)).toBe(true);
    expect((await call(adminList, { method: 'GET', token: host.owner.token })).status).toBe(403);
  });

  it('expireDueBookings only touches bookings that are actually overdue', async () => {
    const host = await makeHost({ rooms: [{ units: 4 }] });
    const guest = await makeGuest();
    const live = (await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id))).body.data;
    expect(await expireDueBookings({ hostelId: host.hostel.id })).toBe(0);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: live.id } })).status).toBe('PENDING_PAYMENT');
    expect(await expireDueBookings({ hostelId: host.hostel.id, now: new Date(Date.now() + 16 * 60_000) })).toBe(1);
    expect(await expireDueBookings({ hostelId: host.hostel.id, now: new Date(Date.now() + 16 * 60_000) })).toBe(0); // already done
    expect(await inventoryOf(host.rooms[0]!.id)).toMatchObject({ held: [0, 0] });
  });
});
