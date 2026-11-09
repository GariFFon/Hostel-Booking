import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { GET as ownerList, POST as ownerCreate } from '@/app/api/v1/owner/coupons/route';
import { DELETE as ownerDelete, GET as ownerGet, PATCH as ownerPatch } from '@/app/api/v1/owner/coupons/[id]/route';
import { GET as adminList, POST as adminCreate } from '@/app/api/v1/admin/coupons/route';
import { DELETE as adminDelete, GET as adminGet, PATCH as adminPatch } from '@/app/api/v1/admin/coupons/[id]/route';
import { GET as offers } from '@/app/api/v1/hostels/[idOrSlug]/offers/route';
import { POST as quote } from '@/app/api/v1/quotes/route';
import { GET as getBooking } from '@/app/api/v1/bookings/[id]/route';
import { COUPON_LIMITS, couponDtoSchema, offerSchema } from '@/modules/coupons/coupons.schema';
import { couponStatus } from '@/modules/coupons/coupons.service';
import { call } from '../helpers/http';
import { STAY, book, bookingBody, makeGuest, makeHost, pay } from '../helpers/booking';
import { issues, makeAdmin } from '../helpers/engagement';
import { D, TODAY, uniq } from '../helpers/publish';
import { makeUser } from '../helpers/users';

beforeAll(async () => {
  await redis.flushdb();
});

