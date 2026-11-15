import { describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { outbox } from '@/infra/mail/mailer';
import { sweepRent } from '@/modules/rent/rent-sweep.service';
import { makeStay, student } from '../helpers/tenancy';
import { TODAY, activeTenant, addDays, at, rentApi, type Invoice } from '../helpers/rent';

const rec = (token: string, id: string, over: Record<string, unknown> = {}) => rentApi.record(token, id, { amountPaise: 10000, method: 'UPI', reference: 'UTR-1', ...over });
const fresh = (token: string, id: string) => rentApi.ownerInvoice(token, id).then((r) => r.body.data as Invoice);

describe('recording rent received outside the app', () => {
  it('records a partial payment, then the rest: balance, status and a numbered receipt each time', async () => {
    const { first, stay, tenant } = await activeTenant();
    const part = Math.floor(first.totalPaise / 3);
    const one = await rec(stay.owner.token, first.id, { amountPaise: part, method: 'CASH', note: 'Handed over in person' });
    expect(one.status).toBe(201);
    expect(one.body.data).toMatchObject({ status: 'PARTIALLY_PAID', paidPaise: part, balancePaise: first.totalPaise - part });
    expect(one.body.data.payments).toHaveLength(1);
    expect(one.body.data.payments[0]).toMatchObject({ amountPaise: part, method: 'CASH', canReverse: true, reversed: false });
    expect(one.body.data.payments[0].receiptNo).toMatch(/^RCPT-\d{4}-[A-Z2-9]{6}$/);

    const two = await rec(stay.owner.token, first.id, { amountPaise: first.totalPaise - part, method: 'BANK', reference: 'NEFT-77' });
    expect(two.body.data).toMatchObject({ status: 'PAID', paidPaise: first.totalPaise, balancePaise: 0, actions: [] });
    expect(new Set(two.body.data.payments.map((p: { receiptNo: string }) => p.receiptNo)).size).toBe(2);

    expect(await prisma.notification.count({ where: { userId: tenant.id, type: 'RENT_PAID' } })).toBe(2);
    expect(outbox.some((m) => m.to === tenant.email && m.subject === 'Payment received')).toBe(true);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'rent.payment.record', entityId: first.id } });
    expect(audit.metadata).toMatchObject({ hostelId: stay.hostel.id });
  });

  it('refuses more than is owed, wrong dates and bad input', async () => {
    const { first, stay } = await activeTenant();
    expect((await rec(stay.owner.token, first.id, { amountPaise: first.totalPaise + 1 })).status).toBe(422);
    expect((await rec(stay.owner.token, first.id, { amountPaise: 50 })).status).toBe(422); // minimum ₹1
    expect((await rec(stay.owner.token, first.id, { method: 'ONLINE' })).status).toBe(422); // online money only comes from the gateway
    expect((await rec(stay.owner.token, first.id, { receivedOn: addDays(TODAY, 1) })).status).toBe(422);
    expect((await rec(stay.owner.token, first.id, { receivedOn: addDays(TODAY, -400) })).status).toBe(422);
    expect((await rec(stay.owner.token, first.id, { tenantId: 'x' })).status).toBe(422); // unknown fields are rejected
    expect((await fresh(stay.owner.token, first.id)).paidPaise).toBe(0);
  });

  it('cannot pay an invoice that is already paid or cancelled', async () => {
    const a = await activeTenant();
    await rec(a.stay.owner.token, a.first.id, { amountPaise: a.first.totalPaise });
    expect((await rec(a.stay.owner.token, a.first.id)).body.error.message).toMatch(/already paid/);
    const b = await activeTenant();
    await rentApi.void(b.stay.owner.token, b.first.id);
    expect((await rec(b.stay.owner.token, b.first.id)).body.error.message).toMatch(/cancelled/);
  });

  it('is only for the right owner: another owner sees 404, the tenant and a guest are refused', async () => {
    const { first, stay, tenant } = await activeTenant();
    const rival = await makeStay();
    expect((await rec(rival.owner.token, first.id)).status).toBe(404);
    expect((await rec(tenant.token, first.id)).status).toBe(403);
    expect((await rec('', first.id)).status).toBe(401);
    expect((await fresh(stay.owner.token, first.id)).paidPaise).toBe(0);
  });

  it('two payments recorded at once can never overpay', async () => {
    const { first, stay } = await activeTenant();
    const half = Math.ceil(first.totalPaise * 0.6);
    const results = await Promise.all([rec(stay.owner.token, first.id, { amountPaise: half }), rec(stay.owner.token, first.id, { amountPaise: half })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect((await fresh(stay.owner.token, first.id)).paidPaise).toBe(half);
  });
});

