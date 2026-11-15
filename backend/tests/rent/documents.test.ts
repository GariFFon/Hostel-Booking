import { describe, expect, it } from 'vitest';
import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { makeUser } from '../helpers/users';
import { makeStay, student } from '../helpers/tenancy';
import { TODAY, docApi, openReceipt, rentApi } from '../helpers/rent';
import { endedStay, mo, tenantWithDeposit } from '../helpers/moveout';

/** A PDF is only valid if its cross-reference table points at real objects. */
function assertWellFormed(pdf: string) {
  expect(pdf.startsWith('%PDF-1.4')).toBe(true);
  expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  const start = Number(/startxref\n(\d+)/.exec(pdf)![1]);
  expect(pdf.slice(start, start + 4)).toBe('xref');
  [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1])).forEach((o, i) => expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
}
const open = async (res: { status: number; body: { data: { url: string } } }) => {
  expect(res.status).toBe(200);
  const r = await openReceipt(res.body.data.url);
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toBe('application/pdf');
  assertWellFormed(r.text);
  return { ...r, text: r.text.replace(/\\([()\\])/g, '$1') }; // the PDF escapes brackets and backslashes inside its strings
};

describe('rent invoices as PDFs', () => {
  it('shows who is billed, what for, the charges and what is still owed', async () => {
    const { stay, tenant, first } = await tenantWithDeposit();
    const r = await open(await docApi.myInvoice(tenant.token, first.id));
    expect(r.headers.get('content-disposition')).toBe(`inline; filename="invoice-${first.number}.pdf"`);
    for (const must of [first.number, 'RENT INVOICE', stay.hostel.name, 'CHARGES', 'Balance due', 'DUE', 'Rent for']) expect(r.text).toContain(must);
    expect(r.text).not.toContain('PAYMENTS'); // nothing paid yet
  });

  it('lists payments, and says PAID, PART PAID, OVERDUE or CANCELLED as it is', async () => {
    const paid = await tenantWithDeposit();
    await rentApi.record(paid.stay.owner.token, paid.first.id, { amountPaise: paid.first.totalPaise, method: 'UPI', receivedOn: TODAY, reference: 'UTR9' });
    const a = await open(await docApi.ownerInvoice(paid.stay.owner.token, paid.first.id));
    for (const must of ['PAID', 'PAYMENTS', 'UPI', 'RCPT-']) expect(a.text).toContain(must);

    const part = await tenantWithDeposit();
    await rentApi.record(part.stay.owner.token, part.first.id, { amountPaise: 1000, method: 'CASH', receivedOn: TODAY });
    expect((await open(await docApi.adminInvoice((await makeUser({ roles: ['ADMIN'] })).token, part.first.id))).text).toContain('PART PAID');

    const late = await tenantWithDeposit();
    await prisma.rentInvoice.update({ where: { id: late.first.id }, data: { overdueAfter: new Date(`${addDays(TODAY, -3)}T00:00:00Z`) } });
    expect((await open(await docApi.myInvoice(late.tenant.token, late.first.id))).text).toContain('OVERDUE');

    const cancelled = await tenantWithDeposit();
    await rentApi.void(cancelled.stay.owner.token, cancelled.first.id, { reason: 'Issued by mistake' });
    const c = await open(await docApi.myInvoice(cancelled.tenant.token, cancelled.first.id));
    for (const must of ['CANCELLED', 'Issued by mistake', 'Balance (invoice cancelled)']) expect(c.text).toContain(must);
  });

  it('shows GST, and a reversed payment is marked as such', async () => {
    const t = await tenantWithDeposit();
    await prisma.rentInvoice.update({ where: { id: t.first.id }, data: { gstRateBps: 500, taxPaise: 1000, totalPaise: t.first.totalPaise + 1000 } });
    await rentApi.record(t.stay.owner.token, t.first.id, { amountPaise: 5000, method: 'CASH', receivedOn: TODAY });
    const pay = (await rentApi.ownerInvoice(t.stay.owner.token, t.first.id)).body.data.payments[0];
    await rentApi.reverse(t.stay.owner.token, pay.id);
    const r = await open(await docApi.myInvoice(t.tenant.token, t.first.id));
    expect(r.text).toContain('GST (5% on rent)');
    expect(r.text).toContain('(reversed)');
  });

  it('stays one valid page however many charges there are', async () => {
    const t = await tenantWithDeposit();
    for (let i = 0; i < 40; i++) await prisma.rentInvoiceLine.create({ data: { invoiceId: t.first.id, type: 'MAINTENANCE', description: `Maintenance item ${i}`, amountPaise: 100 } });
    const r = await open(await docApi.myInvoice(t.tenant.token, t.first.id));
    expect(r.text).toMatch(/and \d+ more charges/);
  });

  it('is for the tenant it is billed to, the property owner and admins, and for nobody else', async () => {
    const t = await tenantWithDeposit();
    expect((await docApi.myInvoice((await student()).token, t.first.id)).status).toBe(404);
    expect((await docApi.ownerInvoice((await makeStay()).owner.token, t.first.id)).status).toBe(404);
    expect((await docApi.ownerInvoice(t.tenant.token, t.first.id)).status).toBe(403);
    expect((await docApi.adminInvoice(t.stay.owner.token, t.first.id)).status).toBe(403);
    expect((await docApi.myInvoice(t.tenant.token, '01a1df4d-2583-7141-9882-3b725fcea871')).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: 'rent.invoice.pdf_link', entityId: t.first.id } })).toBe(0); // refused requests are not links
    await docApi.myInvoice(t.tenant.token, t.first.id);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'rent.invoice.pdf_link', entityId: t.first.id } });
    expect(audit.metadata).toMatchObject({ hostelId: t.stay.hostel.id });
  });

  it('a link for one kind of document cannot be turned into another', async () => {
    const t = await tenantWithDeposit();
    const link = (await docApi.myInvoice(t.tenant.token, t.first.id)).body.data.url as string;
    const [payload, sig] = link.split('/receipts/')[1]!.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), k: 'deposit' })).toString('base64url');
    expect((await openReceipt(`${link.split('/receipts/')[0]}/receipts/${forged}.${sig}`)).status).toBe(404);
  });
});

