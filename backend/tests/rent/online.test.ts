import { afterEach, describe, expect, it } from 'vitest';
import { env } from '@/core/config/env';
import { signAccessToken } from '@/core/auth/tokens';
import { prisma } from '@/infra/db/prisma';
import { outbox } from '@/infra/mail/mailer';
import { captured, runCaptured, setQueueMode } from '@/infra/queue/queue';
import { processDemoWebhook } from '@/modules/payments/webhooks.service';
import { signDemoPayload } from '@/infra/payments/demo.provider';
import { rentOrderDtoSchema } from '@/modules/rent/rent.schema';
import { makeStay, student } from '../helpers/tenancy';
import { activeTenant, deliverRent, rentApi, rentEvent, type Invoice } from '../helpers/rent';

afterEach(() => {
  setQueueMode(null);
  Object.assign(env(), { RENT_COMMISSION_BPS: 0 });
});

const ledgerOf = (invoiceId: string) => prisma.ledgerEntry.findMany({ where: { rentInvoiceId: invoiceId }, orderBy: { createdAt: 'asc' } });
const owner = (token: string, id: string) => rentApi.ownerInvoice(token, id).then((r) => r.body.data as Invoice);
const age = async (orderId: string) => {
  const old = new Date(Date.now() - 60 * 60_000);
  await prisma.rentOrder.update({ where: { id: orderId }, data: { createdAt: old } });
  await prisma.rentOrderAttempt.updateMany({ where: { orderId }, data: { createdAt: old } });
};

