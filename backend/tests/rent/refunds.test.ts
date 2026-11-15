import { afterEach, describe, expect, it } from 'vitest';
import { env } from '@/core/config/env';
import { prisma } from '@/infra/db/prisma';
import { DemoProvider } from '@/infra/payments/demo.provider';
import { setPaymentProvider } from '@/infra/payments/provider';
import { rentRefundsService } from '@/modules/rent/rent-refunds.service';
import { makeUser } from '../helpers/users';
import { makeStay, student } from '../helpers/tenancy';
import { activeTenant, payOnline, rentApi, type Invoice } from '../helpers/rent';

afterEach(() => Object.assign(env(), { RENT_COMMISSION_BPS: 0 }));

const owner = (token: string, id: string) => rentApi.ownerInvoice(token, id).then((r) => r.body.data as Invoice & { payments: { refundedPaise: number; refundablePaise: number; canRefund: boolean; refunds: { status: string; amountPaise: number }[] }[] });
const balances = async (invoiceId: string) => {
  const rows = await prisma.ledgerEntry.findMany({ where: { rentInvoiceId: invoiceId } });
  const b: Record<string, number> = {};
  for (const r of rows) { b[r.creditAccount] = (b[r.creditAccount] ?? 0) + r.amountPaise; b[r.debitAccount] = (b[r.debitAccount] ?? 0) - r.amountPaise; }
  return b;
};
const setup = async (provider = new DemoProvider()) => {
  setPaymentProvider(provider);
  const t = await activeTenant();
  const payment = await payOnline(t.tenant.token, t.stay.owner.token, t.first.id);
  return { ...t, payment, provider };
};