describe('security-deposit receipts', () => {
  it('exist once a deposit was received, and say how it was paid and who holds it', async () => {
    const stay = await makeStay();
    const { approvedTenant } = await import('../helpers/tenancy');
    const pending = await approvedTenant(stay, { depositPaise: 1_200_000 });
    const before = await docApi.myDeposit(pending.tenant.token, pending.tenancyId);
    expect(before.status).toBe(409);
    expect(JSON.stringify(before.body)).toMatch(/No deposit has been received/);

    const cash = await tenantWithDeposit();
    const a = await open(await docApi.myDeposit(cash.tenant.token, cash.tenancyId));
    for (const must of ['SECURITY DEPOSIT RECEIPT', 'HELD', 'Amount', 'Rs 12,000', 'held by the property owner', cash.stay.hostel.name]) expect(a.text).toContain(must);
    expect(a.text).toMatch(/DEP-TN-/);
    expect(a.text).not.toContain('SETTLEMENT');

    const online = await tenantWithDeposit({ online: true });
    const b = await open(await docApi.ownerDeposit(online.stay.owner.token, online.tenancyId));
    expect(b.text).toContain('held by Hostel Booking until the stay ends');
  });

  it('shows the settlement once the owner has sent it, and SETTLED with the refund when it is complete', async () => {
    const e = await endedStay();
    expect((await open(await docApi.myDeposit(e.tenant.token, e.tenancyId))).text).not.toContain('SETTLEMENT'); // still the owner's draft
    await mo.save(e.stay.owner.token, e.tenancyId, { deductions: [{ type: 'DAMAGE', description: 'Broken window latch', amountPaise: 200_000 }] });
    await mo.propose(e.stay.owner.token, e.tenancyId);
    const sent = await open(await docApi.myDeposit(e.tenant.token, e.tenancyId));
    expect(sent.text).toContain('WAITING FOR THE TENANT');
    expect(sent.text).toContain('Broken window latch');
    await mo.accept(e.tenant.token, e.tenancyId);
    await mo.payout(e.stay.owner.token, e.tenancyId, { method: 'UPI' });
    const done = await open(await docApi.adminDeposit((await makeUser({ roles: ['ADMIN'] })).token, e.tenancyId));
    for (const must of ['SETTLED', 'SETTLEMENT', 'Broken window latch', 'Returned to the tenant', 'Rs 10,000', 'Paid back by UPI']) expect(done.text).toContain(must);
  });

  it('is for the stay\'s tenant, its owner and admins only', async () => {
    const t = await tenantWithDeposit();
    expect((await docApi.myDeposit((await student()).token, t.tenancyId)).status).toBe(404);
    expect((await docApi.ownerDeposit((await makeStay()).owner.token, t.tenancyId)).status).toBe(404);
    expect((await docApi.ownerDeposit(t.tenant.token, t.tenancyId)).status).toBe(403);
    expect((await docApi.adminDeposit(t.stay.owner.token, t.tenancyId)).status).toBe(403);
    expect((await docApi.myDeposit(t.tenant.token, '01a1df4d-2583-7141-9882-3b725fcea871')).status).toBe(404);
    await docApi.ownerDeposit(t.stay.owner.token, t.tenancyId);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'tenancy.deposit.receipt_link', entityId: t.tenancyId } })).metadata).toMatchObject({ hostelId: t.stay.hostel.id });
  });
});