describe('reversing a payment recorded by mistake', () => {
  it('puts the amount back as owed and keeps the receipt on record, marked reversed', async () => {
    const { first, stay, tenant } = await activeTenant();
    const paid = await rec(stay.owner.token, first.id, { amountPaise: first.totalPaise });
    const paymentId = paid.body.data.payments[0].id as string;
    expect((await rentApi.reverse(stay.owner.token, paymentId, { reason: 'x' })).status).toBe(422);
    const rev = await rentApi.reverse(stay.owner.token, paymentId, { reason: 'Typed the wrong tenant' });
    expect(rev.status).toBe(200);
    expect(rev.body.data).toMatchObject({ status: 'DUE', paidPaise: 0, balancePaise: first.totalPaise });
    expect(rev.body.data.payments[0]).toMatchObject({ reversed: true, canReverse: false, reverseReason: 'Typed the wrong tenant' });
    expect((await rentApi.reverse(stay.owner.token, paymentId)).status).toBe(409); // once only
    expect(await prisma.notification.count({ where: { userId: tenant.id, title: 'Payment reversed' } })).toBe(1);
    expect((await rec(stay.owner.token, first.id, { amountPaise: first.totalPaise })).status).toBe(201); // and it can be paid properly now
  });

  it('a partial payment reversed leaves the rest as it was', async () => {
    const { first, stay } = await activeTenant();
    const a = Math.floor(first.totalPaise / 4);
    await rec(stay.owner.token, first.id, { amountPaise: a, method: 'CASH' });
    const second = await rec(stay.owner.token, first.id, { amountPaise: a, method: 'UPI' });
    const res = await rentApi.reverse(stay.owner.token, second.body.data.payments[1].id);
    expect(res.body.data).toMatchObject({ status: 'PARTIALLY_PAID', paidPaise: a });
  });

  it("only the owner of that property can reverse, and a missing payment is a 404", async () => {
    const { first, stay, tenant } = await activeTenant();
    const paid = await rec(stay.owner.token, first.id, { amountPaise: 1000 });
    const id = paid.body.data.payments[0].id as string;
    const rival = await makeStay();
    expect((await rentApi.reverse(rival.owner.token, id)).status).toBe(404);
    expect((await rentApi.reverse(tenant.token, id)).status).toBe(403);
    expect((await rentApi.reverse(stay.owner.token, '019d0000-0000-7000-8000-000000000000')).status).toBe(404);
  });
});

