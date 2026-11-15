import { describe, expect, it } from 'vitest';
import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { TODAY, publish } from '../helpers/publish';
import { makeUser } from '../helpers/users';
import { api, applyBody, approvedTenant, makeStay, student } from '../helpers/tenancy';

describe('what a student sees before applying', () => {
  it('shows the terms and the free beds per room type', async () => {
    const { hostel, room } = await makeStay({ units: 3 });
    const res = await api.terms(hostel.slug);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ depositMonths: 2, noticeDays: 30, rentDueDay: 1, rentGraceDays: 5 });
    expect(res.body.data.rooms).toEqual([expect.objectContaining({ roomTypeId: room.id, rentPaise: 600000, freeUnits: 3 })]);
  });

  it('is not offered for hotels', async () => {
    const hotel = await publish({ propertyType: 'HOTEL' });
    expect((await api.terms(hotel.hostel.slug)).status).toBe(404);
  });
});

describe('applying for a bed', () => {
  it('creates an open request, tells the owner, and audits it against the property', async () => {
    const stay = await makeStay();
    const s = await student();
    const res = await api.apply(s.token, stay.hostel.id, applyBody(stay.room.id));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'REQUESTED', actions: ['withdraw'], emergencyContact: { name: 'Asha Rao' } });
    expect(await prisma.notification.count({ where: { userId: stay.owner.id, type: 'TENANCY_REQUESTED' } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'tenancy.application.create', entityId: res.body.data.id } });
    expect(audit.metadata).toMatchObject({ hostelId: stay.hostel.id });
  });

  it('also works with the property slug', async () => {
    const stay = await makeStay();
    const s = await student();
    expect((await api.apply(s.token, stay.hostel.slug, applyBody(stay.room.id))).status).toBe(201);
  });

  it('needs a verified email', async () => {
    const stay = await makeStay();
    const s = await student({ verified: false });
    expect((await api.apply(s.token, stay.hostel.id, applyBody(stay.room.id))).status).toBe(403);
  });

  it('cannot be sent to your own property, a hotel, or an unlisted room', async () => {
    const stay = await makeStay();
    expect((await api.apply(stay.owner.token, stay.hostel.id, applyBody(stay.room.id))).status).toBe(409);
    const hotel = await publish({ propertyType: 'HOTEL' });
    const s = await student();
    expect((await api.apply(s.token, hotel.hostel.id, applyBody(hotel.rooms[0]!.id))).status).toBe(404);
    const other = await makeStay();
    expect((await api.apply(s.token, stay.hostel.id, applyBody(other.room.id))).status).toBe(422);
  });

  it('validates dates, contact details and gender rules', async () => {
    const stay = await makeStay({ genderPolicy: 'FEMALE_ONLY' });
    const s = await student();
    const bad = (over: Record<string, unknown>) => api.apply(s.token, stay.hostel.id, applyBody(stay.room.id, over));
    expect((await bad({ moveInDate: addDays(TODAY, -1) })).status).toBe(422);
    expect((await bad({ moveInDate: addDays(TODAY, 400) })).status).toBe(422);
    expect((await bad({ emergencyContactPhone: '12' })).status).toBe(422);
    expect((await bad({ gender: 'MALE' })).status).toBe(422);
    expect((await bad({ gender: undefined })).body.error.details[0].message).toMatch(/Tell us your gender/);
    expect((await bad({ role: 'ADMIN' })).status).toBe(422); // unknown fields are rejected
    expect((await bad({ gender: 'FEMALE' })).status).toBe(201);
  });

  it('refuses when no bed is free, or a request is already open, or too many are open', async () => {
    const full = await makeStay({ units: 1 });
    const a = await student();
    const b = await student();
    const first = await api.apply(a.token, full.hostel.id, applyBody(full.room.id));
    await api.approve(full.owner.token, first.body.data.id);
    expect((await api.apply(b.token, full.hostel.id, applyBody(full.room.id))).body.error.message).toMatch(/No beds are free/);

    const open = await makeStay();
    expect((await api.apply(b.token, open.hostel.id, applyBody(open.room.id))).status).toBe(201);
    expect((await api.apply(b.token, open.hostel.id, applyBody(open.room.id))).status).toBe(409); // already open here

    const c = await student();
    for (let i = 0; i < 3; i++) { const s = await makeStay(); expect((await api.apply(c.token, s.hostel.id, applyBody(s.room.id))).status).toBe(201); }
    const fourth = await makeStay();
    expect((await api.apply(c.token, fourth.hostel.id, applyBody(fourth.room.id))).body.error.message).toMatch(/at most 3 open requests/);
  });

  it('refuses someone who already has a stay', async () => {
    const stay = await makeStay();
    const { tenant } = await approvedTenant(stay);
    const other = await makeStay();
    expect((await api.apply(tenant.token, other.hostel.id, applyBody(other.room.id))).body.error.message).toMatch(/already have a stay/);
  });
});

