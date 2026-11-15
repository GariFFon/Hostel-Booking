import { describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { rentOrderDtoSchema } from '@/modules/rent/rent.schema';
import { api, approvedTenant, makeStay, student } from '../helpers/tenancy';
import { deliverRent, rentApi, rentEvent } from '../helpers/rent';
import { mo } from '../helpers/moveout';

const reserved = async (over: { deposit?: number } = {}) => {
  const stay = await makeStay();
  const { tenant, tenancyId } = await approvedTenant(stay, { depositPaise: over.deposit ?? 1_200_000 });
  return { stay, tenant, tenancyId };
};
const ledger = (tenancyId: string) => prisma.ledgerEntry.findMany({ where: { tenancyId } });

describe('paying the deposit online', () => {
  it('starts an order for the deposit, and resumes it instead of making another', async () => {
    const { tenant, tenancyId } = await reserved();
    const a = await mo.payDeposit(tenant.token, tenancyId);
    expect(a.status).toBe(201);
    expect(rentOrderDtoSchema.safeParse(a.body.data).success).toBe(true);
    expect(a.body.data).toMatchObject({ kind: 'DEPOSIT', tenancyId, invoiceId: null, amountPaise: 1_200_000, status: 'CREATED', checkout: { type: 'demo' } });
    const b = await mo.payDeposit(tenant.token, tenancyId);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect((await rentApi.order(tenant.token, a.body.data.id)).body.data.kind).toBe('DEPOSIT'); // the same order endpoints work
  });

  it('a successful payment records the deposit as received online, holds it on the ledger and lets the owner move the tenant in', async () => {
    const { stay, tenant, tenancyId } = await reserved();
    const order = (await mo.payDeposit(tenant.token, tenancyId)).body.data;
    expect((await api.activate(stay.owner.token, tenancyId)).status).toBe(409); // the deposit is still due
    const done = await rentApi.checkout(tenant.token, order.id, 'DEMO_SUCCESS');
    expect(done.body.data).toMatchObject({ status: 'CAPTURED', kind: 'DEPOSIT' });

    const t = (await api.myTenancy(tenant.token, tenancyId)).body.data;
    expect(t.deposit).toMatchObject({ status: 'RECEIVED', method: 'ONLINE' });
    expect(t.actions).not.toContain('pay_deposit');
    expect(await ledger(tenancyId)).toEqual([expect.objectContaining({ debitAccount: 'GUEST', creditAccount: 'DEPOSIT_HELD', amountPaise: 1_200_000 })]);
    for (const userId of [tenant.id, stay.owner.id]) expect(await prisma.notification.count({ where: { userId, title: 'Deposit received' } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'tenancy.deposit.online', entityId: tenancyId } });
    expect(audit.metadata).toMatchObject({ hostelId: stay.hostel.id });
    expect((await api.activate(stay.owner.token, tenancyId)).status).toBe(200);
  });

  it('is refused once the deposit is paid, when there is none, or for someone else\'s stay', async () => {
    const { stay, tenant, tenancyId } = await reserved();
    expect((await mo.payDeposit((await student()).token, tenancyId)).status).toBe(404);
    expect((await mo.payDeposit(stay.owner.token, tenancyId)).status).toBe(404); // not the tenant
    await api.deposit(stay.owner.token, tenancyId, { method: 'UPI' });
    const again = await mo.payDeposit(tenant.token, tenancyId);
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toMatch(/already been paid/);
    const free = await reserved({ deposit: 0 });
    expect((await mo.payDeposit(free.tenant.token, free.tenancyId)).status).toBe(409);
  });

  it('a declined payment leaves the deposit due, and the tenant can try again', async () => {
    const { tenant, tenancyId } = await reserved();
    const order = (await mo.payDeposit(tenant.token, tenancyId)).body.data;
    const failed = await rentApi.checkout(tenant.token, order.id, 'DEMO_FAIL');
    expect(failed.body.data.status).toBe('FAILED');
    expect((await api.myTenancy(tenant.token, tenancyId)).body.data.deposit.status).toBe('DUE');
    const retry = await mo.payDeposit(tenant.token, tenancyId);
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).not.toBe(order.id);
    expect(await ledger(tenancyId)).toEqual([]);
  });

  it('while a payment is open the owner cannot record the deposit by hand', async () => {
    const { stay, tenant, tenancyId } = await reserved();
    await mo.payDeposit(tenant.token, tenancyId);
    const res = await api.deposit(stay.owner.token, tenancyId, { method: 'CASH' });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/online right now/);
  });

  it('the gateway callback must carry the right amount and is applied once', async () => {
    const { tenant, tenancyId } = await reserved();
    const order = (await mo.payDeposit(tenant.token, tenancyId)).body.data;
    const wrong = await deliverRent(await rentEvent(order.id, { amountPaise: 100 }));
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect((await api.myTenancy(tenant.token, tenancyId)).body.data.deposit.status).toBe('DUE');
    const good = await rentEvent(order.id);
    expect((await deliverRent(good)).status).toBe(200);
    await deliverRent(good); // redelivery
    await deliverRent(await rentEvent(order.id, { id: 'evt_again_' + order.id })); // a second capture event for the same order
    expect(await ledger(tenancyId)).toHaveLength(1); // held once
  });

  it('money that arrives after the deposit was already settled is held and flagged for review', async () => {
    const { stay, tenant, tenancyId } = await reserved();
    const order = (await mo.payDeposit(tenant.token, tenancyId)).body.data;
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { depositReceivedAt: new Date(), depositMethod: 'CASH' } }); // recorded some other way meanwhile
    expect((await rentApi.checkout(tenant.token, order.id, 'DEMO_SUCCESS')).status).toBe(409); // the app itself refuses to continue
    await deliverRent(await rentEvent(order.id)); // but a gateway that already took the money still reports it
    expect(await prisma.auditLog.count({ where: { action: 'tenancy.deposit.needs_review', entityId: tenancyId } })).toBe(1);
    expect(await ledger(tenancyId)).toHaveLength(1); // the money is on the books either way
    expect((await api.myTenancy(tenant.token, tenancyId)).body.data.deposit.method).toBe('CASH'); // the recorded deposit is not overwritten
    void stay;
  });
});
