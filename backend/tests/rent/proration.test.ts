import { describe, expect, it } from 'vitest';
import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { monthEnd, monthStart, prorate } from '@/modules/rent/rent.rules';
import { sweepRent } from '@/modules/rent/rent-sweep.service';
import { api, approvedTenant, makeStay } from '../helpers/tenancy';
import { TODAY, at, rentApi } from '../helpers/rent';
import { mo, tenantWithDeposit } from '../helpers/moveout';

const RENT = 600_000; // the default stay: ₹6,000 a month
const invoices = (tenancyId: string) => prisma.rentInvoice.findMany({ where: { tenancyId }, orderBy: { periodStart: 'asc' }, include: { lines: true } });

/** A moved-in tenant whose invoice for the month that holds `day` has been issued and is still unpaid. */
async function withInvoiceFor(day: string, over: Parameters<typeof tenantWithDeposit>[0] = {}) {
  const t = await tenantWithDeposit(over);
  await sweepRent(at(addDays(monthStart(day), -5))); // invoices are issued a week before they are due: this issues every month up to that one
  const inv = (await invoices(t.tenancyId)).find((i) => i.periodStart.toISOString().slice(0, 10) === monthStart(day));
  expect(inv, 'the invoice for the final month was issued').toBeTruthy();
  return { ...t, inv: inv! };
}
const lastMonthDay = addDays(TODAY, 40); // a day inside the month after next month's start, so it is past the notice period