describe('paying rent online', () => {
  it('starts an order for the whole balance, and resumes it instead of making another', async () => {
    const { first, tenant } = await activeTenant();
    const a = await rentApi.initiate(tenant.token, first.id);
    expect(a.status).toBe(201);
    expect(rentOrderDtoSchema.safeParse(a.body.data).success).toBe(true);
    expect(a.body.data).toMatchObject({ invoiceId: first.id, amountPaise: first.totalPaise, status: 'CREATED', checkout: { type: 'demo' } });
    const b = await rentApi.initiate(tenant.token, first.id);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect((await rentApi.myInvoice(tenant.token, first.id)).body.data.openOrder).toMatchObject({ id: a.body.data.id, status: 'CREATED' });
  });

  it('a successful payment settles the invoice, issues a receipt, tells both sides and books the ledger', async () => {
    const { first, tenant, stay } = await activeTenant();
    const order = (await rentApi.initiate(tenant.token, first.id)).body.data;
    const done = await rentApi.checkout(tenant.token, order.id, 'DEMO_SUCCESS');
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'CAPTURED', checkout: null });

    const inv = await owner(stay.owner.token, first.id);
    expect(inv).toMatchObject({ status: 'PAID', paidPaise: first.totalPaise, balancePaise: 0, openOrder: null });
    expect(inv.payments).toHaveLength(1);
    expect(inv.payments[0]).toMatchObject({ method: 'ONLINE', amountPaise: first.totalPaise, canReverse: false });
    expect(inv.payments[0]!.receiptNo).toMatch(/^RCPT-/);

    expect(await prisma.notification.count({ where: { userId: tenant.id, type: 'RENT_PAID' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: stay.owner.id, type: 'RENT_PAID' } })).toBe(1);
    expect(outbox.some((m) => m.to === tenant.email && m.subject === 'Payment received')).toBe(true);

    const ledger = await ledgerOf(first.id);
    expect(ledger).toHaveLength(1); // no commission by default, so no zero-value entry
    expect(ledger[0]).toMatchObject({ debitAccount: 'GUEST', creditAccount: 'OWNER_PAYABLE', amountPaise: first.totalPaise, bookingId: null });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'rent.payment.capture', entityId: first.id } });
    expect(audit.actorRole).toBe('SYSTEM');
    expect(audit.metadata).toMatchObject({ hostelId: stay.hostel.id });
  });

  it('takes the platform commission from the owner share when it is switched on, and the ledger always balances', async () => {
    Object.assign(env(), { RENT_COMMISSION_BPS: 1000 });
    const { first, tenant } = await activeTenant();
    const order = (await rentApi.initiate(tenant.token, first.id)).body.data;
    await rentApi.checkout(tenant.token, order.id);
    const ledger = await ledgerOf(first.id);
    const fee = Math.round(first.totalPaise * 0.1);
    expect(ledger.map((l) => [l.creditAccount, l.amountPaise]).sort()).toEqual([['OWNER_PAYABLE', first.totalPaise - fee], ['PLATFORM_REVENUE', fee]].sort());
    expect(ledger.reduce((n, l) => n + l.amountPaise, 0)).toBe(first.totalPaise);
    expect(ledger.every((l) => l.debitAccount === 'GUEST')).toBe(true);
  });

  it('a declined payment leaves the invoice owed and lets the tenant try again', async () => {
    const { first, tenant, stay } = await activeTenant();
    const order = (await rentApi.initiate(tenant.token, first.id)).body.data;
    const failed = await rentApi.checkout(tenant.token, order.id, 'DEMO_FAIL');
    expect(failed.body.data).toMatchObject({ status: 'FAILED', failureCode: 'DEMO_DECLINED', checkout: null });
    expect(await owner(stay.owner.token, first.id)).toMatchObject({ status: 'DUE', paidPaise: 0, openOrder: null });
    expect(await ledgerOf(first.id)).toHaveLength(0);
    const retry = await rentApi.initiate(tenant.token, first.id);
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).not.toBe(order.id);
    expect((await rentApi.checkout(tenant.token, retry.body.data.id)).body.data.status).toBe('CAPTURED');
    expect((await rentApi.checkout(tenant.token, retry.body.data.id)).status).toBe(409); // already captured
    expect((await rentApi.initiate(tenant.token, first.id)).status).toBe(409); // nothing left to pay
  });

  it('a payment that stays pending (an approval on the bank app) settles later', async () => {
    setQueueMode('capture');
    const { first, tenant } = await activeTenant();
    const order = (await rentApi.initiate(tenant.token, first.id)).body.data;
    const res = await rentApi.checkout(tenant.token, order.id, 'DEMO_PENDING');
    expect(res.body.data).toMatchObject({ status: 'PENDING', checkout: { type: 'demo' } });
    expect((await rentApi.order(tenant.token, order.id)).body.data.status).toBe('PENDING'); // nothing has reached us yet
    expect(captured.filter((j) => j.name === 'rent-demo-webhook')).toHaveLength(1);
    await runCaptured((j) => j.name === 'rent-demo-webhook'); // the first delivery schedules the settlement, which then runs
    expect((await rentApi.order(tenant.token, order.id)).body.data.status).toBe('CAPTURED');
    expect(captured.filter((j) => j.name === 'rent-demo-webhook')).toHaveLength(0);
  });

  it('a payment nobody finishes (DEMO_TIMEOUT) stays open until it goes stale', async () => {
    const { first, tenant, stay } = await activeTenant();
    const order = (await rentApi.initiate(tenant.token, first.id)).body.data;
    await rentApi.checkout(tenant.token, order.id, 'DEMO_TIMEOUT');
    expect((await rentApi.order(tenant.token, order.id)).body.data.status).toBe('CREATED');
    // the owner cannot change or settle an invoice while it is being paid
    expect((await rentApi.record(stay.owner.token, first.id, { amountPaise: 1000, method: 'CASH' })).status).toBe(409);
    expect((await rentApi.addLine(stay.owner.token, first.id, { type: 'ELECTRICITY', description: 'bill', amountPaise: 500 })).status).toBe(409);
    expect((await rentApi.void(stay.owner.token, first.id)).status).toBe(409);
    expect((await owner(stay.owner.token, first.id)).actions).toEqual([]);
    expect((await rentApi.checkout(tenant.token, order.id)).status).toBe(409); // an attempt is already in progress

    await age(order.id); // an hour passes: the abandoned order no longer blocks anything
    expect((await rentApi.record(stay.owner.token, first.id, { amountPaise: 1000, method: 'CASH' })).status).toBe(201);
    expect((await prisma.rentOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('FAILED');
  });

  it('refuses to start or finish a payment the invoice has moved on from', async () => {
    const { first, tenant, stay } = await activeTenant();
    const order = (await rentApi.initiate(tenant.token, first.id)).body.data;
    await age(order.id);
    await rentApi.record(stay.owner.token, first.id, { amountPaise: 1000, method: 'CASH' }); // the stale order is closed, balance changes
    expect((await rentApi.checkout(tenant.token, order.id)).status).toBe(409);
    const fresh = await rentApi.initiate(tenant.token, first.id);
    expect(fresh.body.data.amountPaise).toBe(first.totalPaise - 1000); // the new order is for what is left
  });

  it('needs a verified email, and nobody else can see or use the order', async () => {
    const { first, tenant } = await activeTenant();
    const { token: unverified } = await signAccessToken({ id: tenant.id, roles: ['GUEST'], emailVerified: false });
    expect((await rentApi.initiate(unverified, first.id)).status).toBe(403);
    const order = (await rentApi.initiate(tenant.token, first.id)).body.data;
    const other = await student();
    expect((await rentApi.initiate(other.token, first.id)).status).toBe(404);
    expect((await rentApi.order(other.token, order.id)).status).toBe(404);
    expect((await rentApi.checkout(other.token, order.id)).status).toBe(404);
    expect((await rentApi.initiate('', first.id)).status).toBe(401);
  });

  it('cannot pay a cancelled invoice', async () => {
    const { first, tenant, stay } = await activeTenant();
    await rentApi.void(stay.owner.token, first.id);
    expect((await rentApi.initiate(tenant.token, first.id)).status).toBe(409);
  });
});