describe('extra charges and credits', () => {
  it('adds electricity to an open invoice (untaxed), and the tenant is told', async () => {
    const { first, stay, tenant } = await activeTenant({ terms: { rentGstBps: 1800 } });
    const res = await rentApi.addLine(stay.owner.token, first.id, { type: 'ELECTRICITY', description: 'Electricity for March', amountPaise: 45000 });
    expect(res.status).toBe(201);
    expect(res.body.data.lines.map((l: { type: string }) => l.type)).toEqual(['RENT', 'ELECTRICITY']);
    expect(res.body.data).toMatchObject({ subtotalPaise: first.subtotalPaise + 45000, taxPaise: first.taxPaise, totalPaise: first.totalPaise + 45000 }); // GST is on the rent only
    expect(await prisma.notification.count({ where: { userId: tenant.id, title: 'Invoice updated' } })).toBe(1);
  });

  it('a credit reduces the total; a credit bigger than the invoice is refused', async () => {
    const { first, stay } = await activeTenant();
    const res = await rentApi.addLine(stay.owner.token, first.id, { type: 'CREDIT', description: 'Goodwill', amountPaise: 1000 });
    expect(res.body.data).toMatchObject({ totalPaise: first.totalPaise - 1000 });
    expect(res.body.data.lines[1].amountPaise).toBe(-1000);
    const big = await rentApi.addLine(stay.owner.token, first.id, { type: 'CREDIT', description: 'Too much', amountPaise: first.totalPaise + 5 });
    expect(big.status).toBe(422);
  });

  it('a credit cannot undercut what was already paid', async () => {
    const { first, stay } = await activeTenant();
    await rec(stay.owner.token, first.id, { amountPaise: first.totalPaise - 500 });
    const res = await rentApi.addLine(stay.owner.token, first.id, { type: 'CREDIT', description: 'x big', amountPaise: 2000 });
    expect(res.status).toBe(409);
    expect((await rentApi.addLine(stay.owner.token, first.id, { type: 'CREDIT', description: 'fits', amountPaise: 500 })).body.data.status).toBe('PAID'); // exactly what is left: now settled
  });

  it('only an open invoice can change', async () => {
    const { first, stay } = await activeTenant();
    await rec(stay.owner.token, first.id, { amountPaise: first.totalPaise });
    expect((await rentApi.addLine(stay.owner.token, first.id, { type: 'ELECTRICITY', description: 'late bill', amountPaise: 1000 })).status).toBe(409);
    const other = await activeTenant();
    await rentApi.void(other.stay.owner.token, other.first.id);
    expect((await rentApi.addLine(other.stay.owner.token, other.first.id, { type: 'ELECTRICITY', description: 'late bill', amountPaise: 1000 })).status).toBe(409);
  });

  it('validates the charge', async () => {
    const { first, stay, tenant } = await activeTenant();
    for (const body of [{ type: 'RENT', description: 'sneaky', amountPaise: 1000 }, { type: 'LATE_FEE', description: 'sneaky', amountPaise: 1000 }, { type: 'ELECTRICITY', description: 'x', amountPaise: 1000 }, { type: 'ELECTRICITY', description: 'ok desc', amountPaise: 0 }, { type: 'ELECTRICITY', description: 'ok desc', amountPaise: -50 }]) {
      expect((await rentApi.addLine(stay.owner.token, first.id, body)).status, JSON.stringify(body)).toBe(422);
    }
    expect((await rentApi.addLine(tenant.token, first.id, { type: 'ELECTRICITY', description: 'by tenant', amountPaise: 1000 })).status).toBe(403);
  });
});

describe('cancelling an invoice', () => {
  it('voids an unpaid one, tells the tenant, and it no longer counts as owed', async () => {
    const { first, stay, tenant } = await activeTenant();
    expect((await rentApi.void(stay.owner.token, first.id, { reason: 'x' })).status).toBe(422);
    const res = await rentApi.void(stay.owner.token, first.id, { reason: 'Rent waived for March' });
    expect(res.body.data).toMatchObject({ status: 'VOID', voidReason: 'Rent waived for March', actions: [] });
    expect(await prisma.notification.count({ where: { userId: tenant.id, title: 'Invoice cancelled' } })).toBe(1);
    expect((await rentApi.void(stay.owner.token, first.id)).status).toBe(409);
    expect((await rentApi.myInvoice(tenant.token, first.id)).body.data.actions).toEqual([]);
  });

  it('refuses when money was received (reverse it first)', async () => {
    const { first, stay } = await activeTenant();
    const paid = await rec(stay.owner.token, first.id, { amountPaise: 1000 });
    const res = await rentApi.void(stay.owner.token, first.id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Reverse them first/);
    await rentApi.reverse(stay.owner.token, paid.body.data.payments[0].id);
    expect((await rentApi.void(stay.owner.token, first.id)).status).toBe(200);
  });
});

