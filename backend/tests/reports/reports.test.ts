import { describe, expect, it } from 'vitest';
import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { makeUser } from '../helpers/users';
import { api, approvedTenant, makeStay } from '../helpers/tenancy';
import { TODAY, activeTenant, rentApi } from '../helpers/rent';
import { mo, noticeDay } from '../helpers/moveout';
import { publish } from '../helpers/publish';

describe('the occupancy report', () => {
  it('counts beds by state, per property and room, and lists who leaves next', async () => {
    const stay = await makeStay({ units: 5 });
    const live = await activeTenant({ stay });
    const onNotice = await activeTenant({ stay });
    await mo.notice(onNotice.tenant.token, onNotice.tenancyId, { moveOutDate: noticeDay(40) });
    await approvedTenant(stay, { depositPaise: 0 }); // reserved, not moved in
    const unit = await prisma.roomUnit.findFirstOrThrow({ where: { roomTypeId: stay.room.id, tenancies: { none: { status: { in: ['ACTIVE', 'NOTICE', 'INVITED', 'PENDING_MOVE_IN'] } } } } });
    await prisma.roomUnit.update({ where: { id: unit.id }, data: { status: 'MAINTENANCE' } });

    const res = await mo.occupancy(stay.owner.token);
    expect(res.status).toBe(200);
    const h = res.body.data.byHostel[0];
    expect(h).toMatchObject({ hostelId: stay.hostel.id, units: 5, occupied: 1, onNotice: 1, reserved: 1, maintenance: 1, vacant: 1, occupancyPct: 50 }); // (1 + 1) of the 4 beds in service
    expect(h.byRoom).toEqual([expect.objectContaining({ roomTypeId: stay.room.id, units: 5, occupied: 1, onNotice: 1, reserved: 1, maintenance: 1, vacant: 1 })]);
    expect(res.body.data.totals).toMatchObject({ units: 5, occupied: 1, onNotice: 1, reserved: 1, maintenance: 1, vacant: 1, occupancyPct: 50 });
    expect(res.body.data.vacatingSoon).toEqual([expect.objectContaining({ tenancyId: onNotice.tenancyId, moveOutDate: noticeDay(40), daysLeft: 40, hostel: stay.hostel.name })]);
    expect(res.body.data.asOf).toBe(TODAY);
    void live;
  });

  it('frees a bed when the stay ends, ignores hotels and retired beds, and keeps owners apart', async () => {
    const stay = await makeStay({ units: 2 });
    const t = await activeTenant({ stay });
    expect((await mo.occupancy(stay.owner.token)).body.data.totals).toMatchObject({ occupied: 1, vacant: 1 });
    await mo.moveOut(stay.owner.token, t.tenancyId);
    expect((await mo.occupancy(stay.owner.token)).body.data.totals).toMatchObject({ occupied: 0, vacant: 2, occupancyPct: 0 });
    const unit = await prisma.roomUnit.findFirstOrThrow({ where: { roomTypeId: stay.room.id } });
    await prisma.roomUnit.update({ where: { id: unit.id }, data: { status: 'RETIRED' } });
    expect((await mo.occupancy(stay.owner.token)).body.data.totals.units).toBe(1);
    await publish({ propertyType: 'HOTEL', ownerId: stay.owner.id });
    expect((await mo.occupancy(stay.owner.token)).body.data.byHostel).toHaveLength(1); // the hotel has no tenants to count
    const rival = await makeStay();
    expect((await mo.occupancy(stay.owner.token, `?hostelId=${rival.hostel.id}`)).status).toBe(404);
    expect((await mo.occupancy(rival.owner.token, `?hostelId=${stay.hostel.id}`)).status).toBe(404);
    expect((await mo.occupancy(stay.owner.token, `?hostelId=${stay.hostel.id}`)).body.data.byHostel).toHaveLength(1);
  });

  it('is empty for an owner with no long-term property, and closed to everyone else', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' });
    expect((await mo.occupancy(owner.token)).body.data).toMatchObject({ byHostel: [], vacatingSoon: [], totals: { units: 0, occupancyPct: 0 } });
    const t = await activeTenant();
    for (const who of [t.tenant, await makeUser({ roles: ['ADMIN'] })]) expect((await mo.occupancy(who.token)).status).toBe(403);
    expect((await mo.occupancy(owner.token, '?hostelId=nope')).status).toBe(422);
  });
});

