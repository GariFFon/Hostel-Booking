import { describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { GET as listUnits, POST as addUnits } from '@/app/api/v1/owner/room-types/[id]/units/route';
import { PATCH as patchUnit, DELETE as deleteUnit } from '@/app/api/v1/owner/units/[id]/route';
import { call } from '../helpers/http';
import { makeHostel, makeRoom } from '../helpers/listings';
import { makeGuest } from '../helpers/booking';
import { makeUser } from '../helpers/users';

async function setup(totalUnits = 4) {
  const owner = await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' });
  const hostel = await makeHostel(owner.token, { propertyType: 'PG', name: 'Campus PG' });
  const room = await makeRoom(owner.token, hostel.id, { totalUnits, basePricePaise: 600000, priceUnit: 'MONTH' });
  return { owner, hostel, room };
}
const add = (token: string, roomTypeId: string, body: unknown) => call(addUnits, { token, params: { id: roomTypeId }, body });

describe('units of a long-term room type', () => {
  it('adds, lists, edits and removes units, auditing each change against the hostel', async () => {
    const { owner, hostel, room } = await setup();
    const created = await add(owner.token, room.id, { labels: ['204-B1', '204-B2'], floor: 2 });
    expect(created.status).toBe(201);
    expect(created.body.data.map((u: { label: string }) => u.label)).toEqual(['204-B1', '204-B2']);

    const list = await call(listUnits, { method: 'GET', token: owner.token, params: { id: room.id } });
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0]).toMatchObject({ floor: 2, status: 'ACTIVE' });

    const unitId = created.body.data[0].id as string;
    const patched = await call(patchUnit, { method: 'PATCH', token: owner.token, params: { id: unitId }, body: { status: 'MAINTENANCE', notes: 'Leaking tap' } });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ status: 'MAINTENANCE', notes: 'Leaking tap' });

    expect((await call(deleteUnit, { method: 'DELETE', token: owner.token, params: { id: unitId } })).status).toBe(200);
    expect((await call(listUnits, { method: 'GET', token: owner.token, params: { id: room.id } })).body.data).toHaveLength(1);

    const audit = await prisma.auditLog.findMany({ where: { action: { startsWith: 'unit.' }, entityId: { in: [room.id, unitId] } }, orderBy: { id: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['unit.create', 'unit.update', 'unit.delete']);
    for (const a of audit) expect(a.metadata).toMatchObject({ hostelId: hostel.id }); // lets an owner-scoped audit view filter by property
  });

  it('never lists more live units than the room type holds', async () => {
    const { owner, room } = await setup(2);
    expect((await add(owner.token, room.id, { labels: ['A', 'B'] })).status).toBe(201);
    const over = await add(owner.token, room.id, { labels: ['C'] });
    expect(over.status).toBe(409);
    expect(over.body.error.message).toMatch(/Raise its total units/);
  });

  it('retiring a unit frees capacity; bringing it back is capacity-checked', async () => {
    const { owner, room } = await setup(1);
    const [a] = (await add(owner.token, room.id, { labels: ['A'] })).body.data;
    await call(patchUnit, { method: 'PATCH', token: owner.token, params: { id: a.id }, body: { status: 'RETIRED' } });
    const [b] = (await add(owner.token, room.id, { labels: ['B'] })).body.data;
    expect(b.label).toBe('B');
    const back = await call(patchUnit, { method: 'PATCH', token: owner.token, params: { id: a.id }, body: { status: 'ACTIVE' } });
    expect(back.status).toBe(409);
  });

  it('labels are unique per room type, ignoring case, and reusable after removal', async () => {
    const { owner, room } = await setup();
    const [a] = (await add(owner.token, room.id, { labels: ['b1'] })).body.data;
    expect((await add(owner.token, room.id, { labels: ['B1'] })).status).toBe(409);
    expect((await add(owner.token, room.id, { labels: ['x', 'X'] })).status).toBe(422); // duplicates inside one request
    await call(deleteUnit, { method: 'DELETE', token: owner.token, params: { id: a.id } });
    expect((await add(owner.token, room.id, { labels: ['B1'] })).status).toBe(201);
  });

  it('hotels are booked by room type and have no units', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' });
    const hotel = await makeHostel(owner.token, { propertyType: 'HOTEL' });
    const room = await makeRoom(owner.token, hotel.id);
    const res = await add(owner.token, room.id, { labels: ['101'] });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/only tracked for hostels and PGs/);
  });

  it("another owner's room type and unit look like they do not exist; a guest gets 403", async () => {
    const { owner, room } = await setup();
    const [unit] = (await add(owner.token, room.id, { labels: ['A'] })).body.data;
    const other = await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' });
    expect((await add(other.token, room.id, { labels: ['Z'] })).status).toBe(404);
    expect((await call(listUnits, { method: 'GET', token: other.token, params: { id: room.id } })).status).toBe(404);
    expect((await call(patchUnit, { method: 'PATCH', token: other.token, params: { id: unit.id }, body: { notes: 'x' } })).status).toBe(404);
    expect((await call(deleteUnit, { method: 'DELETE', token: other.token, params: { id: unit.id } })).status).toBe(404);
    const guest = await makeGuest();
    expect((await call(listUnits, { method: 'GET', token: guest.token, params: { id: room.id } })).status).toBe(403);
  });

  it('rejects empty and unknown fields', async () => {
    const { owner, room } = await setup();
    expect((await add(owner.token, room.id, { labels: [] })).status).toBe(422);
    expect((await add(owner.token, room.id, { labels: ['A'], role: 'ADMIN' })).status).toBe(422);
    const [unit] = (await add(owner.token, room.id, { labels: ['A'] })).body.data;
    expect((await call(patchUnit, { method: 'PATCH', token: owner.token, params: { id: unit.id }, body: {} })).status).toBe(422);
  });
});