describe('my requests', () => {
  it('lists only mine and lets me withdraw an open one', async () => {
    const stay = await makeStay();
    const me = await student();
    const you = await student();
    const mine = await api.apply(me.token, stay.hostel.id, applyBody(stay.room.id));
    await api.apply(you.token, stay.hostel.id, applyBody(stay.room.id));
    expect((await api.myApps(me.token)).body.data).toHaveLength(1);
    expect((await api.withdraw(you.token, mine.body.data.id)).status).toBe(404); // someone else's looks missing
    const w = await api.withdraw(me.token, mine.body.data.id);
    expect(w.body.data).toMatchObject({ status: 'WITHDRAWN', actions: [] });
    expect((await api.withdraw(me.token, mine.body.data.id)).status).toBe(409);
    expect((await api.apply(me.token, stay.hostel.id, applyBody(stay.room.id))).status).toBe(201); // can apply again
  });
});

describe('the owner decides', () => {
  it('sees only requests for their own properties', async () => {
    const a = await makeStay();
    const b = await makeStay();
    const s = await student();
    const req = await api.apply(s.token, a.hostel.id, applyBody(a.room.id));
    expect((await api.ownerApps(a.owner.token)).body.data.map((x: { id: string }) => x.id)).toEqual([req.body.data.id]);
    expect((await api.ownerApps(b.owner.token)).body.data).toEqual([]);
    expect((await api.ownerApp(b.owner.token, req.body.data.id)).status).toBe(404);
    expect((await api.approve(b.owner.token, req.body.data.id)).status).toBe(404);
    expect((await api.ownerApps(s.token)).status).toBe(403);
  });

  it('approves: reserves a bed, copies the terms, and tells the student', async () => {
    const stay = await makeStay();
    const s = await student();
    const req = await api.apply(s.token, stay.hostel.id, applyBody(stay.room.id));
    const res = await api.approve(stay.owner.token, req.body.data.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'APPROVED', actions: [] });
    const t = (await api.myTenancies(s.token)).body.data[0];
    expect(t).toMatchObject({ status: 'PENDING_MOVE_IN', rentPaise: 600000, depositPaise: 1200000, dueDay: 1, graceDays: 5, noticeDays: 30, unit: { label: 'B-1' }, actions: ['decline', 'pay_deposit'] }); // the tenant may also pay the deposit online
    expect(t.deposit.status).toBe('DUE');
    expect(await prisma.notification.count({ where: { userId: s.id, type: 'TENANCY_APPROVED' } })).toBe(1);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: { in: [req.body.data.id, t.id] } }, orderBy: { id: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['tenancy.application.create', 'tenancy.application.approve', 'tenancy.create']));
  });

  it('lets the owner pick the bed and override rent and deposit', async () => {
    const stay = await makeStay();
    const s = await student();
    const req = await api.apply(s.token, stay.hostel.id, applyBody(stay.room.id));
    const units = await prisma.roomUnit.findMany({ where: { roomTypeId: stay.room.id }, orderBy: { label: 'asc' } });
    await api.approve(stay.owner.token, req.body.data.id, { unitId: units[2]!.id, rentPaise: 550000, depositPaise: 0, startDate: addDays(TODAY, 20) });
    const t = (await api.myTenancies(s.token)).body.data[0];
    expect(t).toMatchObject({ rentPaise: 550000, depositPaise: 0, startDate: addDays(TODAY, 20), unit: { label: 'B-3' }, deposit: { status: 'NONE' } });
  });

  it('cannot approve the same request twice, into a taken bed, or with a past start', async () => {
    const stay = await makeStay({ units: 1 });
    const a = await student();
    const b = await student();
    const ra = await api.apply(a.token, stay.hostel.id, applyBody(stay.room.id));
    const rb = await api.apply(b.token, stay.hostel.id, applyBody(stay.room.id));
    expect((await api.approve(stay.owner.token, ra.body.data.id, { startDate: addDays(TODAY, -1) })).status).toBe(422);
    expect((await api.approve(stay.owner.token, ra.body.data.id)).status).toBe(200);
    expect((await api.approve(stay.owner.token, ra.body.data.id)).status).toBe(409);
    const last = await api.approve(stay.owner.token, rb.body.data.id);
    expect(last.status).toBe(409);
    expect(last.body.error.message).toMatch(/No beds are free/);
  });

  it('two approvals racing for the last bed: exactly one wins', async () => {
    const stay = await makeStay({ units: 1 });
    const students = await Promise.all([student(), student(), student()]);
    const reqs = await Promise.all(students.map(async (s) => (await api.apply(s.token, stay.hostel.id, applyBody(stay.room.id))).body.data.id as string));
    const results = await Promise.all(reqs.map((id) => api.approve(stay.owner.token, id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await prisma.tenancy.count({ where: { hostelId: stay.hostel.id } })).toBe(1);
  });

  it('rejects with a reason the student can read', async () => {
    const stay = await makeStay();
    const s = await student();
    const req = await api.apply(s.token, stay.hostel.id, applyBody(stay.room.id));
    expect((await api.reject(stay.owner.token, req.body.data.id, { reason: 'x' })).status).toBe(422);
    const res = await api.reject(stay.owner.token, req.body.data.id, { reason: 'We only take final-year students' });
    expect(res.body.data).toMatchObject({ status: 'REJECTED', decisionNote: 'We only take final-year students' });
    expect(await prisma.notification.count({ where: { userId: s.id, type: 'TENANCY_REJECTED' } })).toBe(1);
    expect((await api.reject(stay.owner.token, req.body.data.id)).status).toBe(409);
  });

  it('offers the owner only the beds nobody holds, and approval honours the chosen one', async () => {
    const stay = await makeStay({ units: 3 });
    const { call } = await import('../helpers/http');
    const { GET: freeRoute } = await import('@/app/api/v1/owner/room-types/[id]/free-units/route');
    const free = () => call(freeRoute, { method: 'GET', token: stay.owner.token, params: { id: stay.room.id } });
    expect((await free()).body.data.map((u: { label: string }) => u.label)).toEqual(['B-1', 'B-2', 'B-3']);

    const s = await student();
    const req = await api.apply(s.token, stay.hostel.id, applyBody(stay.room.id));
    const units = (await free()).body.data as { id: string; label: string }[];
    await api.approve(stay.owner.token, req.body.data.id, { unitId: units[1]!.id });
    expect((await free()).body.data.map((u: { label: string }) => u.label)).toEqual(['B-1', 'B-3']); // B-2 is taken now
    expect((await api.myTenancies(s.token)).body.data[0].unit.label).toBe('B-2');

    const other = await makeStay();
    expect((await call(freeRoute, { method: 'GET', token: other.owner.token, params: { id: stay.room.id } })).status).toBe(404);
    expect((await call(freeRoute, { method: 'GET', token: s.token, params: { id: stay.room.id } })).status).toBe(403);
  });

  it('skips a bed under maintenance and one already held', async () => {
    const stay = await makeStay({ units: 2 });
    await prisma.roomUnit.updateMany({ where: { roomTypeId: stay.room.id, label: 'B-1' }, data: { status: 'MAINTENANCE' } });
    const { tenancyId } = await approvedTenant(stay);
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId }, include: { unit: true } })).unit.label).toBe('B-2');
    expect((await api.terms(stay.hostel.id)).body.data.rooms[0].freeUnits).toBe(0);
  });
});

describe('guests cannot reach owner tools', () => {
  it('is 403 for a guest and 401 without a token', async () => {
    const g = await makeUser({ roles: ['GUEST'] });
    expect((await api.ownerTenancies(g.token)).status).toBe(403);
    expect((await api.ownerTenancies('')).status).toBe(401);
  });
});