describe('the dues report', () => {
  const ageInvoice = (id: string, daysLate: number) => prisma.rentInvoice.update({ where: { id }, data: { dueDate: new Date(`${addDays(TODAY, -daysLate - 5)}T00:00:00Z`), overdueAfter: new Date(`${addDays(TODAY, -daysLate)}T00:00:00Z`) } });

  it('buckets what is owed by how overdue it is and lists who owes it, worst first', async () => {
    const stay = await makeStay({ units: 6 });
    const ages = [0, 3, 20, 45, 90];
    const tenants = [];
    for (const late of ages) {
      const t = await activeTenant({ stay });
      await ageInvoice(t.first.id, late);
      tenants.push({ ...t, late });
    }
    const paid = await activeTenant({ stay });
    await rentApi.record(stay.owner.token, paid.first.id, { amountPaise: paid.first.totalPaise, method: 'CASH', receivedOn: TODAY });
    const res = await mo.dues(stay.owner.token);
    const d = res.body.data;
    expect(d.buckets.map((b: { key: string; invoices: number }) => [b.key, b.invoices])).toEqual([['NOT_DUE', 1], ['D1_7', 1], ['D8_30', 1], ['D31_60', 1], ['D60_PLUS', 1]]);
    const owed = tenants.reduce((n, t) => n + t.first.totalPaise, 0);
    expect(d.totals).toMatchObject({ tenants: 5, invoices: 5, owedPaise: owed, overduePaise: owed - tenants[0]!.first.totalPaise }); // the paid one is not here, the not-yet-late one is owed but not overdue
    expect(d.rows.map((r: { tenancyId: string }) => r.tenancyId)).toEqual([...tenants].reverse().map((t) => t.tenancyId)); // 90, 45, 20, 3, 0 days
    expect(d.rows[0]).toMatchObject({ daysOverdue: 90, hostel: stay.hostel.name, invoices: 1 });
    expect(d.rows.at(-1)).toMatchObject({ daysOverdue: 0 });
  });

  it('counts only what is still owed on a part-paid invoice, and skips cancelled ones', async () => {
    const stay = await makeStay({ units: 3 });
    const a = await activeTenant({ stay });
    await rentApi.record(stay.owner.token, a.first.id, { amountPaise: 100_000, method: 'UPI', receivedOn: TODAY });
    const b = await activeTenant({ stay });
    await rentApi.void(stay.owner.token, b.first.id);
    const d = (await mo.dues(stay.owner.token)).body.data;
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ tenancyId: a.tenancyId, owedPaise: a.first.totalPaise - 100_000 });
    expect(d.totals.invoices).toBe(1);
  });

  it('can be narrowed to a property, keeps owners apart, and is for owners only', async () => {
    const stay = await makeStay();
    const t = await activeTenant({ stay });
    const rival = await makeStay();
    await activeTenant({ stay: rival });
    expect((await mo.dues(stay.owner.token, `?hostelId=${stay.hostel.id}`)).body.data.rows).toHaveLength(1);
    expect((await mo.dues(stay.owner.token, `?hostelId=${rival.hostel.id}`)).status).toBe(404);
    expect((await mo.dues(stay.owner.token)).body.data.rows.every((r: { hostel: string }) => r.hostel === stay.hostel.name)).toBe(true);
    for (const who of [t.tenant, await makeUser({ roles: ['ADMIN'] })]) expect((await mo.dues(who.token)).status).toBe(403);
    void api;
  });
});