describe('refunding online rent', () => {
  it('pays the tenant back, makes the invoice owe it again, reverses the ledger, tells both sides and audits it', async () => {
    const { first, tenant, stay, payment, provider } = await setup();
    const before = await owner(stay.owner.token, first.id);
    expect(before.status).toBe('PAID');
    expect(before.payments[0]).toMatchObject({ canRefund: true, refundablePaise: first.totalPaise, refundedPaise: 0 });

    const res = await rentApi.refund(stay.owner.token, payment.id, { amountPaise: first.totalPaise, reason: 'Paid twice by mistake' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'DUE', paidPaise: 0, balancePaise: first.totalPaise });
    expect(res.body.data.payments[0]).toMatchObject({ refundedPaise: first.totalPaise, refundablePaise: 0, canRefund: false });
    expect(res.body.data.payments[0].refunds).toEqual([expect.objectContaining({ status: 'PROCESSED', amountPaise: first.totalPaise, reason: 'Paid twice by mistake', byRole: 'OWNER' })]);
    expect(res.body.data.actions).toContain('void'); // nothing is paid any more, so it can be cancelled

    expect(provider.refundCalls).toHaveLength(1);
    expect(provider.refundCalls[0]).toMatchObject({ amountPaise: first.totalPaise });
    expect(await balances(first.id)).toMatchObject({ GUEST: 0, OWNER_PAYABLE: 0 }); // the money went out exactly as it came in
    for (const userId of [tenant.id, stay.owner.id]) expect(await prisma.notification.count({ where: { userId, title: 'Rent refunded' } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'rent.refund.processed', entityId: first.id } });
    expect(audit.metadata).toMatchObject({ hostelId: stay.hostel.id });
    expect(await prisma.auditLog.count({ where: { action: 'rent.refund.create', entityId: first.id } })).toBe(1);
    // the tenant sees it too, without owner-only fields
    const mine = (await rentApi.myInvoice(tenant.token, first.id)).body.data;
    expect(mine.payments[0]).toMatchObject({ refundedPaise: first.totalPaise, canRefund: false });
  });

  it('refunds in parts, never more than was paid, and the amount left is shown', async () => {
    const { first, stay, payment } = await setup();
    const half = Math.floor(first.totalPaise / 2);
    const a = await rentApi.refund(stay.owner.token, payment.id, { amountPaise: half, reason: 'Goodwill credit' });
    expect(a.body.data).toMatchObject({ status: 'PARTIALLY_PAID', paidPaise: first.totalPaise - half });
    expect(a.body.data.payments[0]).toMatchObject({ refundedPaise: half, refundablePaise: first.totalPaise - half, canRefund: true });
    expect((await rentApi.refund(stay.owner.token, payment.id, { amountPaise: first.totalPaise, reason: 'Too much' })).status).toBe(409);
    const rest = await rentApi.refund(stay.owner.token, payment.id, { amountPaise: first.totalPaise - half, reason: 'The rest' });
    expect(rest.body.data).toMatchObject({ status: 'DUE', paidPaise: 0 });
    expect(rest.body.data.payments[0].canRefund).toBe(false);
    const again = await rentApi.refund(stay.owner.token, payment.id, { amountPaise: 100, reason: 'Nothing left' });
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toMatch(/fully refunded/);
  });

  it('returns the platform commission in proportion', async () => {
    Object.assign(env(), { RENT_COMMISSION_BPS: 1000 }); // 10%
    const { first, stay, payment } = await setup();
    const paid = await balances(first.id);
    expect(paid.PLATFORM_REVENUE).toBe(Math.round(first.totalPaise / 10));
    const half = Math.floor(first.totalPaise / 2);
    await rentApi.refund(stay.owner.token, payment.id, { amountPaise: half, reason: 'Half back' });
    const after = await balances(first.id);
    expect(after.GUEST).toBe(-(first.totalPaise - half)); // the tenant is out only what they still owe
    expect(after.PLATFORM_REVENUE).toBe(Math.round(first.totalPaise / 10) - Math.round(half / 10));
    expect(after.PLATFORM_REVENUE! + after.OWNER_PAYABLE!).toBe(first.totalPaise - half); // everything still balances
    await rentApi.refund(stay.owner.token, payment.id, { amountPaise: first.totalPaise - half, reason: 'Rest' });
    expect(await balances(first.id)).toMatchObject({ GUEST: 0, PLATFORM_REVENUE: 0, OWNER_PAYABLE: 0 });
  });

  it('who may refund: the property owner and admins; not tenants, other owners, or for money recorded by hand', async () => {
    const { first, tenant, stay, payment } = await setup();
    const body = { amountPaise: 1000, reason: 'Support refund' };
    expect((await rentApi.refund(tenant.token, payment.id, body)).status).toBe(403);
    const rival = await makeStay();
    expect((await rentApi.refund(rival.owner.token, payment.id, body)).status).toBe(404); // someone else's payment looks missing
    expect((await rentApi.adminRefund(tenant.token, payment.id, body)).status).toBe(403);
    expect((await rentApi.adminRefund(stay.owner.token, payment.id, body)).status).toBe(403);
    const admin = await makeUser({ roles: ['ADMIN'] });
    const viaAdmin = await rentApi.adminRefund(admin.token, payment.id, body);
    expect(viaAdmin.status).toBe(201);
    expect(viaAdmin.body.data.payments[0].refunds[0]).toMatchObject({ byRole: 'ADMIN' });
    expect((await rentApi.adminInvoice(admin.token, first.id)).body.data.payments[0]).toMatchObject({ canRefund: true });

    // cash the owner recorded is reversed, never refunded
    const t2 = await activeTenant();
    await rentApi.record(t2.stay.owner.token, t2.first.id, { amountPaise: t2.first.totalPaise, method: 'CASH', receivedOn: new Date().toISOString().slice(0, 10) });
    const offline = (await owner(t2.stay.owner.token, t2.first.id)).payments[0]!;
    const res = await rentApi.refund(t2.stay.owner.token, offline.id, { amountPaise: 1000, reason: 'Should not work' });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/reverse the entry/);
  });

  it('is validated: a reason is required and the amount is a positive whole number of paise', async () => {
    const { stay, payment } = await setup();
    for (const bad of [{ amountPaise: 1000 }, { amountPaise: 1000, reason: 'x' }, { amountPaise: 0, reason: 'Valid reason' }, { amountPaise: -5, reason: 'Valid reason' }, { amountPaise: 10.5, reason: 'Valid reason' }, { amountPaise: 1000, reason: 'Valid reason', extra: 1 }]) {
      expect((await rentApi.refund(stay.owner.token, payment.id, bad)).status).toBe(422);
    }
    expect((await rentApi.refund(stay.owner.token, '01a1df4d-2583-7141-9882-3b725fcea871', { amountPaise: 1000, reason: 'No such payment' })).status).toBe(404);
  });

  it('two refunds at once cannot together exceed the payment', async () => {
    const { first, stay, payment } = await setup();
    const results = await Promise.all([1, 2, 3].map(() => rentApi.refund(stay.owner.token, payment.id, { amountPaise: first.totalPaise, reason: 'Double click' })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await prisma.rentPayment.findFirstOrThrow({ where: { invoiceId: first.id } })).refundedPaise).toBe(first.totalPaise);
    expect(await prisma.rentRefund.count({ where: { invoiceId: first.id } })).toBe(1);
  });

  it('the database refuses a payment that refunds more than it took, or an offline payment that refunds at all', async () => {
    const { first, payment } = await setup();
    await expect(prisma.rentPayment.update({ where: { id: payment.id }, data: { refundedPaise: first.totalPaise + 1 } })).rejects.toThrow();
    const t2 = await activeTenant();
    await rentApi.record(t2.stay.owner.token, t2.first.id, { amountPaise: 1000, method: 'CASH', receivedOn: new Date().toISOString().slice(0, 10) });
    const cash = await prisma.rentPayment.findFirstOrThrow({ where: { invoiceId: t2.first.id } });
    await expect(prisma.rentPayment.update({ where: { id: cash.id }, data: { refundedPaise: 100 } })).rejects.toThrow();
  });
});

