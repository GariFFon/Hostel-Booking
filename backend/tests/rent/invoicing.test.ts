import { describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { sweepRent } from '@/modules/rent/rent-sweep.service';
import { dueDateFor, nextPeriod } from '@/modules/rent/rent.rules';
import { api, makeStay, student } from '../helpers/tenancy';
import { makeUser } from '../helpers/users';
import { TODAY, activeTenant, addDays, at, invoicesOf, rentApi } from '../helpers/rent';

const RENT = 600000;
const firstPlan = (over: { dueDay?: number; rentPaise?: number } = {}) => nextPeriod({ billingFrom: TODAY, rentPaise: over.rentPaise ?? RENT, dueDay: over.dueDay ?? 1, endDate: null }, null)!;

describe('the first invoice, issued at move-in', () => {
  it('bills from the day of move-in (prorated mid-month), with one rent line', async () => {
    const { first, tenant } = await activeTenant();
    const plan = firstPlan();
    expect(first).toMatchObject({ status: 'DUE', periodStart: TODAY, periodEnd: plan.periodEnd, dueDate: plan.dueDate, subtotalPaise: plan.rentPaise, taxPaise: 0, totalPaise: plan.rentPaise, paidPaise: 0, balancePaise: plan.rentPaise });
    expect(first.lines).toHaveLength(1);
    expect(first.lines[0]).toMatchObject({ type: 'RENT', amountPaise: plan.rentPaise });
    expect(first.number).toMatch(/^INV-\d{4}-[A-Z2-9]{6}$/);
    expect(first.actions).toEqual(['pay']); // the tenant can pay it
    expect(await prisma.notification.count({ where: { userId: tenant.id, type: 'RENT_INVOICE_ISSUED' } })).toBe(1);
  });

  it('is audited against the property', async () => {
    const { first, stay } = await activeTenant();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'rent.invoice.issue', entityId: first.id } });
    expect(audit.metadata).toMatchObject({ hostelId: stay.hostel.id });
  });

  it('charges GST only when the property sets it, snapshotting the rate on the tenancy and invoice', async () => {
    const { first, stay, tenancyId } = await activeTenant({ terms: { rentGstBps: 500 } });
    const rent = firstPlan().rentPaise;
    expect(first).toMatchObject({ gstRateBps: 500, subtotalPaise: rent, taxPaise: Math.round(rent * 0.05), totalPaise: rent + Math.round(rent * 0.05) });
    await api.patchTerms(stay.owner.token, stay.hostel.id, { rentGstBps: 1800 }); // changing the property later never changes an existing stay
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).gstRateBps).toBe(500);
  });

  it('never back-bills history: a long-time resident added with an old start date is billed from move-in only', async () => {
    const stay = await makeStay();
    const s = await student();
    const created = await api.createTenancy(stay.owner.token, { roomTypeId: stay.room.id, tenantEmail: s.email, startDate: addDays(TODAY, -180), depositPaise: 0 });
    await api.accept(s.token, created.body.data.id);
    await api.activate(stay.owner.token, created.body.data.id);
    const invoices = await invoicesOf(created.body.data.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.periodStart.toISOString().slice(0, 10)).toBe(TODAY);
  });

  it('a stay that is not running yet has no invoices', async () => {
    const stay = await makeStay();
    const s = await student();
    const created = await api.createTenancy(stay.owner.token, { roomTypeId: stay.room.id, tenantEmail: s.email, startDate: addDays(TODAY, 3), depositPaise: 0 });
    await api.accept(s.token, created.body.data.id); // PENDING_MOVE_IN
    await sweepRent(at(addDays(TODAY, 40)));
    expect(await invoicesOf(created.body.data.id)).toHaveLength(0);
  });
});