describe('what the gateway sends', () => {
  it('a duplicate delivery of the same event changes nothing', async () => {
    const { first, tenant } = await activeTenant();
    const order = (await rentApi.initiate(tenant.token, first.id)).body.data;
    const event = await rentEvent(order.id, { id: 'evt_dup_rent_1' });
    expect((await deliverRent(event)).body.data.outcome ?? 'ok').toBeDefined();
    const again = await deliverRent(event);
    expect(again.status).toBe(200);
    expect(await prisma.rentPayment.count({ where: { invoiceId: first.id } })).toBe(1);
    expect((await prisma.rentInvoice.findUniqueOrThrow({ where: { id: first.id } })).paidPaise).toBe(first.totalPaise);
    expect(await ledgerOf(first.id)).toHaveLength(1);
  });

  it('a payment for the wrong amount is rejected and applies nothing', async () => {
    const { first, tenant } = await activeTenant();
    const order = (await rentApi.initiate(tenant.token, first.id)).body.data;
    const res = await deliverRent(await rentEvent(order.id, { amountPaise: first.totalPaise - 1 }));
    expect(res.status).toBe(422);
    expect(await prisma.rentPayment.count({ where: { invoiceId: first.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'rent.payment.amount_mismatch', entityId: first.id } })).toBe(1);
  });

  it('rejects an unsigned or tampered callback', async () => {
    const { first, tenant } = await activeTenant();
    const order = (await rentApi.initiate(tenant.token, first.id)).body.data;
    const event = await rentEvent(order.id);
    const raw = JSON.stringify(event);
    await expect(processDemoWebhook(raw, null)).rejects.toThrow();
    await expect(processDemoWebhook(raw.replace(String(event.data.amountPaise), '1'), signDemoPayload(raw))).rejects.toThrow();
    expect(await prisma.rentPayment.count({ where: { invoiceId: first.id } })).toBe(0);
  });

  it('a late "failed" after success does not undo the payment', async () => {
    const { first, tenant } = await activeTenant();
    const order = (await rentApi.initiate(tenant.token, first.id)).body.data;
    await rentApi.checkout(tenant.token, order.id);
    await deliverRent(await rentEvent(order.id, { type: 'payment.failed' }));
    expect((await prisma.rentInvoice.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('PAID');
    expect((await prisma.rentOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CAPTURED');
  });

  it('an order the platform does not know is ignored', async () => {
    const res = await deliverRent({ id: 'evt_unknown_rent', type: 'payment.captured', createdAt: new Date().toISOString(), data: { orderId: 'demo_order_nope', paymentId: 'demo_pay_x', amountPaise: 100, currency: 'INR' } });
    expect(res.status).toBe(200);
  });

  it('money that arrives after the invoice was settled elsewhere is recorded and flagged for a refund, not lost', async () => {
    const { first, tenant, stay } = await activeTenant();
    const order = (await rentApi.initiate(tenant.token, first.id)).body.data;
    await age(order.id);
    await rentApi.record(stay.owner.token, first.id, { amountPaise: first.totalPaise, method: 'CASH' }); // paid in cash; the stale order is closed
    await deliverRent(await rentEvent(order.id)); // ...then the bank's callback finally arrives
    const inv = await prisma.rentInvoice.findUniqueOrThrow({ where: { id: first.id } });
    expect(inv.status).toBe('PAID');
    expect(inv.paidPaise).toBe(first.totalPaise * 2);
    expect(await prisma.rentPayment.count({ where: { invoiceId: first.id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'rent.payment.needs_review', entityId: first.id } })).toBe(1);
  });

  it('money that arrives for a cancelled invoice is recorded against it, flagged, and does not reopen it', async () => {
    const { first, tenant, stay } = await activeTenant();
    const order = (await rentApi.initiate(tenant.token, first.id)).body.data;
    await age(order.id);
    await rentApi.void(stay.owner.token, first.id);
    await deliverRent(await rentEvent(order.id));
    const inv = await prisma.rentInvoice.findUniqueOrThrow({ where: { id: first.id } });
    expect(inv).toMatchObject({ status: 'VOID', paidPaise: 0 });
    expect(await prisma.rentPayment.count({ where: { invoiceId: first.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'rent.payment.needs_review', entityId: first.id } })).toBe(1);
  });
});

describe('the rent roll', () => {
  it('totals what is billed, collected (online and recorded) and owed for the month, per property', async () => {
    const stay = await makeStay({ units: 3 });
    const a = await activeTenant({ stay });
    const b = await activeTenant({ stay });
    const orderA = (await rentApi.initiate(a.tenant.token, a.first.id)).body.data;
    await rentApi.checkout(a.tenant.token, orderA.id); // A pays online in full
    const part = Math.floor(b.first.totalPaise / 2);
    await rentApi.record(stay.owner.token, b.first.id, { amountPaise: part, method: 'CASH' }); // B pays half in cash

    const month = a.first.periodStart.slice(0, 7);
    const roll = await rentApi.roll(stay.owner.token, `?month=${month}`);
    expect(roll.status).toBe(200);
    expect(roll.body.data.month).toBe(month);
    expect(roll.body.data.activeTenants).toBe(2);
    expect(roll.body.data.totals).toMatchObject({
      invoices: 2, invoicedPaise: a.first.totalPaise + b.first.totalPaise, collectedPaise: a.first.totalPaise + part, collectedOnlinePaise: a.first.totalPaise, collectedOfflinePaise: part,
      outstandingPaise: b.first.totalPaise - part, overdueCount: 0, overduePaise: 0,
    });
    expect(roll.body.data.byHostel).toHaveLength(1);
    expect(roll.body.data.byHostel[0]).toMatchObject({ hostelId: stay.hostel.id, name: stay.hostel.name, invoices: 2 });
  });

  it('leaves out cancelled invoices and reversed payments, and shows nothing for another owner', async () => {
    const stay = await makeStay();
    const a = await activeTenant({ stay });
    const paid = await rentApi.record(stay.owner.token, a.first.id, { amountPaise: 1000, method: 'UPI' });
    await rentApi.reverse(stay.owner.token, paid.body.data.payments[0].id);
    const month = a.first.periodStart.slice(0, 7);
    const roll = await rentApi.roll(stay.owner.token, `?month=${month}`);
    expect(roll.body.data.totals).toMatchObject({ collectedPaise: 0, collectedOfflinePaise: 0, outstandingPaise: a.first.totalPaise });
    await rentApi.void(stay.owner.token, a.first.id);
    expect((await rentApi.roll(stay.owner.token, `?month=${month}`)).body.data.totals.invoices).toBe(0);

    const rival = await makeStay();
    expect((await rentApi.roll(rival.owner.token, `?month=${month}`)).body.data.totals.invoices).toBe(0);
    expect((await rentApi.roll(a.tenant.token)).status).toBe(403);
    expect((await rentApi.roll(stay.owner.token, '?month=nonsense')).status).toBe(422);
  });

  it('counts overdue rent using each property\'s own grace days', async () => {
    const stay = await makeStay();
    const a = await activeTenant({ stay, terms: { rentGraceDays: 0 } });
    // push the invoice into the past so it is overdue today
    await prisma.rentInvoice.update({ where: { id: a.first.id }, data: { dueDate: new Date(Date.now() - 10 * 86_400_000), overdueAfter: new Date(Date.now() - 10 * 86_400_000) } });
    const month = a.first.periodStart.slice(0, 7);
    const roll = await rentApi.roll(stay.owner.token, `?month=${month}`);
    expect(roll.body.data.totals).toMatchObject({ overdueCount: 1, overduePaise: a.first.totalPaise });
    const list = await rentApi.ownerInvoices(stay.owner.token, '?overdue=true');
    expect(list.body.data.map((i: { id: string }) => i.id)).toContain(a.first.id);
    expect((await rentApi.myInvoice(a.tenant.token, a.first.id)).body.data.overdue.isOverdue).toBe(true);
  });
});