describe('when the gateway is down', () => {
  it('leaves the refund pending (the money still counts as paid), and the retry pays it exactly once', async () => {
    const provider = new DemoProvider();
    provider.failRefunds = 2;
    const { first, stay, payment } = await setup(provider);
    const res = await rentApi.refund(stay.owner.token, payment.id, { amountPaise: first.totalPaise, reason: 'Gateway is flaky' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'PAID', paidPaise: first.totalPaise }); // nothing moved yet
    expect(res.body.data.payments[0]).toMatchObject({ refundedPaise: 0, refundablePaise: 0, canRefund: false }); // but it is already spoken for
    expect(res.body.data.payments[0].refunds[0].status).toBe('PENDING');

    const later = new Date(Date.now() + 60_000);
    expect(await rentRefundsService.retryPending(later)).toMatchObject({ processed: 0 }); // second failure
    expect(await rentRefundsService.retryPending(later)).toMatchObject({ processed: 1 });
    expect(await rentRefundsService.retryPending(later)).toMatchObject({ processed: 0 }); // nothing left to do
    expect(new Set(provider.refundCalls.map((c) => c.idempotencyKey)).size).toBe(1); // one refund request, repeated
    expect(await owner(stay.owner.token, first.id)).toMatchObject({ status: 'DUE', paidPaise: 0 });
    expect(await balances(first.id)).toMatchObject({ GUEST: 0, OWNER_PAYABLE: 0 });
  });

  it('a refund stuck for 48 hours is marked failed and admins are told', async () => {
    const provider = new DemoProvider();
    provider.failRefunds = 1000;
    const { first, stay, payment } = await setup(provider);
    const admin = await makeUser({ roles: ['ADMIN'] });
    await rentApi.refund(stay.owner.token, payment.id, { amountPaise: first.totalPaise, reason: 'Never works' });
    const result = await rentRefundsService.retryPending(new Date(Date.now() + 49 * 3_600_000));
    expect(result.stuck).toBeGreaterThanOrEqual(1);
    expect((await prisma.rentRefund.findFirstOrThrow({ where: { invoiceId: first.id } })).status).toBe('FAILED');
    expect(await prisma.notification.count({ where: { userId: admin.id, title: 'Rent refund needs manual attention' } })).toBe(1);
    expect(await owner(stay.owner.token, first.id)).toMatchObject({ status: 'PAID' }); // the tenant was never paid, so it is still paid
    expect((await owner(stay.owner.token, first.id)).payments[0]).toMatchObject({ canRefund: true }); // and can be tried again
  });
});

describe('a platform-wide view for admins', () => {
  it('lists, opens and totals rent across owners, and keeps everyone else out', async () => {
    const a = await activeTenant();
    const b = await activeTenant();
    await payOnline(a.tenant.token, a.stay.owner.token, a.first.id);
    const admin = await makeUser({ roles: ['ADMIN'] });
    // the test database holds every other test's invoices too, so look at each property on its own
    for (const x of [a, b]) expect(((await rentApi.adminInvoices(admin.token, `?hostelId=${x.stay.hostel.id}`)).body.data as Invoice[]).map((i) => i.id)).toEqual([x.first.id]);
    expect(((await rentApi.adminInvoices(admin.token, '?limit=5')).body.data as Invoice[]).length).toBe(5); // and the platform-wide list is paged
    expect((await rentApi.adminInvoice(admin.token, b.first.id)).body.data).toMatchObject({ id: b.first.id, status: 'DUE' });
    expect((await rentApi.adminInvoice(admin.token, '01a1df4d-2583-7141-9882-3b725fcea871')).status).toBe(404);

    const roll = (await rentApi.adminRoll(admin.token)).body.data;
    expect(roll.byHostel.map((h: { hostelId: string }) => h.hostelId)).toEqual(expect.arrayContaining([a.stay.hostel.id, b.stay.hostel.id]));
    const mine = roll.byHostel.find((h: { hostelId: string }) => h.hostelId === a.stay.hostel.id);
    expect(mine).toMatchObject({ collectedOnlinePaise: a.first.totalPaise, outstandingPaise: 0 });
    const filtered = (await rentApi.adminRoll(admin.token, `?hostelId=${b.stay.hostel.id}`)).body.data;
    expect(filtered.byHostel).toHaveLength(1);
    expect(filtered.totals.outstandingPaise).toBe(b.first.totalPaise);

    for (const who of [a.tenant, a.stay.owner, await student()]) {
      expect((await rentApi.adminInvoice(who.token, a.first.id)).status).toBe(403);
      expect((await rentApi.adminRoll(who.token)).status).toBe(403);
    }
  });
});