describe('late fees and reminders', () => {
  it('adds the late fee once, after the grace period, and never to a paid invoice', async () => {
    const late = await activeTenant({ terms: { rentLateFeePaise: 20000, rentGraceDays: 2 } });
    const paid = await activeTenant({ terms: { rentLateFeePaise: 20000, rentGraceDays: 2 } });
    await rec(paid.stay.owner.token, paid.first.id, { amountPaise: paid.first.totalPaise });
    const onGraceDay = at(addDays(late.first.dueDate, 2));
    await sweepRent(onGraceDay);
    expect((await fresh(late.stay.owner.token, late.first.id)).lines).toHaveLength(1); // still within grace

    await sweepRent(at(addDays(late.first.dueDate, 3)));
    const after = await fresh(late.stay.owner.token, late.first.id);
    expect(after.lines.map((l) => l.type)).toEqual(['RENT', 'LATE_FEE']);
    expect(after.totalPaise).toBe(late.first.totalPaise + 20000);
    expect((await prisma.rentInvoice.findUniqueOrThrow({ where: { id: late.first.id } })).overdueAfter.toISOString().slice(0, 10)).toBe(addDays(late.first.dueDate, 2)); // due date + grace
    expect((await prisma.rentInvoice.findUniqueOrThrow({ where: { id: late.first.id } })).lateFeeAppliedAt).not.toBeNull();

    await sweepRent(at(addDays(late.first.dueDate, 20)));
    expect((await fresh(late.stay.owner.token, late.first.id)).lines.filter((l) => l.type === 'LATE_FEE')).toHaveLength(1); // once only
    expect((await fresh(paid.stay.owner.token, paid.first.id)).lines.filter((l) => l.type === 'LATE_FEE')).toHaveLength(0);
  });

  it('charges no late fee when the property has none', async () => {
    const { first, stay } = await activeTenant();
    await sweepRent(at(addDays(first.dueDate, 30)));
    expect((await fresh(stay.owner.token, first.id)).lines.filter((l) => l.type === 'LATE_FEE')).toHaveLength(0);
  });

  it('reminds once before the due date, and then about overdue rent at most weekly, to the tenant and the owner', async () => {
    const { first, stay, tenant } = await activeTenant();
    const count = (userId: string, type: 'RENT_DUE_SOON' | 'RENT_OVERDUE') => prisma.notification.count({ where: { userId, type } });
    await sweepRent(at(addDays(first.dueDate, -2)));
    const soon = await count(tenant.id, 'RENT_DUE_SOON');
    await sweepRent(at(addDays(first.dueDate, -2)));
    expect(await count(tenant.id, 'RENT_DUE_SOON')).toBe(soon); // not sent twice

    const overdueDay = addDays(first.dueDate, 6); // default grace is 5 days
    await sweepRent(at(overdueDay));
    expect(await count(tenant.id, 'RENT_OVERDUE')).toBe(1);
    expect(await count(stay.owner.id, 'RENT_OVERDUE')).toBe(1);
    await sweepRent(at(addDays(overdueDay, 3)));
    expect(await count(tenant.id, 'RENT_OVERDUE')).toBe(1); // too soon for another
    await sweepRent(at(addDays(overdueDay, 8)));
    expect(await count(tenant.id, 'RENT_OVERDUE')).toBe(2); // a week later
  });

  it('sends no reminders for a paid invoice, and respects the tenant\'s rent-email setting', async () => {
    const { first, stay, tenant } = await activeTenant();
    await prisma.notificationPreference.create({ data: { userId: tenant.id, emailRent: false } });
    outbox.length = 0;
    await sweepRent(at(addDays(first.dueDate, 10)));
    expect(outbox.filter((m) => m.to === tenant.email && m.subject === 'Rent overdue')).toHaveLength(0); // in-app only
    expect(await prisma.notification.count({ where: { userId: tenant.id, type: 'RENT_OVERDUE' } })).toBe(1);

    const other = await activeTenant();
    await rec(other.stay.owner.token, other.first.id, { amountPaise: other.first.totalPaise });
    await sweepRent(at(addDays(other.first.dueDate, 10)));
    expect(await prisma.notification.count({ where: { userId: other.tenant.id, type: 'RENT_OVERDUE' } })).toBe(0);
    void stay;
  });
});

void student;