const PRICE = { rooms: [{ units: 6, price: 80000 }] }; // 2 nights x 1 bed = 160000, +5% GST
const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const code = (p = 'SAVE') => `${p}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
const percent = (hostelId: string | undefined, over: Record<string, unknown> = {}) => ({
  code: code(), discountType: 'PERCENT', percentBps: 1000, maxDiscountPaise: 50000, minBookingPaise: 100000, hostelId, validFrom: iso(-1), validTo: iso(30), usageLimit: 100, perUserLimit: 1, ...over,
});
const flat = (hostelId: string | undefined, over: Record<string, unknown> = {}) => ({ code: code('FLAT'), discountType: 'FLAT', flatPaise: 20000, minBookingPaise: 0, hostelId, validFrom: iso(-1), validTo: iso(30), ...over });
const mk = (token: string, body: object) => call(ownerCreate, { token, body });
const adminMk = (token: string, body: object) => call(adminCreate, { token, body });
const row = (id: string) => prisma.coupon.findUniqueOrThrow({ where: { id } });
const byCode = (c: string) => prisma.coupon.findUnique({ where: { code: c.toUpperCase() } });
const ask = (host: { hostel: { id: string }; rooms: { id: string }[] }, couponCode: string, token?: string) =>
  call(quote, { token, body: { hostelId: host.hostel.id, ...STAY, guests: 1, items: [{ roomTypeId: host.rooms[0]!.id, units: 1 }], couponCode } });

describe('couponStatus', () => {
  const NOW = new Date('2026-12-01T00:00:00Z');
  const base = { isActive: true, validFrom: new Date('2026-11-01'), validTo: new Date('2027-01-01'), usageLimit: 10, usedCount: 0 };
  it.each([
    ['active', base, 'ACTIVE'], ['unlimited', { ...base, usageLimit: null, usedCount: 99999 }, 'ACTIVE'],
    ['switched off beats everything', { ...base, isActive: false, validTo: new Date('2026-01-01') }, 'DISABLED'],
    ['expired', { ...base, validTo: new Date('2026-11-30') }, 'EXPIRED'], ['scheduled', { ...base, validFrom: new Date('2026-12-02') }, 'SCHEDULED'],
    ['exhausted', { ...base, usedCount: 10 }, 'EXHAUSTED'], ['one left', { ...base, usedCount: 9 }, 'ACTIVE'],
  ])('%s', (_n, c, expected) => expect(couponStatus(c, NOW)).toBe(expected));
});

describe('creating coupons', () => {
  it('a host creates a code for their own property: upper-cased, defaults filled, audited, in the response contract', async () => {
    const host = await makeHost(PRICE);
    const body = { code: `  save${Math.random().toString(36).slice(2, 7)}  `, discountType: 'PERCENT', percentBps: 1250, hostelId: host.hostel.id, validFrom: iso(-1), validTo: iso(30) };
    const res = await mk(host.owner.token, body);
    expect(res.status).toBe(201);
    expect(issues(couponDtoSchema, res.body.data)).toEqual([]);
    expect(res.body.data).toMatchObject({
      code: body.code.trim().toUpperCase(), scope: 'PROPERTY', hostel: { id: host.hostel.id, slug: host.hostel.slug }, discountType: 'PERCENT', percentBps: 1250, flatPaise: null, maxDiscountPaise: null,
      minBookingPaise: 0, perUserLimit: 1, usageLimit: null, remaining: null, usedCount: 0, isActive: true, isPublic: false, status: 'ACTIVE', redeemedPaise: 0, createdById: host.owner.id,
    });
    expect((await row(res.body.data.id)).code).toBe(res.body.data.code);
    expect(await prisma.auditLog.count({ where: { entityId: res.body.data.id, action: 'coupon.create' } })).toBe(1);

    const f = await mk(host.owner.token, flat(host.hostel.id, { usageLimit: 5, isPublic: true, isActive: false }));
    expect(f.body.data).toMatchObject({ discountType: 'FLAT', flatPaise: 20000, percentBps: null, remaining: 5, isPublic: true, isActive: false, status: 'DISABLED' });
  });

  it.each([
    ['code too short', { code: 'abc' }], ['code with a space', { code: 'has space' }], ['code too long', { code: 'X'.repeat(21) }], ['code starting with a dash', { code: '-SAVE10' }],
    ['code with an emoji', { code: 'SAVE🎉10' }], ['code with a dot', { code: 'SAVE.10' }],
    ['percent without percentBps', { percentBps: undefined }], ['percent with flatPaise', { flatPaise: 5000 }],
    ['percentBps below 1%', { percentBps: 50 }], ['percentBps above 100%', { percentBps: 10001 }], ['percentBps 0', { percentBps: 0 }], ['percentBps fractional', { percentBps: 1000.5 }],
    ['maxDiscount below ₹1', { maxDiscountPaise: 99 }], ['maxDiscount above ₹50,000', { maxDiscountPaise: 5_000_001 }],
    ['validTo before validFrom', { validFrom: iso(10), validTo: iso(5) }], ['validTo equals validFrom', { validFrom: '2030-01-01T00:00:00Z', validTo: '2030-01-01T00:00:00Z' }],
    ['already over', { validFrom: iso(-10), validTo: iso(-1) }], ['valid for more than two years', { validFrom: iso(0), validTo: iso(COUPON_LIMITS.maxValidityDays + 2) }],
    ['usageLimit 0', { usageLimit: 0 }], ['perUserLimit 0', { perUserLimit: 0 }], ['perUserLimit 101', { perUserLimit: 101 }], ['negative minimum', { minBookingPaise: -1 }], ['minimum above ₹10 lakh', { minBookingPaise: 100_000_001 }],
    ['dates that are not ISO', { validFrom: 'tomorrow' }], ['blank description', { description: '' }], ['description too long', { description: 'x'.repeat(201) }],
    ['smuggled usedCount', { usedCount: 0 }], ['smuggled createdById', { createdById: '00000000-0000-4000-8000-000000000000' }], ['unknown field', { status: 'ACTIVE' }],
  ])('rejects %s (422) and stores nothing', async (_name, over) => {
    const host = await makeHost(PRICE);
    const body = percent(host.hostel.id, { code: code('BAD'), ...over });
    const res = await mk(host.owner.token, body);
    expect(res.status).toBe(422);
    expect(await prisma.coupon.count({ where: { hostel: { ownerId: host.owner.id } } })).toBe(0);
  });

  it.each([
    ['flat without flatPaise', { discountType: 'FLAT', percentBps: undefined, flatPaise: undefined }],
    ['flat with percentBps', { discountType: 'FLAT', flatPaise: 5000 }], ['flat with maxDiscount', { discountType: 'FLAT', percentBps: undefined, flatPaise: 5000 }],
    ['flat below ₹1', { discountType: 'FLAT', percentBps: undefined, maxDiscountPaise: undefined, flatPaise: 99 }],
    ['flat above ₹50,000', { discountType: 'FLAT', percentBps: undefined, maxDiscountPaise: undefined, flatPaise: 5_000_001 }],
  ])('rejects %s (422)', async (_name, over) => {
    const host = await makeHost(PRICE);
    expect((await mk(host.owner.token, percent(host.hostel.id, { code: code('BAD'), ...over }))).status).toBe(422);
  });

  it('hosts need a property of their own; admins make platform-wide codes only', async () => {
    const host = await makeHost(PRICE);
    const rival = await makeHost(PRICE);
    const gone = await makeHost({ ...PRICE, deleted: true });
    const admin = await makeAdmin();

    expect((await mk(host.owner.token, percent(undefined))).status).toBe(422); // which property?
    expect((await mk(host.owner.token, percent(rival.hostel.id))).status).toBe(404); // someone else's property: not found
    expect((await mk(gone.owner.token, percent(gone.hostel.id))).status).toBe(404);
    expect((await mk(host.owner.token, percent('00000000-0000-4000-8000-000000000000'))).status).toBe(404);
    expect((await adminMk(admin.token, percent(host.hostel.id))).status).toBe(422); // admin codes are platform-wide

    const platform = await adminMk(admin.token, percent(undefined, { code: code('PLAT') }));
    expect(platform.status).toBe(201);
    expect(platform.body.data).toMatchObject({ scope: 'PLATFORM', hostel: null, createdById: admin.id });
  });

  it('enforces roles on every coupon endpoint', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const admin = await makeAdmin();
    const c = await mk(host.owner.token, percent(host.hostel.id));
    const id = c.body.data.id;
    for (const [fn, opts] of [
      [ownerList, { method: 'GET' }], [ownerCreate, { body: percent(host.hostel.id) }], [ownerGet, { method: 'GET', params: { id } }],
      [ownerPatch, { method: 'PATCH', params: { id }, body: { isActive: false } }], [ownerDelete, { method: 'DELETE', params: { id } }],
    ] as const) {
      expect((await call(fn, { ...opts, token: guest.token })).status).toBe(403);
      expect((await call(fn, { ...opts, token: admin.token })).status).toBe(403); // admins use the admin endpoints
      expect((await call(fn, { ...opts })).status).toBe(401);
    }
    for (const [fn, opts] of [
      [adminList, { method: 'GET' }], [adminCreate, { body: percent(undefined) }], [adminGet, { method: 'GET', params: { id } }],
      [adminPatch, { method: 'PATCH', params: { id }, body: { isActive: false } }], [adminDelete, { method: 'DELETE', params: { id } }],
    ] as const) {
      expect((await call(fn, { ...opts, token: host.owner.token })).status).toBe(403);
      expect((await call(fn, { ...opts, token: guest.token })).status).toBe(403);
      expect((await call(fn, { ...opts })).status).toBe(401);
    }
    expect((await row(id)).isActive).toBe(true);
  });

  it('codes are globally unique and case-insensitive', async () => {
    const a = await makeHost(PRICE);
    const b = await makeHost(PRICE);
    const admin = await makeAdmin();
    const c = code('DUP');
    expect((await mk(a.owner.token, percent(a.hostel.id, { code: c }))).status).toBe(201);
    const same = await mk(b.owner.token, percent(b.hostel.id, { code: c.toLowerCase() }));
    expect(same.status).toBe(409);
    expect(same.body.error.message).toMatch(/already taken/i);
    expect((await adminMk(admin.token, percent(undefined, { code: c }))).status).toBe(409);
    expect(await prisma.coupon.count({ where: { code: c } })).toBe(1);
  });

  it(`a host can have at most ${COUPON_LIMITS.maxPerOwner} coupons`, async () => {
    const host = await makeHost(PRICE);
    const admin = await makeAdmin();
    await prisma.coupon.createMany({
      data: Array.from({ length: COUPON_LIMITS.maxPerOwner }, (_, i) => ({ code: `CAP${i}${uniq()}`.toUpperCase(), discountType: 'FLAT' as const, flatPaise: 100, hostelId: host.hostel.id, createdById: host.owner.id, validFrom: D(addDays(TODAY, -1)), validTo: D(addDays(TODAY, 30)) })),
    });
    const over = await mk(host.owner.token, percent(host.hostel.id));
    expect(over.status).toBe(409);
    const first = await prisma.coupon.findFirstOrThrow({ where: { hostelId: host.hostel.id } });
    expect((await call(ownerDelete, { method: 'DELETE', token: host.owner.token, params: { id: first.id } })).status).toBe(200);
    expect((await mk(host.owner.token, percent(host.hostel.id))).status).toBe(201);
    expect((await adminMk(admin.token, percent(undefined))).status).toBe(201); // the cap is per host, not for the platform
  });
});

describe('listing and reading', () => {
  it('hosts see only coupons on their own properties; admins see everything and can filter', async () => {
    const a = await makeHost(PRICE);
    const a2 = await makeHost({ ...PRICE, ownerId: a.owner.id });
    const b = await makeHost(PRICE);
    const admin = await makeAdmin();
    const mine1 = (await mk(a.owner.token, percent(a.hostel.id))).body.data;
    const mine2 = (await mk(a.owner.token, flat(a2.hostel.id, { isActive: false }))).body.data;
    const theirs = (await mk(b.owner.token, percent(b.hostel.id))).body.data;
    const platform = (await adminMk(admin.token, percent(undefined, { code: code('PL') }))).body.data;

    const list = async (fn: typeof ownerList, token: string, q = '') => (await call(fn, { method: 'GET', token, query: q })).body.data.map((c: { id: string }) => c.id) as string[];
    expect((await list(ownerList, a.owner.token)).sort()).toEqual([mine1.id, mine2.id].sort());
    expect(await list(ownerList, a.owner.token, `?hostelId=${a2.hostel.id}`)).toEqual([mine2.id]);
    expect(await list(ownerList, a.owner.token, '?isActive=false')).toEqual([mine2.id]);
    expect(await list(ownerList, a.owner.token, '?isActive=true')).toEqual([mine1.id]);
    expect(await list(ownerList, a.owner.token, `?hostelId=${b.hostel.id}`)).toEqual([]); // someone else's property: nothing, not an error
    expect(await list(ownerList, a.owner.token, '?scope=PLATFORM')).toHaveLength(2); // scope is an admin filter; hosts never see platform codes

    const all = await list(adminList, admin.token, '?limit=50');
    for (const c of [mine1, mine2, theirs, platform]) expect(all).toContain(c.id);
    expect(await list(adminList, admin.token, '?scope=PLATFORM&limit=50')).toContain(platform.id);
    expect(await list(adminList, admin.token, '?scope=PLATFORM&limit=50')).not.toContain(mine1.id);
    expect(await list(adminList, admin.token, '?scope=PROPERTY&limit=50')).not.toContain(platform.id);
    expect(await list(adminList, admin.token, `?hostelId=${b.hostel.id}`)).toEqual([theirs.id]);
    expect((await call(ownerList, { method: 'GET', token: a.owner.token, query: '?isActive=maybe' })).status).toBe(422);
  });

  it('pages newest-first without gaps or repeats', async () => {
    const host = await makeHost(PRICE);
    const made: string[] = [];
    for (let i = 0; i < 5; i++) made.push((await mk(host.owner.token, percent(host.hostel.id))).body.data.id);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 6; page++) {
      const res = await call(ownerList, { method: 'GET', token: host.owner.token, query: `?limit=2${cursor ? `&cursor=${cursor}` : ''}` });
      seen.push(...res.body.data.map((c: { id: string }) => c.id));
      cursor = res.body.meta.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(seen).toEqual([...made].reverse());
  });

  it('reads one coupon: own or any (admin), never someone else\'s', async () => {
    const a = await makeHost(PRICE);
    const b = await makeHost(PRICE);
    const admin = await makeAdmin();
    const c = (await mk(a.owner.token, percent(a.hostel.id))).body.data;
    expect((await call(ownerGet, { method: 'GET', token: a.owner.token, params: { id: c.id } })).body.data).toMatchObject({ id: c.id, code: c.code });
    expect((await call(ownerGet, { method: 'GET', token: b.owner.token, params: { id: c.id } })).status).toBe(404);
    expect((await call(adminGet, { method: 'GET', token: admin.token, params: { id: c.id } })).body.data.id).toBe(c.id);
    expect((await call(ownerGet, { method: 'GET', token: a.owner.token, params: { id: 'nope' } })).status).toBe(404);
    expect((await call(adminGet, { method: 'GET', token: admin.token, params: { id: '00000000-0000-4000-8000-000000000000' } })).status).toBe(404);
  });
});

describe('changing coupons', () => {
  it('a host edits the terms; the code, type and property are fixed; every change is audited', async () => {
    const host = await makeHost(PRICE);
    const c = (await mk(host.owner.token, percent(host.hostel.id, { description: 'Launch offer' }))).body.data;
    const res = await call(ownerPatch, { method: 'PATCH', token: host.owner.token, params: { id: c.id }, body: { percentBps: 1500, maxDiscountPaise: null, minBookingPaise: 0, description: null, validTo: iso(90), usageLimit: null, perUserLimit: 3, isPublic: true } });
    expect(res.status).toBe(200);
    expect(issues(couponDtoSchema, res.body.data)).toEqual([]);
    expect(res.body.data).toMatchObject({ code: c.code, discountType: 'PERCENT', percentBps: 1500, maxDiscountPaise: null, minBookingPaise: 0, description: null, usageLimit: null, remaining: null, perUserLimit: 3, isPublic: true });
    const audit = await prisma.auditLog.findMany({ where: { entityId: c.id, action: 'coupon.update' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ before: { percentBps: 1000, perUserLimit: 1, isPublic: false }, after: { percentBps: 1500, perUserLimit: 3, isPublic: true } });

    for (const body of [{ code: 'NEWCODE1' }, { discountType: 'FLAT' }, { hostelId: '00000000-0000-4000-8000-000000000000' }, { usedCount: 0 }, { createdById: host.owner.id }, { status: 'ACTIVE' }, {}]) {
      expect((await call(ownerPatch, { method: 'PATCH', token: host.owner.token, params: { id: c.id }, body })).status).toBe(422);
    }
    expect((await row(c.id)).code).toBe(c.code);
  });

  it.each([
    ['a flat amount on a percentage coupon', percent, { flatPaise: 5000 }],
    ['clearing the percentage of a percentage coupon', percent, { percentBps: null }],
    ['a percentage on a flat coupon', flat, { percentBps: 1000 }],
    ['a maximum on a flat coupon', flat, { maxDiscountPaise: 5000 }],
    ['clearing the amount of a flat coupon', flat, { flatPaise: null }],
    ['ending before it starts', percent, { validTo: iso(-5) }],
    ['a start after the end', percent, { validFrom: iso(60) }],
    ['two years and more of validity', percent, { validTo: iso(COUPON_LIMITS.maxValidityDays + 5) }],
    ['a percentage above 100%', percent, { percentBps: 10001 }],
  ])('rejects %s (422) and leaves the coupon untouched', async (_n, make, patch) => {
    const host = await makeHost(PRICE);
    const c = (await mk(host.owner.token, make(host.hostel.id))).body.data;
    const res = await call(ownerPatch, { method: 'PATCH', token: host.owner.token, params: { id: c.id }, body: patch });
    expect(res.status).toBe(422);
    expect(await prisma.auditLog.count({ where: { entityId: c.id, action: 'coupon.update' } })).toBe(0);
    expect((await call(ownerGet, { method: 'GET', token: host.owner.token, params: { id: c.id } })).body.data).toMatchObject({ percentBps: c.percentBps, flatPaise: c.flatPaise, validTo: c.validTo });
  });

  it('the usage limit can never drop below what is already in use', async () => {
    const host = await makeHost(PRICE);
    const c = (await mk(host.owner.token, percent(host.hostel.id, { usageLimit: 10 }))).body.data;
    await prisma.coupon.update({ where: { id: c.id }, data: { usedCount: 4 } });
    const low = await call(ownerPatch, { method: 'PATCH', token: host.owner.token, params: { id: c.id }, body: { usageLimit: 3 } });
    expect(low.status).toBe(422);
    expect(JSON.stringify(low.body.error.details)).toContain('usageLimit');
    expect((await call(ownerPatch, { method: 'PATCH', token: host.owner.token, params: { id: c.id }, body: { usageLimit: 4 } })).body.data).toMatchObject({ usageLimit: 4, remaining: 0, status: 'EXHAUSTED' });
    expect((await call(ownerPatch, { method: 'PATCH', token: host.owner.token, params: { id: c.id }, body: { usageLimit: null } })).body.data).toMatchObject({ usageLimit: null, remaining: null, status: 'ACTIVE' });
  });

  it('other hosts cannot touch it', async () => {
    const a = await makeHost(PRICE);
    const b = await makeHost(PRICE);
    const c = (await mk(a.owner.token, percent(a.hostel.id))).body.data;
    expect((await call(ownerPatch, { method: 'PATCH', token: b.owner.token, params: { id: c.id }, body: { isActive: false } })).status).toBe(404);
    expect((await call(ownerDelete, { method: 'DELETE', token: b.owner.token, params: { id: c.id } })).status).toBe(404);
    expect((await row(c.id)).isActive).toBe(true);
  });

  it('admins own platform codes outright, but only moderate host codes (switch off / unlist)', async () => {
    const host = await makeHost(PRICE);
    const admin = await makeAdmin();
    const hostCode = (await mk(host.owner.token, percent(host.hostel.id, { isPublic: true }))).body.data;
    const platform = (await adminMk(admin.token, percent(undefined, { code: code('PL') }))).body.data;

    for (const patch of [{ percentBps: 5000 }, { description: 'edited by admin' }, { usageLimit: 1 }, { validTo: iso(10) }, { isActive: false, percentBps: 5000 }]) {
      expect((await call(adminPatch, { method: 'PATCH', token: admin.token, params: { id: hostCode.id }, body: patch })).status).toBe(403);
    }
    expect(await row(hostCode.id)).toMatchObject({ percentBps: 1000, isActive: true });
    const off = await call(adminPatch, { method: 'PATCH', token: admin.token, params: { id: hostCode.id }, body: { isActive: false, isPublic: false } });
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ isActive: false, isPublic: false, status: 'DISABLED', percentBps: 1000 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: hostCode.id, action: 'coupon.update' } });
    expect(audit.actorRole).toBe('ADMIN');

    const edited = await call(adminPatch, { method: 'PATCH', token: admin.token, params: { id: platform.id }, body: { percentBps: 2000, usageLimit: 50, description: 'Festival offer' } });
    expect(edited.body.data).toMatchObject({ percentBps: 2000, usageLimit: 50, description: 'Festival offer', scope: 'PLATFORM' });
  });
});

describe('deleting', () => {
  it('removes an unused coupon for good; a used one must be deactivated instead', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const unused = (await mk(host.owner.token, percent(host.hostel.id))).body.data;
    const del = await call(ownerDelete, { method: 'DELETE', token: host.owner.token, params: { id: unused.id } });
    expect(del.status).toBe(200);
    expect(del.body.data).toEqual({ deleted: true });
    expect(await byCode(unused.code)).toBeNull();
    expect((await call(ownerDelete, { method: 'DELETE', token: host.owner.token, params: { id: unused.id } })).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { entityId: unused.id, action: 'coupon.delete' } })).toBe(1);

    const used = (await mk(host.owner.token, percent(host.hostel.id))).body.data;
    const booked = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { couponCode: used.code }));
    expect(booked.status).toBe(201);
    const refuse = await call(ownerDelete, { method: 'DELETE', token: host.owner.token, params: { id: used.id } });
    expect(refuse.status).toBe(409);
    expect(refuse.body.error.message).toMatch(/deactivate/i);
    expect(await byCode(used.code)).not.toBeNull();

    // deactivating is the supported way out: existing bookings keep their discount, new quotes refuse the code
    await call(ownerPatch, { method: 'PATCH', token: host.owner.token, params: { id: used.id }, body: { isActive: false } });
    expect((await ask(host, used.code)).body.data.coupon).toMatchObject({ valid: false, reason: 'INACTIVE' });
    expect((await call(getBooking, { method: 'GET', token: guest.token, params: { id: booked.body.data.id } })).body.data.pricing).toMatchObject({ couponCode: used.code, discountPaise: 16000 });
  });

  it('an admin can remove an unused code of any host, and platform codes', async () => {
    const host = await makeHost(PRICE);
    const admin = await makeAdmin();
    const hostCode = (await mk(host.owner.token, percent(host.hostel.id))).body.data;
    const platform = (await adminMk(admin.token, percent(undefined, { code: code('PL') }))).body.data;
    expect((await call(adminDelete, { method: 'DELETE', token: admin.token, params: { id: hostCode.id } })).status).toBe(200);
    expect((await call(adminDelete, { method: 'DELETE', token: admin.token, params: { id: platform.id } })).status).toBe(200);
    expect(await byCode(hostCode.code)).toBeNull();
    expect(await byCode(platform.code)).toBeNull();
  });
});

describe('coupons in a real booking', () => {
  it('a host code prices a quote, is consumed by the booking, and shows up in the host\'s list with its value', async () => {
    const host = await makeHost(PRICE);
    const other = await makeHost(PRICE);
    const guest = await makeGuest();
    const c = (await mk(host.owner.token, percent(host.hostel.id, { percentBps: 1000, maxDiscountPaise: 50000, minBookingPaise: 100000, usageLimit: 3 }))).body.data;

    const q = await ask(host, c.code.toLowerCase(), guest.token);
    expect(q.body.data.coupon).toMatchObject({ valid: true, code: c.code, discountPaise: 16000 });
    expect((await ask(other, c.code)).body.data.coupon).toMatchObject({ valid: false, reason: 'WRONG_HOSTEL' });

    expect((await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { couponCode: c.code }))).status).toBe(201);
    const after = (await call(ownerGet, { method: 'GET', token: host.owner.token, params: { id: c.id } })).body.data;
    expect(after).toMatchObject({ usedCount: 1, remaining: 2, redeemedPaise: 16000, status: 'ACTIVE' });
    expect((await ask(host, c.code, guest.token)).body.data.coupon).toMatchObject({ valid: false, reason: 'USER_LIMIT' });
  });

  it('a platform code works at any property and is funded by the platform', async () => {
    const admin = await makeAdmin();
    const host = await makeHost(PRICE);
    const c = (await adminMk(admin.token, flat(undefined, { flatPaise: 20000, minBookingPaise: 100000 }))).body.data;
    const q = await ask(host, c.code);
    expect(q.body.data.coupon).toMatchObject({ valid: true, discountPaise: 20000 });
    const guest = await makeGuest();
    const b = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { couponCode: c.code }));
    expect(b.status).toBe(201);
    const full = await prisma.booking.findUniqueOrThrow({ where: { id: b.body.data.id }, include: { coupon: true } });
    expect(full.coupon!.hostelId).toBeNull(); // the ledger treats "no property" as platform-funded
  });

  it('a coupon that covers everything makes the stay free: it confirms at once and there is nothing to pay', async () => {
    const host = await makeHost(PRICE);
    const guest = await makeGuest();
    const c = (await mk(host.owner.token, percent(host.hostel.id, { percentBps: 10000, maxDiscountPaise: undefined, minBookingPaise: 0 }))).body.data; // 100% off, funded by the host
    const q = (await ask(host, c.code, guest.token)).body.data;
    expect(q).toMatchObject({ subtotalPaise: 160000, discountPaise: 160000, taxPaise: 0, totalPaise: 0 });
    expect(q.coupon).toMatchObject({ valid: true, discountPaise: 160000 });

    const b = await book(guest.token, bookingBody(host.hostel.id, host.rooms[0]!.id, { couponCode: c.code }));
    expect(b.status).toBe(201);
    expect(b.body.data).toMatchObject({ status: 'CONFIRMED', payment: null, pricing: { totalPaise: 0, discountPaise: 160000 }, actions: ['cancel'] });
    expect((await pay(guest.token, b.body.data.id)).init.status).toBe(409);
    expect(await prisma.ledgerEntry.count({ where: { bookingId: b.body.data.id } })).toBe(0); // no money moved
    expect((await call(ownerGet, { method: 'GET', token: host.owner.token, params: { id: c.id } })).body.data).toMatchObject({ usedCount: 1, redeemedPaise: 160000 });
  });
});

describe('public offers', () => {
  const mkRow = (hostelId: string | null, createdById: string, over: Record<string, unknown> = {}) =>
    prisma.coupon.create({
      data: { code: code('OF'), discountType: 'PERCENT', percentBps: 1000, maxDiscountPaise: 50000, minBookingPaise: 100000, hostelId, createdById, isPublic: true, validFrom: new Date(Date.now() - 86_400_000), validTo: new Date(Date.now() + 30 * 86_400_000), usageLimit: 10, perUserLimit: 1, ...over },
    });

  it('lists only public, active, in-date, unexhausted codes for this property and the platform', async () => {
    const admin = await makeAdmin();
    const host = await makeHost(PRICE);
    const rival = await makeHost(PRICE);
    const listed = await mkRow(host.hostel.id, host.owner.id);
    const platform = await mkRow(null, admin.id, { discountType: 'FLAT', percentBps: null, maxDiscountPaise: null, flatPaise: 20000, minBookingPaise: 0, usageLimit: null });
    const hidden = [
      await mkRow(host.hostel.id, host.owner.id, { isPublic: false }), await mkRow(host.hostel.id, host.owner.id, { isActive: false }),
      await mkRow(host.hostel.id, host.owner.id, { validTo: new Date(Date.now() - 60_000) }), await mkRow(host.hostel.id, host.owner.id, { validFrom: new Date(Date.now() + 86_400_000) }),
      await mkRow(host.hostel.id, host.owner.id, { usageLimit: 2, usedCount: 2 }), await mkRow(rival.hostel.id, rival.owner.id),
    ];

    const res = await call(offers, { method: 'GET', params: { idOrSlug: host.hostel.slug } });
    expect(res.status).toBe(200);
    const got: { code: string }[] = res.body.data;
    expect(got.map((o) => o.code)).toEqual(expect.arrayContaining([listed.code, platform.code]));
    for (const h of hidden) expect(got.map((o) => o.code)).not.toContain(h.code);
    expect(got.every((o) => issues(offerSchema, o).length === 0)).toBe(true);
    expect(got.find((o) => o.code === listed.code)).toMatchObject({ scope: 'PROPERTY', headline: '10% off up to ₹500 on bookings of ₹1,000 or more', discountType: 'PERCENT', percentBps: 1000 });
    expect(got.find((o) => o.code === platform.code)).toMatchObject({ scope: 'PLATFORM', headline: '₹200 off', flatPaise: 20000 });
    expect(JSON.stringify(res.body)).not.toMatch(/usedCount|createdById|usageLimit|perUserLimit/); // internals are not published
  });

  it('formats headlines for fractional percentages and large amounts', async () => {
    const host = await makeHost(PRICE);
    const a = await mkRow(host.hostel.id, host.owner.id, { percentBps: 1250, maxDiscountPaise: null, minBookingPaise: 0 });
    const b = await mkRow(host.hostel.id, host.owner.id, { discountType: 'FLAT', percentBps: null, maxDiscountPaise: null, flatPaise: 12345600, minBookingPaise: 2500000 });
    const got = (await call(offers, { method: 'GET', params: { idOrSlug: host.hostel.id } })).body.data as { code: string; headline: string }[];
    expect(got.find((o) => o.code === a.code)!.headline).toBe('12.5% off');
    expect(got.find((o) => o.code === b.code)!.headline).toBe('₹1,23,456 off on bookings of ₹25,000 or more'); // Indian digit grouping
  });

  it('is cached and refreshed when a host or an admin changes a coupon', async () => {
    const admin = await makeAdmin();
    const host = await makeHost(PRICE);
    const mine = (await mk(host.owner.token, percent(host.hostel.id, { isPublic: true }))).body.data;
    const get = () => call(offers, { method: 'GET', params: { idOrSlug: host.hostel.id } });
    const first = await get();
    expect(first.headers.get('x-cache')).toBe('MISS');
    expect((await get()).headers.get('x-cache')).toBe('HIT');
    expect(first.body.data.map((o: { code: string }) => o.code)).toContain(mine.code);

    await call(ownerPatch, { method: 'PATCH', token: host.owner.token, params: { id: mine.id }, body: { isPublic: false } });
    const afterHide = await get();
    expect(afterHide.headers.get('x-cache')).toBe('MISS');
    expect(afterHide.body.data.map((o: { code: string }) => o.code)).not.toContain(mine.code);

    await get();
    const plat = (await adminMk(admin.token, percent(undefined, { code: code('PL'), isPublic: true }))).body.data; // a platform code must reach every property's cache
    const afterPlatform = await get();
    expect(afterPlatform.headers.get('x-cache')).toBe('MISS');
    expect(afterPlatform.body.data.map((o: { code: string }) => o.code)).toContain(plat.code);

    await call(adminDelete, { method: 'DELETE', token: admin.token, params: { id: plat.id } });
    expect((await get()).body.data.map((o: { code: string }) => o.code)).not.toContain(plat.code);
  });

  it('is only available for live listings', async () => {
    const draft = await makeHost({ ...PRICE, status: 'DRAFT' });
    expect((await call(offers, { method: 'GET', params: { idOrSlug: draft.hostel.id } })).status).toBe(404);
    expect((await call(offers, { method: 'GET', params: { idOrSlug: 'no-such-place' } })).status).toBe(404);
    expect((await call(offers, { method: 'GET', params: { idOrSlug: 'bad slug!' } })).status).toBe(404);
  });
});

describe('database guards', () => {
  it.each([
    ['a per-user limit of 0', { perUserLimit: 0 }, /coupons_limits_positive/],
    ['a usage limit of 0', { usageLimit: 0 }, /coupons_limits_positive/],
    ['a zero maximum discount', { maxDiscountPaise: 0 }, /coupons_max_discount_positive/],
    ['a negative minimum booking', { minBookingPaise: -1 }, /coupons_min_booking_nonneg/],
    ['more uses than the limit', { usageLimit: 1, usedCount: 2 }, /coupons_used_bounds/],
    ['a lower-case code', { code: 'lowercase1' }, /coupons_code_uppercase/],
  ])('rejects %s', async (_n, over, pattern) => {
    const admin = await makeUser({ roles: ['ADMIN'] });
    await expect(prisma.coupon.create({
      data: { code: code('DB'), discountType: 'PERCENT', percentBps: 1000, createdById: admin.id, validFrom: new Date(Date.now() - 1000), validTo: new Date(Date.now() + 86_400_000), ...over },
    })).rejects.toThrow(pattern);
  });
});
