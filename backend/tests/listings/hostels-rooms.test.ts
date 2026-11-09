import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '@/core/dates';
import { cloudinaryStorage, setMediaStorage } from '@/infra/cloudinary/storage';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { GET as listHostels, POST as createHostel } from '@/app/api/v1/owner/hostels/route';
import { GET as getHostel, PATCH as patchHostel, DELETE as deleteHostel } from '@/app/api/v1/owner/hostels/[id]/route';
import { POST as submitHostel } from '@/app/api/v1/owner/hostels/[id]/submit/route';
import { GET as listRooms, POST as createRoom } from '@/app/api/v1/owner/hostels/[id]/room-types/route';
import { GET as getRoom, PATCH as patchRoom, DELETE as deleteRoom } from '@/app/api/v1/owner/room-types/[id]/route';
import { GET as calendar } from '@/app/api/v1/owner/room-types/[id]/calendar/route';
import { PUT as putBlocks } from '@/app/api/v1/owner/room-types/[id]/blocks/route';
import { GET as listRules, POST as createRule } from '@/app/api/v1/owner/room-types/[id]/price-rules/route';
import { PATCH as patchRule, DELETE as deleteRule } from '@/app/api/v1/owner/price-rules/[id]/route';
import { POST as createAmenity } from '@/app/api/v1/admin/amenities/route';
import { call } from '../helpers/http';
import { FakeStorage } from '../helpers/fake-storage';
import { hostelPayload, makeHostel, makeRoom, roomPayload } from '../helpers/listings';
import { makeUser } from '../helpers/users';

const storage = new FakeStorage();
const owner = async () => makeUser({ roles: ['OWNER', 'GUEST'] });
const TODAY = todayIn('Asia/Kolkata');
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

beforeAll(async () => {
  setMediaStorage(storage);
  await redis.flushdb();
});
afterAll(() => setMediaStorage(cloudinaryStorage));