describe('the monthly sweep', () => {
  it('issues the next invoice a week before it is due, and not before', async () => {
    const { tenancyId, tenant } = await activeTenant();
    const plan2 = nextPeriod({ billingFrom: TODAY, rentPaise: RENT, dueDay: 1, endDate: null }, firstPlan().periodStart)!;
    await sweepRent(at(addDays(plan2.dueDate, -8)));
    expect(await invoicesOf(tenancyId)).toHaveLength(1);
    await sweepRent(at(addDays(plan2.dueDate, -7)));
    const all = await invoicesOf(tenancyId);
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ totalPaise: RENT, status: 'DUE' });
    expect(all[1]!.periodStart.toISOString().slice(0, 10)).toBe(plan2.periodStart);
    expect(all[1]!.dueDate.toISOString().slice(0, 10)).toBe(plan2.dueDate);
    expect(await prisma.notification.count({ where: { userId: tenant.id, type: 'RENT_INVOICE_ISSUED' } })).toBe(2);
  });

  it('is safe to run again and again', async () => {
    const { tenancyId } = await activeTenant();
    const when = at(addDays(TODAY, 70));
    await sweepRent(when);
    const after = (await invoicesOf(tenancyId)).length;
    expect(after).toBeGreaterThanOrEqual(2);
    expect((await sweepRent(when)).issued).toBe(0);
    expect(await invoicesOf(tenancyId)).toHaveLength(after);
  });

  it('catches up on every missed month, in order, without gaps', async () => {
    const { tenancyId } = await activeTenant();
    await sweepRent(at(addDays(TODAY, 130))); // the worker was down for ~4 months
    const starts = (await invoicesOf(tenancyId)).map((i) => i.periodStart.toISOString().slice(0, 10));
    expect(starts.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < starts.length; i++) expect(starts[i]!.slice(8)).toBe('01'); // later periods are whole calendar months
    expect(new Set(starts).size).toBe(starts.length);
    expect([...starts].sort()).toEqual(starts);
  });

  it('uses the tenancy due day, clamped to 1-28', async () => {
    const { tenancyId } = await activeTenant({ terms: { rentDueDay: 28 } });
    await sweepRent(at(addDays(TODAY, 70)));
    const second = (await invoicesOf(tenancyId))[1]!;
    expect(second.dueDate.toISOString().slice(0, 10)).toBe(dueDateFor(second.periodStart.toISOString().slice(0, 10), 28));
  });

  it('does not bill a cancelled or ended stay', async () => {
    const stay = await makeStay();
    const s = await student();
    const created = await api.createTenancy(stay.owner.token, { roomTypeId: stay.room.id, tenantEmail: s.email, startDate: TODAY, depositPaise: 0 });
    await api.accept(s.token, created.body.data.id);
    await api.cancel(stay.owner.token, created.body.data.id);
    await sweepRent(at(addDays(TODAY, 90)));
    expect(await invoicesOf(created.body.data.id)).toHaveLength(0);
  });

  it('a voided period is not billed again', async () => {
    const { tenancyId, first, stay } = await activeTenant();
    await rentApi.void(stay.owner.token, first.id);
    await sweepRent(at(addDays(first.dueDate, 1)));
    expect((await invoicesOf(tenancyId)).filter((i) => i.periodStart.toISOString().slice(0, 10) === first.periodStart)).toHaveLength(1);
  });
});

describe('who can see an invoice', () => {
  it("the tenant sees their own; another tenant, another owner and a stranger see nothing; the right owner and admin can", async () => {
    const { first, tenant, stay, tenancyId } = await activeTenant();
    expect((await rentApi.myInvoices(tenant.token)).body.data.map((i: { id: string }) => i.id)).toContain(first.id);
    const other = await student();
    expect((await rentApi.myInvoices(other.token)).body.data).toEqual([]);
    expect((await rentApi.myInvoice(other.token, first.id)).status).toBe(404);
    expect((await rentApi.myInvoice(tenant.token, first.id)).status).toBe(200);

    expect((await rentApi.ownerInvoice(stay.owner.token, first.id)).body.data.actions).toEqual(['record_payment', 'add_line', 'void']);
    const rival = await makeStay();
    expect((await rentApi.ownerInvoice(rival.owner.token, first.id)).status).toBe(404);
    expect((await rentApi.ownerInvoices(rival.owner.token)).body.data).toEqual([]);
    expect((await rentApi.ownerInvoice(tenant.token, first.id)).status).toBe(403);

    const admin = await makeUser({ roles: ['ADMIN'] });
    expect((await rentApi.adminInvoices(admin.token, `?tenancyId=${tenancyId}`)).body.data.map((i: { id: string }) => i.id)).toEqual([first.id]);
    expect((await rentApi.adminInvoices(stay.owner.token)).status).toBe(403);
  });

  it('the owner can filter by month, status and property; anonymous callers are refused', async () => {
    const { first, stay } = await activeTenant();
    const list = (q: string) => rentApi.ownerInvoices(stay.owner.token, q).then((r) => r.body.data.map((i: { id: string }) => i.id));
    expect(await list(`?month=${TODAY.slice(0, 7)}`)).toContain(first.id);
    expect(await list('?month=2020-01')).toEqual([]);
    expect(await list('?status=PAID')).toEqual([]);
    expect(await list(`?hostelId=${stay.hostel.id}&status=DUE`)).toContain(first.id);
    expect((await rentApi.ownerInvoices(stay.owner.token, '?month=2027-13')).status).toBe(422);
    expect((await rentApi.myInvoices('')).status).toBe(401);
  });
});

describe('database guarantees', () => {
  it('one invoice per tenancy and period; the money must add up; only a credit is negative', async () => {
    const { first, tenancyId, stay, tenant } = await activeTenant();
    const row = await prisma.rentInvoice.findUniqueOrThrow({ where: { id: first.id } });
    const base = { tenancyId, hostelId: stay.hostel.id, tenantId: tenant.id, periodStart: row.periodStart, periodEnd: row.periodEnd, dueDate: row.dueDate, overdueAfter: row.overdueAfter, subtotalPaise: 100, taxPaise: 0, totalPaise: 100 };
    await expect(prisma.rentInvoice.create({ data: { ...base, number: 'INV-DUP-1' } })).rejects.toThrow(); // same tenancy and period
    const next = new Date(row.periodStart.getTime() + 40 * 86_400_000);
    await expect(prisma.rentInvoice.create({ data: { ...base, number: 'INV-BAD-2', periodStart: next, periodEnd: next, totalPaise: 999 } })).rejects.toThrow(); // total <> subtotal + tax
    await expect(prisma.rentInvoiceLine.create({ data: { invoiceId: first.id, type: 'ELECTRICITY', description: 'x', amountPaise: -5 } })).rejects.toThrow(); // only a credit may be negative
    await expect(prisma.rentInvoiceLine.create({ data: { invoiceId: first.id, type: 'CREDIT', description: 'x', amountPaise: 5 } })).rejects.toThrow(); // a credit must be negative
  });
});