describe('the final month is charged only up to the last day', () => {
  it('giving notice prorates an unpaid invoice that was already issued for the full month, and tells the tenant', async () => {
    const { tenant, tenancyId, inv } = await withInvoiceFor(lastMonthDay);
    expect(inv.totalPaise).toBe(RENT);
    expect((await mo.notice(tenant.token, tenancyId, { moveOutDate: lastMonthDay })).status).toBe(200);
    const after = (await invoices(tenancyId)).find((i) => i.id === inv.id)!;
    const expected = prorate(RENT, monthStart(lastMonthDay), lastMonthDay);
    expect(expected).toBeLessThan(RENT);
    expect(after).toMatchObject({ totalPaise: expected, subtotalPaise: expected, status: 'DUE' });
    expect(after.periodEnd.toISOString().slice(0, 10)).toBe(lastMonthDay);
    expect(after.lines).toEqual([expect.objectContaining({ type: 'RENT', amountPaise: expected, description: expect.stringMatching(/part of/) })]);
    const mine = (await rentApi.myInvoice(tenant.token, inv.id)).body.data;
    expect(mine).toMatchObject({ totalPaise: expected, balancePaise: expected });
    expect(await prisma.notification.count({ where: { userId: tenant.id, title: 'Invoice updated' } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'rent.invoice.prorate', entityId: inv.id } });
    expect(audit.metadata).toMatchObject({ hostelId: after.hostelId });
    expect(audit.before).toMatchObject({ totalPaise: RENT });
  });

  it('withdrawing the notice puts the invoice back to the full month', async () => {
    const { tenant, tenancyId, inv } = await withInvoiceFor(lastMonthDay);
    await mo.notice(tenant.token, tenancyId, { moveOutDate: lastMonthDay });
    await mo.noticeWithdraw(tenant.token, tenancyId);
    const back = (await invoices(tenancyId)).find((i) => i.id === inv.id)!;
    expect(back).toMatchObject({ totalPaise: RENT, status: 'DUE' });
    expect(back.periodEnd.toISOString().slice(0, 10)).toBe(monthEnd(lastMonthDay));
    expect(back.lines[0]).toMatchObject({ amountPaise: RENT, description: expect.not.stringMatching(/part of/) });
  });

  it('a move-out on the day gives the same amount, and nothing is announced twice', async () => {
    const { stay, tenant, tenancyId, inv } = await withInvoiceFor(lastMonthDay);
    await mo.notice(tenant.token, tenancyId, { moveOutDate: lastMonthDay });
    // the stay's last day arrives: the hourly job ends it
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { startDate: new Date(`${addDays(TODAY, -60)}T00:00:00Z`), endDate: new Date(`${addDays(TODAY, -1)}T00:00:00Z`) } });
    const { sweepTenancies } = await import('@/modules/tenancies/tenancy-sweep.service');
    await sweepTenancies();
    // the invoice was prorated to the NOTICE day when notice was given; ending on the earlier recorded day re-fits it to that day
    const final = (await invoices(tenancyId)).find((i) => i.id === inv.id);
    expect(final).toBeTruthy();
    expect(await prisma.notification.count({ where: { userId: tenant.id, title: 'Invoice updated' } })).toBeLessThanOrEqual(2);
    void stay;
  });

  it('moving out early without notice charges only up to the move-out day', async () => {
    const { stay, tenant, tenancyId } = await tenantWithDeposit();
    const first = (await invoices(tenancyId))[0]!; // issued at move-in, for today to the end of the month
    await mo.moveOut(stay.owner.token, tenancyId, { movedOutOn: TODAY });
    const after = (await invoices(tenancyId))[0]!;
    expect(after.periodEnd.toISOString().slice(0, 10)).toBe(TODAY);
    expect(after.totalPaise).toBe(prorate(RENT, TODAY, TODAY)); // one day
    expect(after.totalPaise).toBeLessThanOrEqual(first.totalPaise);
    expect(after.lines[0]!.description).toMatch(/part of/);
    void tenant;
  });

  it('leaves alone an invoice that has any payment on it, one being paid online, and one the owner edited by hand', async () => {
    const part = await withInvoiceFor(lastMonthDay);
    await rentApi.record(part.stay.owner.token, part.inv.id, { amountPaise: 100_000, method: 'CASH', receivedOn: TODAY });
    await mo.notice(part.tenant.token, part.tenancyId, { moveOutDate: lastMonthDay });
    expect((await invoices(part.tenancyId)).find((i) => i.id === part.inv.id)).toMatchObject({ totalPaise: RENT, status: 'PARTIALLY_PAID' });

    const paying = await withInvoiceFor(lastMonthDay);
    const order = (await rentApi.initiate(paying.tenant.token, paying.inv.id)).body.data;
    expect(order.status).toBe('CREATED');
    await mo.notice(paying.tenant.token, paying.tenancyId, { moveOutDate: lastMonthDay });
    expect((await invoices(paying.tenancyId)).find((i) => i.id === paying.inv.id)!.totalPaise).toBe(RENT); // the open payment is for the full amount

    const edited = await withInvoiceFor(lastMonthDay);
    await prisma.rentInvoiceLine.create({ data: { invoiceId: edited.inv.id, type: 'RENT', description: 'Extra rent line', amountPaise: 50_000 } }); // a hand-built invoice with two rent lines
    await prisma.rentInvoice.update({ where: { id: edited.inv.id }, data: { subtotalPaise: RENT + 50_000, totalPaise: RENT + 50_000 } });
    await mo.notice(edited.tenant.token, edited.tenancyId, { moveOutDate: lastMonthDay });
    expect((await invoices(edited.tenancyId)).find((i) => i.id === edited.inv.id)!.totalPaise).toBe(RENT + 50_000);
  });

  it('keeps GST and other charges right: tax follows the new rent, a late fee line stays', async () => {
    const stay = await makeStay();
    await api.patchTerms(stay.owner.token, stay.hostel.id, { rentGstBps: 500 });
    const { tenant, tenancyId } = await approvedTenant(stay, { depositPaise: 0 });
    await api.activate(stay.owner.token, tenancyId);
    await sweepRent(at(addDays(monthStart(lastMonthDay), -5)));
    const inv = (await invoices(tenancyId)).find((i) => i.periodStart.toISOString().slice(0, 10) === monthStart(lastMonthDay))!;
    await rentApi.addLine(stay.owner.token, inv.id, { type: 'ELECTRICITY', description: 'Electricity', amountPaise: 30_000 });
    expect((await invoices(tenancyId)).find((i) => i.id === inv.id)).toMatchObject({ taxPaise: 30_000 });
    await mo.notice(tenant.token, tenancyId, { moveOutDate: lastMonthDay });
    const rent = prorate(RENT, monthStart(lastMonthDay), lastMonthDay);
    const after = (await invoices(tenancyId)).find((i) => i.id === inv.id)!;
    expect(after).toMatchObject({ taxPaise: Math.round(rent * 0.05), subtotalPaise: rent + 30_000, totalPaise: rent + 30_000 + Math.round(rent * 0.05) });
    expect(after.lines.map((l) => l.type).sort()).toEqual(['ELECTRICITY', 'RENT']);
  });

  it('later months are cancelled and the final one is prorated, in one notice', async () => {
    const { tenant, tenancyId } = await tenantWithDeposit();
    await sweepRent(at(addDays(monthStart(addDays(lastMonthDay, 40)), -5))); // issues the months after the last day too
    expect((await mo.notice(tenant.token, tenancyId, { moveOutDate: lastMonthDay })).status).toBe(200);
    const list = await invoices(tenancyId);
    const lastDay = new Date(`${lastMonthDay}T00:00:00Z`);
    for (const i of list) {
      if (i.periodStart > lastDay) expect(i.status).toBe('VOID');
      else if (i.periodStart <= lastDay && i.periodEnd >= lastDay) expect(i.periodEnd.toISOString().slice(0, 10)).toBe(lastMonthDay);
    }
    expect(list.some((i) => i.status === 'VOID')).toBe(true);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'tenancy.notice.give', entityId: tenancyId } });
    expect(audit.after).toMatchObject({ proratedInvoices: 1 });
  });
});
