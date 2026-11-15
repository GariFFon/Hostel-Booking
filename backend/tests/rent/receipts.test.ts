import { describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { DemoProvider } from '@/infra/payments/demo.provider';
import { setPaymentProvider } from '@/infra/payments/provider';
import { RECEIPT_LINK_TTL_MS, rentReceiptsService, signReceiptToken, verifyReceiptToken } from '@/modules/rent/rent-receipts.service';
import { buildPdf } from '@/modules/rent/receipt-pdf';
import { makeUser } from '../helpers/users';
import { makeStay, student } from '../helpers/tenancy';
import { TODAY, activeTenant, openReceipt, payOnline, rentApi } from '../helpers/rent';

/** A PDF is only valid if its cross-reference table points at real objects: check that, not just the header. */
function assertWellFormed(pdf: string) {
  expect(pdf.startsWith('%PDF-1.4')).toBe(true);
  expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  const start = Number(/startxref\n(\d+)/.exec(pdf)![1]);
  expect(pdf.slice(start, start + 4)).toBe('xref');
  const offsets = [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  expect(offsets.length).toBeGreaterThanOrEqual(7);
  offsets.forEach((o, i) => expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
}

describe('the PDF writer', () => {
  it('makes a well-formed one-page document with the text on it', () => {
    const pdf = buildPdf({ title: 'Test (1)', lines: [{ text: 'Hello (world) \\ ₹500 — café', x: 50, y: 700, bold: true }], rules: [{ x1: 50, x2: 500, y: 690 }], boxes: [{ x: 0, y: 770, w: 595, h: 72, gray: 0.1 }] }).toString('latin1');
    assertWellFormed(pdf);
    expect(pdf).toContain('Hello \\(world\\) \\\\ Rs 500 - caf\xe9'); // brackets and backslashes escaped; the rupee sign spelled out
    expect(pdf).toContain('/Length ');
    const declared = Number(/\/Length (\d+)/.exec(pdf)![1]);
    const stream = pdf.slice(pdf.indexOf('stream\n') + 7, pdf.indexOf('endstream'));
    expect(stream.length).toBe(declared);
  });
});

describe('receipt links', () => {
  it('are signed, expire after five minutes, and cannot be forged or moved to another payment', () => {
    const now = new Date();
    const { token, expiresAt } = signReceiptToken('11111111-1111-7111-8111-111111111111', now);
    expect(expiresAt.getTime() - now.getTime()).toBe(RECEIPT_LINK_TTL_MS);
    expect(verifyReceiptToken(token, now)).toBe('11111111-1111-7111-8111-111111111111');
    expect(() => verifyReceiptToken(token, new Date(now.getTime() + RECEIPT_LINK_TTL_MS + 1000))).toThrow();
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ p: '22222222-2222-7222-8222-222222222222', e: now.getTime() + 999_999_999 })).toString('base64url');
    expect(() => verifyReceiptToken(`${forged}.${sig}`, now)).toThrow(); // same signature, different payment
    expect(() => verifyReceiptToken(`${payload}.${sig!.slice(0, -2)}xx`, now)).toThrow();
    for (const junk of ['', 'abc', 'a.b', `${payload}.`, '.']) expect(() => verifyReceiptToken(junk, now)).toThrow();
  });

  it('give the tenant, the owner and an admin their receipt, and nobody else', async () => {
    setPaymentProvider(new DemoProvider());
    const t = await activeTenant();
    const payment = await payOnline(t.tenant.token, t.stay.owner.token, t.first.id);
    const admin = await makeUser({ roles: ['ADMIN'] });
    for (const link of [await rentApi.myLink(t.tenant.token, payment.id), await rentApi.ownerLink(t.stay.owner.token, payment.id), await rentApi.adminLink(admin.token, payment.id)]) {
      expect(link.status).toBe(200);
      expect(link.body.data.url).toMatch(/\/api\/v1\/receipts\/.+\..+$/);
      expect(new Date(link.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    }
    expect((await rentApi.myLink((await student()).token, payment.id)).status).toBe(404); // another tenant
    expect((await rentApi.ownerLink((await makeStay()).owner.token, payment.id)).status).toBe(404); // another owner
    expect((await rentApi.ownerLink(t.tenant.token, payment.id)).status).toBe(403);
    expect((await rentApi.adminLink(t.stay.owner.token, payment.id)).status).toBe(403);
    expect((await rentApi.myLink(t.tenant.token, '01a1df4d-2583-7141-9882-3b725fcea871')).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: 'rent.receipt.link', entityId: payment.id } })).toBe(3);
  });

  it('open without a login, as a real PDF with the receipt on it', async () => {
    setPaymentProvider(new DemoProvider());
    const t = await activeTenant();
    const payment = await payOnline(t.tenant.token, t.stay.owner.token, t.first.id);
    const link = (await rentApi.myLink(t.tenant.token, payment.id)).body.data;
    const res = await openReceipt(link.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(`inline; filename="receipt-${payment.receiptNo}.pdf"`);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Number(res.headers.get('content-length'))).toBe(res.bytes.length);
    assertWellFormed(res.text);
    for (const must of [payment.receiptNo, t.stay.hostel.name, t.first.number, 'RENT RECEIPT', 'PAID', 'Paid online', 'Invoice total']) expect(res.text).toContain(must);
    expect(res.text).not.toContain('REFUNDED');
  });

  it('are refused when forged, expired, or for a payment that was reversed', async () => {
    const t = await activeTenant();
    await rentApi.record(t.stay.owner.token, t.first.id, { amountPaise: t.first.totalPaise, method: 'CASH', receivedOn: TODAY });
    const cash = ((await rentApi.ownerInvoice(t.stay.owner.token, t.first.id)).body.data.payments[0])!;
    const link = (await rentApi.myLink(t.tenant.token, cash.id)).body.data; // cash receipts work too
    expect((await openReceipt(link.url)).status).toBe(200);
    expect((await openReceipt(link.url.slice(0, -3) + 'xyz')).status).toBe(404);
    await expect(rentReceiptsService.render(link.url.split('/receipts/')[1]!, new Date(Date.now() + RECEIPT_LINK_TTL_MS + 5000))).rejects.toThrow();
    await rentApi.reverse(t.stay.owner.token, cash.id);
    expect((await openReceipt(link.url)).status).toBe(404); // the link outlived the payment
    const again = await rentApi.myLink(t.tenant.token, cash.id);
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toMatch(/reversed/);
  });

  it('show refunds on the receipt', async () => {
    setPaymentProvider(new DemoProvider());
    const t = await activeTenant();
    const payment = await payOnline(t.tenant.token, t.stay.owner.token, t.first.id);
    const half = Math.floor(t.first.totalPaise / 2);
    await rentApi.refund(t.stay.owner.token, payment.id, { amountPaise: half, reason: 'Goodwill credit' });
    const res = await openReceipt((await rentApi.myLink(t.tenant.token, payment.id)).body.data.url);
    assertWellFormed(res.text);
    for (const must of ['PART REFUNDED', 'REFUNDS', 'Goodwill credit', 'Net received']) expect(res.text).toContain(must);
    await rentApi.refund(t.stay.owner.token, payment.id, { amountPaise: t.first.totalPaise - half, reason: 'The rest' });
    expect((await openReceipt((await rentApi.myLink(t.tenant.token, payment.id)).body.data.url)).text).toContain('REFUNDED');
  });
});