/** A minimal booking so "live booking" guards can be exercised before the booking module exists. */
async function liveBooking(hostelId: string, roomTypeId: string, guestId: string, status: 'CONFIRMED' | 'COMPLETED' = 'CONFIRMED') {
  return prisma.booking.create({
    data: {
      code: `HB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, guestId, hostelId, status, checkIn: D(addDays(TODAY, 3)), checkOut: D(addDays(TODAY, 5)), nights: 2,
      guestsCount: 1, subtotalPaise: 1000, taxPaise: 50, gstRateBps: 500, totalPaise: 1050, commissionBps: 1000, cancellationPolicy: 'MODERATE', bookingMode: 'INSTANT',
      items: { create: [{ roomTypeId, units: 1, lineTotalPaise: 1000, roomNameSnapshot: 'x', nightlyBreakdown: [] }] },
    },
  });
}

describe('creating hostels', () => {
  it('requires the OWNER role and a verified email', async () => {
    const guest = await makeUser();
    const unverified = await makeUser({ roles: ['OWNER', 'GUEST'], verified: false });
    expect((await call(createHostel, { token: guest.token, body: hostelPayload() })).status).toBe(403);
    const r = await call(createHostel, { token: unverified.token, body: hostelPayload() });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/verify your email/i);
  });

  it('validates input with field-level errors', async () => {
    const o = await owner();
    const res = await call(createHostel, { token: o.token, body: hostelPayload({ postalCode: '12', latitude: 123, name: 'x', amenityCodes: ['NOPE_AMENITY'] }) });
    expect(res.status).toBe(422);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['postalCode', 'latitude', 'name']));
    const unknown = await call(createHostel, { token: o.token, body: hostelPayload({ amenityCodes: ['NOPE_AMENITY'] }) });
    expect(unknown.body.error.details[0].message).toMatch(/Unknown amenities/);
  });

  it('creates a DRAFT with a unique slug, INR currency and audit trail', async () => {
    const o = await owner();
    const name = `Unique Slug ${Math.random().toString(36).slice(2, 8)}`; // the test DB persists between runs
    const a = await makeHostel(o.token, { name });
    const b = await makeHostel(o.token, { name });
    expect(a.slug).toBe(`${name.toLowerCase().replace(/ /g, '-')}-goa`);
    expect(b.slug).not.toBe(a.slug);
    const full = (await call(getHostel, { method: 'GET', token: o.token, params: { id: a.id } })).body.data;
    expect(full).toMatchObject({ status: 'DRAFT', currency: 'INR', bookingMode: 'INSTANT', timezone: 'Asia/Kolkata', ownerId: o.id });
    expect(await prisma.auditLog.count({ where: { action: 'hostel.create', entityId: a.id } })).toBe(1);
  });

  it('attaches amenities by code', async () => {
    const admin = await makeUser({ roles: ['ADMIN'] });
    const code = `TESTAM_${Date.now()}`;
    expect((await call(createAmenity, { token: admin.token, body: { code, label: 'Test amenity', category: 'COMFORT' } })).status).toBe(201);
    const o = await owner();
    const h = await call(createHostel, { token: o.token, body: hostelPayload({ amenityCodes: [code] }) });
    expect(h.body.data.amenities).toEqual([expect.objectContaining({ code, label: 'Test amenity' })]);
  });
});

describe('reading, listing and ownership', () => {
  it('scopes lists to the owner, paginates with cursors, and hides foreign/malformed ids as 404', async () => {
    const o = await owner();
    const other = await owner();
    const ids = [] as string[];
    for (let i = 0; i < 3; i++) ids.push((await makeHostel(o.token, { name: `Paged hostel ${i}` })).id);
    const p1 = await call(listHostels, { method: 'GET', token: o.token, query: '?limit=2' });
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.meta.nextCursor).toBeTruthy();
    const p2 = await call(listHostels, { method: 'GET', token: o.token, query: `?limit=2&cursor=${p1.body.meta.nextCursor}` });
    expect(p2.body.data).toHaveLength(1);
    expect(p2.body.meta.nextCursor).toBeNull();
    expect([...p1.body.data, ...p2.body.data].map((h: { id: string }) => h.id).sort()).toEqual([...ids].sort());
    expect((await call(listHostels, { method: 'GET', token: other.token })).body.data).toHaveLength(0);
    expect((await call(getHostel, { method: 'GET', token: other.token, params: { id: ids[0]! } })).status).toBe(404);
    expect((await call(getHostel, { method: 'GET', token: o.token, params: { id: 'not-a-uuid' } })).status).toBe(404);
    expect((await call(listHostels, { method: 'GET', token: o.token, query: '?status=BOGUS' })).status).toBe(422);
  });
});

describe('updating hostels', () => {
  it('audits only what changed, bumps the version and supports optimistic locking', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const upd = await call(patchHostel, { method: 'PATCH', token: o.token, params: { id: h.id }, body: { city: 'Panaji', checkInTime: '15:30', expectedVersion: h.version } });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ version: h.version + 1, address: expect.objectContaining({ city: 'Panaji' }), checkInTime: '15:30' });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'hostel.update', entityId: h.id } });
    expect(audit?.before).toEqual({ city: 'Goa', checkInTime: '14:00' });
    expect(audit?.after).toEqual({ city: 'Panaji', checkInTime: '15:30' });

    const stale = await call(patchHostel, { method: 'PATCH', token: o.token, params: { id: h.id }, body: { name: 'Stale write', expectedVersion: h.version } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentVersion).toBe(h.version + 1);
  });

  it('rejects empty and unknown-field updates, and blocks edits while under review', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    expect((await call(patchHostel, { method: 'PATCH', token: o.token, params: { id: h.id }, body: {} })).status).toBe(422);
    expect((await call(patchHostel, { method: 'PATCH', token: o.token, params: { id: h.id }, body: { status: 'APPROVED' } })).status).toBe(422); // cannot self-approve
    expect((await call(patchHostel, { method: 'PATCH', token: o.token, params: { id: h.id }, body: { ownerId: 'x' } })).status).toBe(422);
    await prisma.hostel.update({ where: { id: h.id }, data: { status: 'PENDING_REVIEW' } });
    expect((await call(patchHostel, { method: 'PATCH', token: o.token, params: { id: h.id }, body: { name: 'Sneaky edit' } })).status).toBe(409);
  });

  it('reports exactly what is missing before submission', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const res = await call(submitHostel, { token: o.token, params: { id: h.id } });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['kyc', 'media', 'roomTypes']);
  });
});

describe('partial updates never reset omitted fields (zod defaults must not leak into PATCH)', () => {
  it('hostel', async () => {
    const o = await owner();
    const h = await makeHostel(o.token, { bookingMode: 'APPROVAL', cancellationPolicy: 'STRICT', genderPolicy: 'FEMALE_ONLY', checkInTime: '16:00', country: 'IN' });
    const after = (await call(patchHostel, { method: 'PATCH', token: o.token, params: { id: h.id }, body: { name: 'Only the name changes' } })).body.data;
    expect(after).toMatchObject({ name: 'Only the name changes', bookingMode: 'APPROVAL', cancellationPolicy: 'STRICT', genderPolicy: 'FEMALE_ONLY', checkInTime: '16:00' });
  });

  it('room type', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const room = await makeRoom(o.token, h.id, { gender: 'FEMALE', minStayNights: 2, maxStayNights: 14 });
    const after = (await call(patchRoom, { method: 'PATCH', token: o.token, params: { id: room.id }, body: { name: 'Renamed dorm' } })).body.data;
    expect(after).toMatchObject({ name: 'Renamed dorm', gender: 'FEMALE', minStayNights: 2, maxStayNights: 14, isActive: true, priceUnit: 'NIGHT' });
  });

  it('price rule', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const room = await makeRoom(o.token, h.id);
    const rule = await call(createRule, { token: o.token, params: { id: room.id }, body: { type: 'WEEKEND', weekdays: [5, 6], adjustmentBps: 1000, priority: 7, isActive: false } });
    const after = (await call(patchRule, { method: 'PATCH', token: o.token, params: { id: rule.body.data.id }, body: { name: 'Renamed' } })).body.data;
    expect(after).toMatchObject({ weekdays: [5, 6], priority: 7, isActive: false, adjustmentBps: 1000 });
  });
});

describe('deleting hostels', () => {
  it('soft-deletes, frees the owner view, and is blocked by live bookings', async () => {
    const o = await owner();
    const guest = await makeUser();
    const blocked = await makeHostel(o.token);
    const room = await makeRoom(o.token, blocked.id);
    await liveBooking(blocked.id, room.id, guest.id);
    expect((await call(deleteHostel, { method: 'DELETE', token: o.token, params: { id: blocked.id } })).status).toBe(409);

    const free = await makeHostel(o.token);
    expect((await call(deleteHostel, { method: 'DELETE', token: o.token, params: { id: free.id } })).status).toBe(200);
    expect((await call(getHostel, { method: 'GET', token: o.token, params: { id: free.id } })).status).toBe(404);
    expect(await prisma.hostel.findUnique({ where: { id: free.id } })).toMatchObject({ deletedAt: expect.any(Date) }); // row kept for history
  });
});

describe('room types and inventory', () => {
  it('enforces shape rules between kind, occupancy, gender and pricing unit', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const bad = (over: object) => call(createRoom, { token: o.token, params: { id: h.id }, body: roomPayload(over) });
    expect((await bad({ kind: 'DORM', maxOccupancyPerUnit: 2 })).status).toBe(422);
    expect((await bad({ kind: 'PRIVATE', gender: 'FEMALE' })).status).toBe(422);
    expect((await bad({ minStayNights: 5, maxStayNights: 2 })).status).toBe(422);
    expect((await bad({ priceUnit: 'MONTH' })).status).toBe(422); // monthly = PG only
    expect((await bad({ basePricePaise: 5 })).status).toBe(422);
    const pg = await makeHostel(o.token, { propertyType: 'PG', name: 'PG Place' });
    expect((await call(createRoom, { token: o.token, params: { id: pg.id }, body: roomPayload({ priceUnit: 'MONTH', basePricePaise: 600000 }) })).status).toBe(201);
  });

  it('opens a year of inventory, tracks the "from" price, and kind is immutable', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const dorm = await makeRoom(o.token, h.id, { totalUnits: 6, basePricePaise: 80000 });
    expect(await prisma.inventoryNight.count({ where: { roomTypeId: dorm.id } })).toBe(365);
    expect((await prisma.hostel.findUniqueOrThrow({ where: { id: h.id } })).minPricePaise).toBe(80000);

    const priv = await makeRoom(o.token, h.id, { name: 'Private', kind: 'PRIVATE', totalUnits: 2, maxOccupancyPerUnit: 2, basePricePaise: 50000 });
    expect((await prisma.hostel.findUniqueOrThrow({ where: { id: h.id } })).minPricePaise).toBe(50000);
    await call(patchRoom, { method: 'PATCH', token: o.token, params: { id: priv.id }, body: { isActive: false } });
    expect((await prisma.hostel.findUniqueOrThrow({ where: { id: h.id } })).minPricePaise).toBe(80000);

    expect((await call(patchRoom, { method: 'PATCH', token: o.token, params: { id: dorm.id }, body: { kind: 'PRIVATE' } })).status).toBe(422);
    expect((await call(listRooms, { method: 'GET', token: o.token, params: { id: h.id } })).body.data).toHaveLength(2);
  });

  it('resizes capacity, but never below what is already booked, held or blocked', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const room = await makeRoom(o.token, h.id, { totalUnits: 6 });
    const night = D(addDays(TODAY, 10));
    await prisma.inventoryNight.update({ where: { roomTypeId_date: { roomTypeId: room.id, date: night } }, data: { bookedUnits: 3, heldUnits: 1 } });

    const tooSmall = await call(patchRoom, { method: 'PATCH', token: o.token, params: { id: room.id }, body: { totalUnits: 3 } });
    expect(tooSmall.status).toBe(409);
    expect(tooSmall.body.error.details.committed).toBe(4);

    expect((await call(patchRoom, { method: 'PATCH', token: o.token, params: { id: room.id }, body: { totalUnits: 4 } })).status).toBe(200);
    expect((await prisma.inventoryNight.findUniqueOrThrow({ where: { roomTypeId_date: { roomTypeId: room.id, date: D(addDays(TODAY, 20)) } } })).totalUnits).toBe(4);
    expect((await call(patchRoom, { method: 'PATCH', token: o.token, params: { id: room.id }, body: { totalUnits: 9 } })).status).toBe(200);
    expect((await prisma.inventoryNight.findUniqueOrThrow({ where: { roomTypeId_date: { roomTypeId: room.id, date: night } } })).totalUnits).toBe(9);
  });

  it('supports optimistic locking on rooms', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const room = await makeRoom(o.token, h.id);
    expect((await call(patchRoom, { method: 'PATCH', token: o.token, params: { id: room.id }, body: { name: 'Renamed', expectedVersion: room.version } })).status).toBe(200);
    expect((await call(patchRoom, { method: 'PATCH', token: o.token, params: { id: room.id }, body: { name: 'Again', expectedVersion: room.version } })).status).toBe(409);
  });

  it('cannot delete rooms with live bookings or the last active room of a published listing', async () => {
    const o = await owner();
    const guest = await makeUser();
    const h = await makeHostel(o.token);
    const booked = await makeRoom(o.token, h.id);
    const spare = await makeRoom(o.token, h.id, { name: 'Spare' });
    await liveBooking(h.id, booked.id, guest.id);
    expect((await call(deleteRoom, { method: 'DELETE', token: o.token, params: { id: booked.id } })).status).toBe(409);

    await prisma.hostel.update({ where: { id: h.id }, data: { status: 'APPROVED' } });
    expect((await call(deleteRoom, { method: 'DELETE', token: o.token, params: { id: spare.id } })).status).toBe(200); // booked room remains active
    const last = await call(patchRoom, { method: 'PATCH', token: o.token, params: { id: booked.id }, body: { isActive: false } });
    expect(last.status).toBe(409);
    expect(last.body.error.message).toMatch(/at least one active room/);
    expect((await call(getRoom, { method: 'GET', token: o.token, params: { id: spare.id } })).status).toBe(404);
  });
});

describe('calendar blocks', () => {
  it('blocks units for a date range and the calendar reflects it', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const room = await makeRoom(o.token, h.id, { totalUnits: 6 });
    const from = addDays(TODAY, 5), to = addDays(TODAY, 7);
    const res = await call(putBlocks, { method: 'PUT', token: o.token, params: { id: room.id }, body: { from, to, units: 2, reason: 'Maintenance' } });
    expect(res.body.data.nights).toBe(3);
    const cal = (await call(calendar, { method: 'GET', token: o.token, params: { id: room.id }, query: `?from=${addDays(TODAY, 4)}&to=${addDays(TODAY, 8)}` })).body.data;
    expect(cal.map((n: { blocked: number }) => n.blocked)).toEqual([0, 2, 2, 2, 0]);
    expect(cal[1]).toMatchObject({ total: 6, available: 4 });
    expect(await prisma.blockedDate.count({ where: { roomTypeId: room.id } })).toBe(3);

    await call(putBlocks, { method: 'PUT', token: o.token, params: { id: room.id }, body: { from, to, units: 0 } }); // unblock
    expect(await prisma.blockedDate.count({ where: { roomTypeId: room.id } })).toBe(0);
    expect((await prisma.inventoryNight.findMany({ where: { roomTypeId: room.id }, select: { blockedUnits: true } })).every((r) => r.blockedUnits === 0)).toBe(true);
  });

  it('cannot block units that guests already booked, and names the nights', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const room = await makeRoom(o.token, h.id, { totalUnits: 6 });
    const busy = addDays(TODAY, 12);
    await prisma.inventoryNight.update({ where: { roomTypeId_date: { roomTypeId: room.id, date: D(busy) } }, data: { bookedUnits: 5 } });
    const res = await call(putBlocks, { method: 'PUT', token: o.token, params: { id: room.id }, body: { from: addDays(TODAY, 11), to: addDays(TODAY, 13), units: 2 } });
    expect(res.status).toBe(409);
    expect(res.body.error.details.nights).toEqual([busy]);
    // all-or-nothing: the free nights were not blocked either
    expect((await prisma.inventoryNight.aggregate({ where: { roomTypeId: room.id }, _sum: { blockedUnits: true } }))._sum.blockedUnits).toBe(0);
  });

  it('validates ranges: past nights, inverted ranges, more units than exist', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const room = await makeRoom(o.token, h.id, { totalUnits: 3 });
    const put = (body: object) => call(putBlocks, { method: 'PUT', token: o.token, params: { id: room.id }, body });
    expect((await put({ from: addDays(TODAY, -2), to: addDays(TODAY, 1), units: 1 })).status).toBe(422);
    expect((await put({ from: addDays(TODAY, 5), to: addDays(TODAY, 2), units: 1 })).status).toBe(422);
    expect((await put({ from: addDays(TODAY, 2), to: addDays(TODAY, 3), units: 4 })).status).toBe(422);
    expect((await put({ from: '2026-13-45', to: addDays(TODAY, 3), units: 1 })).status).toBe(422);
  });

  it('keeps the database invariant even if a block races a hold', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const room = await makeRoom(o.token, h.id, { totalUnits: 2 });
    const date = D(addDays(TODAY, 6));
    await expect(prisma.inventoryNight.update({ where: { roomTypeId_date: { roomTypeId: room.id, date } }, data: { heldUnits: 1, bookedUnits: 1, blockedUnits: 1 } })).rejects.toThrow(/inventory_capacity|check constraint/i);
  });
});

describe('price rules', () => {
  it('creates, lists, updates and deletes weekend and date-range rules', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const room = await makeRoom(o.token, h.id);
    const weekend = await call(createRule, { token: o.token, params: { id: room.id }, body: { type: 'WEEKEND', weekdays: [5, 6], adjustmentBps: 2000, name: 'Weekend uplift', priority: 1 } });
    expect(weekend.status).toBe(201);
    const season = await call(createRule, { token: o.token, params: { id: room.id }, body: { type: 'DATE_RANGE', startDate: '2026-12-20', endDate: '2027-01-05', pricePaise: 150000, priority: 5, name: 'Peak season' } });
    expect(season.body.data).toMatchObject({ startDate: '2026-12-20', endDate: '2027-01-05', pricePaise: 150000, adjustmentBps: null });
    expect((await call(listRules, { method: 'GET', token: o.token, params: { id: room.id } })).body.data.map((r: { priority: number }) => r.priority)).toEqual([5, 1]); // highest priority first

    const upd = await call(patchRule, { method: 'PATCH', token: o.token, params: { id: weekend.body.data.id }, body: { adjustmentBps: 2500 } });
    expect(upd.body.data.adjustmentBps).toBe(2500);
    expect((await call(deleteRule, { method: 'DELETE', token: o.token, params: { id: season.body.data.id } })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityId: room.id, action: { startsWith: 'price_rule.' } } })).toBe(4);
  });

  it('rejects inconsistent rules, including after a partial update', async () => {
    const o = await owner();
    const h = await makeHostel(o.token);
    const room = await makeRoom(o.token, h.id);
    const make = (body: object) => call(createRule, { token: o.token, params: { id: room.id }, body });
    expect((await make({ type: 'WEEKEND', adjustmentBps: 1000 })).status).toBe(422); // no weekdays
    expect((await make({ type: 'WEEKEND', weekdays: [6], pricePaise: 90000, adjustmentBps: 1000 })).status).toBe(422); // both values
    expect((await make({ type: 'WEEKEND', weekdays: [6] })).status).toBe(422); // neither
    expect((await make({ type: 'WEEKEND', weekdays: [7], adjustmentBps: 1000 })).status).toBe(422);
    expect((await make({ type: 'DATE_RANGE', startDate: '2026-12-31', endDate: '2026-12-01', pricePaise: 90000 })).status).toBe(422);
    expect((await make({ type: 'DATE_RANGE', pricePaise: 90000 })).status).toBe(422); // no dates
    const ok = await make({ type: 'WEEKEND', weekdays: [6], adjustmentBps: 1000 });
    expect((await call(patchRule, { method: 'PATCH', token: o.token, params: { id: ok.body.data.id }, body: { adjustmentBps: null } })).status).toBe(422); // would leave no value
  });

  it('hides other owners\' rules and rooms', async () => {
    const o = await owner();
    const other = await owner();
    const h = await makeHostel(o.token);
    const room = await makeRoom(o.token, h.id);
    const rule = await call(createRule, { token: o.token, params: { id: room.id }, body: { type: 'WEEKEND', weekdays: [6], adjustmentBps: 1000 } });
    expect((await call(listRules, { method: 'GET', token: other.token, params: { id: room.id } })).status).toBe(404);
    expect((await call(patchRule, { method: 'PATCH', token: other.token, params: { id: rule.body.data.id }, body: { priority: 9 } })).status).toBe(404);
    expect((await call(createRule, { token: other.token, params: { id: room.id }, body: { type: 'WEEKEND', weekdays: [6], adjustmentBps: 1000 } })).status).toBe(404);
  });
});
