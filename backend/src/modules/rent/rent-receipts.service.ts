import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/core/config/env';
import { Errors } from '@/core/errors/app-error';
import type { Actor } from '@/core/context/request-context';
import { requireRole } from '@/core/auth/rbac';
import { toDateString } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';
import { fmtRupees } from '@/modules/bookings/booking-core';
import { buildPdf, type PdfBox, type PdfLine, type PdfRule } from './receipt-pdf';
import { renderDepositReceipt, renderInvoice } from './rent-documents';

/** A download link is good for this long. The PDF itself is generated when the link is opened, so it always shows the latest refunds. */
export const RECEIPT_LINK_TTL_MS = 5 * 60_000;

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (payload: string) => createHmac('sha256', env().JWT_ACCESS_SECRET).update(`rent-receipt:${payload}`).digest('base64url');

/** What a link opens: one payment's receipt, a rent invoice, or a stay's security-deposit receipt. */
export type DocKind = 'payment' | 'invoice' | 'deposit';

export function signReceiptToken(id: string, now = new Date(), kind: DocKind = 'payment') {
  const expiresAt = new Date(now.getTime() + RECEIPT_LINK_TTL_MS);
  const payload = b64(JSON.stringify({ k: kind, p: id, e: expiresAt.getTime() }));
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

/** The payment a valid, unexpired token names. Anything else is a plain 404: a wrong or stale link reveals nothing. */
export const verifyReceiptToken = (token: string, now = new Date()): string => verifyDocToken(token, now).id;

export function verifyDocToken(token: string, now = new Date()): { kind: DocKind; id: string } {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) throw Errors.notFound('Receipt');
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw Errors.notFound('Receipt');
  try {
    const { k, p, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { k?: unknown; p?: unknown; e?: unknown };
    if (typeof p !== 'string' || typeof e !== 'number' || e < now.getTime() || (k !== 'payment' && k !== 'invoice' && k !== 'deposit')) throw new Error('bad');
    return { kind: k, id: p };
  } catch { throw Errors.notFound('Receipt'); }
}

const include = {
  invoice: {
    include: {
      lines: { orderBy: { createdAt: 'asc' as const } },
      hostel: { select: { name: true, city: true } },
      tenant: { select: { email: true, profile: { select: { fullName: true } } } },
      tenancy: { select: { code: true, unit: { select: { label: true } } } },
    },
  },
  refunds: { where: { status: 'PROCESSED' as const }, orderBy: { createdAt: 'asc' as const } },
  order: { select: { method: true } },
} as const;
type PaymentFull = NonNullable<Awaited<ReturnType<typeof load>>>;
const load = (id: string) => prisma.rentPayment.findUnique({ where: { id }, include });

const METHOD: Record<string, string> = { ONLINE: 'Paid online', DEPOSIT: 'Settled from the security deposit', CASH: 'Cash', UPI: 'UPI', BANK: 'Bank transfer' };
const day = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

export const rentReceiptsService = {
  /** A short-lived link to the receipt PDF, for whoever may see this payment: the tenant, the property's owner, or an admin. */
  async link(actor: Actor, paymentId: string, as: 'TENANT' | 'OWNER' | 'ADMIN') {
    if (as === 'OWNER') requireRole(actor, 'OWNER');
    if (as === 'ADMIN') requireRole(actor, 'ADMIN');
    const where = as === 'TENANT' ? { id: paymentId, tenantId: actor.id } : as === 'OWNER' ? { id: paymentId, invoice: { hostel: { ownerId: actor.id } } } : { id: paymentId };
    const p = await prisma.rentPayment.findFirst({ where, select: { id: true, reversedAt: true, receiptNo: true, hostelId: true, tenancyId: true } });
    if (!p) throw Errors.notFound('Payment'); // someone else's payment looks exactly like a missing one
    if (p.reversedAt) throw Errors.conflict('This payment was reversed, so it has no receipt');
    const { token, expiresAt } = signReceiptToken(p.id);
    await recordAudit({ action: 'rent.receipt.link', entityType: 'rent_payment', entityId: p.id, after: { receiptNo: p.receiptNo, as }, metadata: { hostelId: p.hostelId, tenancyId: p.tenancyId } });
    return { url: `${env().APP_URL}/api/v1/receipts/${token}`, expiresAt: expiresAt.toISOString() };
  },

  /** A short-lived link to a rent invoice as a PDF: the tenant it is billed to, the property's owner, or an admin. */
  async invoiceLink(actor: Actor, invoiceId: string, as: 'TENANT' | 'OWNER' | 'ADMIN') {
    if (as === 'OWNER') requireRole(actor, 'OWNER');
    if (as === 'ADMIN') requireRole(actor, 'ADMIN');
    const where = as === 'TENANT' ? { id: invoiceId, tenantId: actor.id } : as === 'OWNER' ? { id: invoiceId, hostel: { ownerId: actor.id } } : { id: invoiceId };
    const i = await prisma.rentInvoice.findFirst({ where, select: { id: true, number: true, hostelId: true, tenancyId: true } });
    if (!i) throw Errors.notFound('Invoice'); // someone else's invoice looks exactly like a missing one
    const { token, expiresAt } = signReceiptToken(i.id, new Date(), 'invoice');
    await recordAudit({ action: 'rent.invoice.pdf_link', entityType: 'rent_invoice', entityId: i.id, after: { number: i.number, as }, metadata: { hostelId: i.hostelId, tenancyId: i.tenancyId } });
    return { url: `${env().APP_URL}/api/v1/receipts/${token}`, expiresAt: expiresAt.toISOString() };
  },

  /** A short-lived link to the security-deposit receipt of a stay (once a deposit has been received). */
  async depositLink(actor: Actor, tenancyId: string, as: 'TENANT' | 'OWNER' | 'ADMIN') {
    if (as === 'OWNER') requireRole(actor, 'OWNER');
    if (as === 'ADMIN') requireRole(actor, 'ADMIN');
    const where = as === 'TENANT' ? { id: tenancyId, tenantId: actor.id } : as === 'OWNER' ? { id: tenancyId, hostel: { ownerId: actor.id } } : { id: tenancyId };
    const t = await prisma.tenancy.findFirst({ where, select: { id: true, code: true, hostelId: true, depositReceivedAt: true, depositPaise: true } });
    if (!t) throw Errors.notFound('Stay'); // someone else's stay looks exactly like a missing one
    if (!t.depositReceivedAt || t.depositPaise <= 0) throw Errors.conflict('No deposit has been received for this stay yet');
    const { token, expiresAt } = signReceiptToken(t.id, new Date(), 'deposit');
    await recordAudit({ action: 'tenancy.deposit.receipt_link', entityType: 'tenancy', entityId: t.id, after: { code: t.code, as }, metadata: { hostelId: t.hostelId, code: t.code } });
    return { url: `${env().APP_URL}/api/v1/receipts/${token}`, expiresAt: expiresAt.toISOString() };
  },

  /** The PDF for a signed link. */
  async render(token: string, now = new Date()) {
    const { kind, id } = verifyDocToken(token, now);
    if (kind === 'invoice') {
      const i = await prisma.rentInvoice.findUnique({ where: { id }, include: { lines: { orderBy: { createdAt: 'asc' } }, payments: { orderBy: { createdAt: 'asc' } }, hostel: { select: { name: true, city: true, timezone: true } }, tenant: { select: { email: true, profile: { select: { fullName: true } } } }, tenancy: { select: { code: true, unit: { select: { label: true } } } } } });
      if (!i) throw Errors.notFound('Invoice');
      return { filename: `invoice-${i.number}.pdf`, bytes: renderInvoice(i, now) };
    }
    if (kind === 'deposit') {
      const t = await prisma.tenancy.findUnique({ where: { id }, include: { hostel: { select: { name: true, city: true } }, unit: { select: { label: true } }, tenant: { select: { email: true, profile: { select: { fullName: true } } } }, settlement: { include: { deductions: { orderBy: { createdAt: 'asc' } } } } } });
      if (!t || !t.depositReceivedAt) throw Errors.notFound('Receipt');
      return { filename: `deposit-receipt-${t.code}.pdf`, bytes: renderDepositReceipt({ ...t, depositReceivedAt: t.depositReceivedAt, settlement: t.settlement && t.settlement.status !== 'DRAFT' ? t.settlement : null }) };
    }
    const p = await load(id);
    if (!p || p.reversedAt) throw Errors.notFound('Receipt');
    return { filename: `receipt-${p.receiptNo}.pdf`, bytes: renderReceipt(p) };
  },
};

export function renderReceipt(p: PaymentFull): Buffer {
  const inv = p.invoice;
  const m = { hostel: inv.hostel, tenant: inv.tenant, tenancy: inv.tenancy };
  const refunded = p.refundedPaise;
  const net = p.amountPaise - refunded;
  const status = refunded === 0 ? 'PAID' : refunded >= p.amountPaise ? 'REFUNDED' : 'PART REFUNDED';
  const L: PdfLine[] = [];
  const R: PdfRule[] = [];
  const B: PdfBox[] = [{ x: 0, y: 770, w: 595, h: 72, gray: 0.12 }];
  const row = (y: number, label: string, value: string, bold = false) => { L.push({ text: label, x: 56, y, size: 10, gray: 0.4 }); L.push({ text: value, x: 200, y, size: 10, bold }); };
  const money = (paise: number) => fmtRupees(paise);

  L.push({ text: 'Hostel Booking', x: 56, y: 812, size: 18, bold: true, gray: 1 });
  L.push({ text: 'RENT RECEIPT', x: 56, y: 790, size: 10, gray: 0.8 });
  L.push({ text: status, x: 470, y: 800, size: 12, bold: true, gray: 1 });

  let y = 735;
  L.push({ text: p.receiptNo, x: 56, y, size: 16, bold: true });
  L.push({ text: `Received on ${day(toDateString(p.receivedOn))}`, x: 56, y: y - 16, size: 10, gray: 0.4 });
  y -= 52;
  L.push({ text: 'PAID BY', x: 56, y, size: 8, bold: true, gray: 0.5 }); y -= 16;
  row(y, 'Tenant', m.tenant.profile?.fullName ?? m.tenant.email, true); y -= 15;
  row(y, 'Property', `${m.hostel.name}, ${m.hostel.city}`); y -= 15;
  row(y, 'Bed / room', `${m.tenancy.unit.label}  (stay ${m.tenancy.code})`); y -= 28;

  L.push({ text: 'PAYMENT', x: 56, y, size: 8, bold: true, gray: 0.5 }); y -= 16;
  row(y, 'Amount', money(p.amountPaise), true); y -= 15;
  row(y, 'Method', METHOD[p.method] ?? p.method); y -= 15;
  if (p.reference) { row(y, 'Reference', p.reference); y -= 15; }
  row(y, 'Invoice', `${inv.number}  (${day(toDateString(inv.periodStart))} to ${day(toDateString(inv.periodEnd))})`); y -= 28;

  L.push({ text: 'WHAT THE INVOICE COVERS', x: 56, y, size: 8, bold: true, gray: 0.5 }); y -= 8;
  R.push({ x1: 56, x2: 539, y });
  y -= 14;
  for (const l of inv.lines) {
    L.push({ text: l.description, x: 56, y, size: 10 });
    L.push({ text: money(l.amountPaise), x: 470, y, size: 10 });
    y -= 15;
  }
  if (inv.taxPaise > 0) { L.push({ text: `GST (${inv.gstRateBps / 100}% on rent)`, x: 56, y, size: 10 }); L.push({ text: money(inv.taxPaise), x: 470, y, size: 10 }); y -= 15; }
  R.push({ x1: 56, x2: 539, y: y + 6 });
  y -= 8;
  L.push({ text: 'Invoice total', x: 56, y, size: 10, bold: true }); L.push({ text: money(inv.totalPaise), x: 470, y, size: 10, bold: true }); y -= 28;

  if (p.refunds.length > 0) {
    L.push({ text: 'REFUNDS', x: 56, y, size: 8, bold: true, gray: 0.5 }); y -= 16;
    for (const r of p.refunds) {
      L.push({ text: `${day(toDateString(r.processedAt ?? r.createdAt))}: ${r.reason}`, x: 56, y, size: 10 });
      L.push({ text: `- ${money(r.amountPaise)}`, x: 470, y, size: 10 });
      y -= 15;
    }
    L.push({ text: 'Net received', x: 56, y, size: 10, bold: true }); L.push({ text: money(net), x: 470, y, size: 10, bold: true }); y -= 28;
  }

  R.push({ x1: 56, x2: 539, y: 70 });
  L.push({ text: 'Computer-generated receipt; no signature is needed. Keep it for your records.', x: 56, y: 54, size: 8, gray: 0.5 });
  L.push({ text: `Issued by Hostel Booking on behalf of the property owner. Receipt ${p.receiptNo}.`, x: 56, y: 42, size: 8, gray: 0.5 });
  return buildPdf({ lines: L, rules: R, boxes: B, title: `Rent receipt ${p.receiptNo}` });
}
