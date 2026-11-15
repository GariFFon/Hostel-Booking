import { describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { sweepRent } from '@/modules/rent/rent-sweep.service';
import { sweepTenancies } from '@/modules/tenancies/tenancy-sweep.service';
import { makeUser } from '../helpers/users';
import { makeStay, student } from '../helpers/tenancy';
import { TODAY, addDays, at } from '../helpers/rent';
import { DAY, endedStay, mo, noticeDay, tenantWithDeposit } from '../helpers/moveout';

const status = async (tenancyId: string) => (await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status;

describe('giving notice', () => {
  it('the tenant names the move-out day; the stay goes on notice and the owner is told', async () => {
    const { stay, tenant, tenancyId } = await tenantWithDeposit();
    const day = noticeDay(40);
    const res = await mo.notice(tenant.token, tenancyId, { moveOutDate: day, reason: 'Course is ending' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'NOTICE', endDate: day, notice: { by: 'TENANT', reason: 'Course is ending', moveOutDate: day } });
    expect(res.body.data.actions).toEqual(['withdraw_notice']);
    expect((await mo.ownerNotice(stay.owner.token, tenancyId, { moveOutDate: noticeDay(45) })).status).toBe(409); // already on notice
    expect(await prisma.notification.count({ where: { userId: stay.owner.id, type: 'TENANCY_NOTICE' } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'tenancy.notice.give', entityId: tenancyId } });
    expect(audit.metadata).toMatchObject({ hostelId: stay.hostel.id });
    expect((await mo.moveOut(stay.owner.token, tenancyId)).body.data.status).toBe('ENDED'); // the owner can still record the move-out
  });

  it('must respect the notice period, and only on a stay that is running', async () => {
    const { tenant, tenancyId, stay } = await tenantWithDeposit();
    const early = await mo.notice(tenant.token, tenancyId, { moveOutDate: noticeDay(10) }); // the default notice period is 30 days
    expect(early.status).toBe(422);
    expect(JSON.stringify(early.body)).toMatch(/30 days/);
    expect((await mo.notice(tenant.token, tenancyId, { moveOutDate: addDays(TODAY, 400) })).status).toBe(422); // more than a year away
    expect((await mo.notice(tenant.token, tenancyId, { moveOutDate: 'soon' })).status).toBe(422);
    expect((await mo.notice(tenant.token, tenancyId, { moveOutDate: noticeDay(), extra: 1 })).status).toBe(422);
    // a stay that has not started cannot give notice
    const pending = await (await import('../helpers/tenancy')).approvedTenant(stay);
    expect((await mo.notice(pending.tenant.token, pending.tenancyId, { moveOutDate: noticeDay() })).status).toBe(409);
  });

  it('a shorter notice period set on the stay is honoured', async () => {
    const stay = await makeStay();
    const { tenant, tenancyId } = await (await import('../helpers/tenancy')).approvedTenant(stay, { depositPaise: 0 });
    await (await import('../helpers/tenancy')).api.patchTenancy(stay.owner.token, tenancyId, { noticeDays: 7 });
    await (await import('../helpers/tenancy')).api.activate(stay.owner.token, tenancyId);
    expect((await mo.notice(tenant.token, tenancyId, { moveOutDate: addDays(TODAY, 8) })).status).toBe(200);
  });

  it('only the side that gave notice can withdraw it, and withdrawing brings back the cancelled invoices', async () => {
    const { stay, tenant, tenancyId } = await tenantWithDeposit();
    await sweepRent(at(addDays(TODAY, 25))); // next month's invoice is issued a week before it is due
    const issued = await prisma.rentInvoice.findMany({ where: { tenancyId }, orderBy: { periodStart: 'asc' } });
    expect(issued.length).toBeGreaterThanOrEqual(2);
    const lastDay = addDays(issued[0]!.periodEnd.toISOString().slice(0, 10), 0);

    const given = await mo.notice(tenant.token, tenancyId, { moveOutDate: addDays(TODAY, 31) });
    expect(given.status).toBe(200);
    const after = await prisma.rentInvoice.findMany({ where: { tenancyId }, orderBy: { periodStart: 'asc' } });
    for (const inv of after) if (inv.periodStart.toISOString().slice(0, 10) > addDays(TODAY, 31)) expect(inv).toMatchObject({ status: 'VOID', voidReason: 'Stay ending (notice given)' });
    void lastDay;

    expect((await mo.ownerNoticeWithdraw(stay.owner.token, tenancyId)).status).toBe(409); // the tenant gave it
    const back = await mo.noticeWithdraw(tenant.token, tenancyId);
    expect(back.body.data).toMatchObject({ status: 'ACTIVE', endDate: null, notice: null });
    expect(await prisma.rentInvoice.count({ where: { tenancyId, status: 'VOID' } })).toBe(0); // restored
    expect(await prisma.notification.count({ where: { userId: stay.owner.id, title: 'Notice withdrawn' } })).toBe(1);
    expect((await mo.noticeWithdraw(tenant.token, tenancyId)).status).toBe(409); // nothing to withdraw
  });

  it('the owner can serve notice too; then only the owner can withdraw it', async () => {
    const { stay, tenant, tenancyId } = await tenantWithDeposit();
    const res = await mo.ownerNotice(stay.owner.token, tenancyId, { moveOutDate: noticeDay(35), reason: 'Building is being renovated' });
    expect(res.body.data).toMatchObject({ status: 'NOTICE', notice: { by: 'OWNER' } });
    expect(res.body.data.actions).toEqual(expect.arrayContaining(['withdraw_notice', 'move_out']));
    expect(await prisma.notification.count({ where: { userId: tenant.id, type: 'TENANCY_NOTICE' } })).toBe(1);
    expect((await mo.noticeWithdraw(tenant.token, tenancyId)).status).toBe(409);
    expect((await mo.ownerNoticeWithdraw(stay.owner.token, tenancyId)).body.data.status).toBe('ACTIVE');
  });

  it('is private: another tenant, another owner and wrong roles are refused', async () => {
    const { stay, tenant, tenancyId } = await tenantWithDeposit();
    const other = await tenantWithDeposit();
    expect((await mo.notice(other.tenant.token, tenancyId, { moveOutDate: noticeDay() })).status).toBe(404);
    expect((await mo.ownerNotice(other.stay.owner.token, tenancyId, { moveOutDate: noticeDay() })).status).toBe(404);
    expect((await mo.ownerNotice(tenant.token, tenancyId, { moveOutDate: noticeDay() })).status).toBe(403);
    expect((await mo.moveOut(tenant.token, tenancyId)).status).toBe(403);
    expect((await mo.moveOut(other.stay.owner.token, tenancyId)).status).toBe(404);
    expect(await status(tenancyId)).toBe('ACTIVE');
    void stay;
  });
});

describe('moving out', () => {
  it('ends the stay, frees the bed, stops billing and tells both sides', async () => {
    const { stay, tenant, tenancyId } = await tenantWithDeposit();
    const res = await mo.moveOut(stay.owner.token, tenancyId, { note: 'Handed back the keys' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ENDED', endDate: TODAY, settlement: { status: 'DRAFT' } });
    expect(res.body.data.movedOutAt).toBeTruthy();
    expect(res.body.data.actions).toEqual(['settle']);
    for (const userId of [tenant.id, stay.owner.id]) expect(await prisma.notification.count({ where: { userId, type: 'TENANCY_ENDED', title: 'Stay ended' } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'tenancy.move_out', entityId: tenancyId } });
    expect(audit.metadata).toMatchObject({ hostelId: stay.hostel.id });

    // the bed is free for the next tenant, and nothing more is billed
    expect((await mo.occupancy(stay.owner.token)).body.data.totals.vacant).toBeGreaterThanOrEqual(3);
    const before = await prisma.rentInvoice.count({ where: { tenancyId } });
    await sweepRent(at(addDays(TODAY, 80)));
    expect(await prisma.rentInvoice.count({ where: { tenancyId } })).toBe(before);
    expect((await mo.moveOut(stay.owner.token, tenancyId)).status).toBe(409); // already ended
    expect((await mo.notice(tenant.token, tenancyId, { moveOutDate: noticeDay() })).status).toBe(409);
  });

  it('can record an earlier move-out day, never a future one or one before the stay began', async () => {
    const { stay, tenancyId } = await tenantWithDeposit();
    expect((await mo.moveOut(stay.owner.token, tenancyId, { movedOutOn: addDays(TODAY, 3) })).status).toBe(422);
    expect((await mo.moveOut(stay.owner.token, tenancyId, { movedOutOn: addDays(TODAY, -4000) })).status).toBe(422);
    expect((await mo.moveOut(stay.owner.token, tenancyId, { movedOutOn: 'nope' })).status).toBe(422);
    const ok = await mo.moveOut(stay.owner.token, tenancyId, { movedOutOn: TODAY });
    expect(ok.body.data.endDate).toBe(TODAY);
  });

  it('cancels unpaid invoices for periods that begin after the move-out day', async () => {
    const { stay, tenancyId } = await tenantWithDeposit();
    await sweepRent(at(addDays(TODAY, 25)));
    await mo.moveOut(stay.owner.token, tenancyId);
    const invoices = await prisma.rentInvoice.findMany({ where: { tenancyId }, orderBy: { periodStart: 'asc' } });
    for (const inv of invoices.slice(1)) expect(inv).toMatchObject({ status: 'VOID', voidReason: 'Stay ended' });
    expect(invoices[0]!.status).not.toBe('VOID'); // the month they lived in is still owed
  });

  it('a new tenant can take the freed bed', async () => {
    const stay = await makeStay({ units: 1 });
    const first = await tenantWithDeposit({ stay });
    await mo.moveOut(stay.owner.token, first.tenancyId);
    const second = await tenantWithDeposit({ stay });
    expect(second.tenancyId).not.toBe(first.tenancyId);
  });
});

describe('the sweep', () => {
  it('ends a stay whose notice period is over, once, and drafts the settlement', async () => {
    const { stay, tenant, tenancyId } = await tenantWithDeposit();
    await mo.notice(tenant.token, tenancyId, { moveOutDate: noticeDay() });
    expect((await sweepTenancies()).ended).toBe(0); // not over yet
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { startDate: new Date(`${addDays(TODAY, -60)}T00:00:00Z`), endDate: new Date(`${addDays(TODAY, -2)}T00:00:00Z`) } });
    expect((await sweepTenancies()).ended).toBeGreaterThanOrEqual(1);
    expect(await status(tenancyId)).toBe('ENDED');
    expect((await sweepTenancies()).ended).toBe(0); // safe to repeat
    const t = await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } });
    expect(t.movedOutAt).not.toBeNull();
    expect(await prisma.depositSettlement.count({ where: { tenancyId } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'tenancy.move_out', entityId: tenancyId } });
    expect(audit.actorRole).toBe('SYSTEM');
    expect((await mo.settlement(stay.owner.token, tenancyId)).status).toBe(200);
  });

  it('leaves a stay that is still inside its notice period alone', async () => {
    const { tenant, tenancyId } = await tenantWithDeposit();
    await mo.notice(tenant.token, tenancyId, { moveOutDate: noticeDay(60) });
    await sweepTenancies(new Date(Date.now() + 5 * DAY));
    expect(await status(tenancyId)).toBe('NOTICE');
  });
});

describe('the settlement draft', () => {
  it('is only made when a deposit was held', async () => {
    const stay = await makeStay();
    const { tenant, tenancyId } = await (await import('../helpers/tenancy')).approvedTenant(stay, { depositPaise: 0 });
    await (await import('../helpers/tenancy')).api.activate(stay.owner.token, tenancyId);
    const res = await mo.moveOut(stay.owner.token, tenancyId);
    expect(res.body.data.settlement).toBeNull();
    expect(res.body.data.actions).toEqual([]);
    expect((await mo.settlement(stay.owner.token, tenancyId)).status).toBe(404);
    void tenant; void makeUser; void student; void endedStay;
  });
});
