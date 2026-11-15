import { toDateString, todayIn } from '@/core/dates';
import { fmtRupees } from '@/modules/bookings/booking-core';
import { A4, buildPdf, type PdfBox, type PdfLine, type PdfRule } from './receipt-pdf';
import { balanceOf } from './rent.rules';

const day = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const METHOD: Record<string, string> = { ONLINE: 'Online', DEPOSIT: 'From deposit', CASH: 'Cash', UPI: 'UPI', BANK: 'Bank transfer' };
const LEFT = 56;
const RIGHT = 539;
const money = (paise: number) => fmtRupees(paise);

/** The dark header band every document shares. */
function header(title: string, status: string, L: PdfLine[], B: PdfBox[]) {
  B.push({ x: 0, y: 770, w: A4.w, h: 72, gray: 0.12 });
  L.push({ text: 'Hostel Booking', x: LEFT, y: 812, size: 18, bold: true, gray: 1 });
  L.push({ text: title, x: LEFT, y: 790, size: 10, gray: 0.8 });
  L.push({ text: status, x: 440, y: 800, size: 12, bold: true, gray: 1 });
}
const footer = (note: string, L: PdfLine[], R: PdfRule[]) => {
  R.push({ x1: LEFT, x2: RIGHT, y: 70 });
  L.push({ text: note, x: LEFT, y: 54, size: 8, gray: 0.5 });
  L.push({ text: 'Computer-generated document; no signature is needed. Keep it for your records.', x: LEFT, y: 42, size: 8, gray: 0.5 });
};

export interface InvoiceDoc {
  number: string; status: string; periodStart: Date; periodEnd: Date; dueDate: Date; overdueAfter: Date; issuedAt: Date;
  subtotalPaise: number; taxPaise: number; totalPaise: number; paidPaise: number; gstRateBps: number; voidReason: string | null;
  lines: { description: string; amountPaise: number }[];
  payments: { receiptNo: string; receivedOn: Date; method: string; amountPaise: number; reversedAt: Date | null; refundedPaise: number }[];
  hostel: { name: string; city: string; timezone: string };
  tenant: { email: string; profile: { fullName: string } | null };
  tenancy: { code: string; unit: { label: string } };
}

/** A rent invoice: what is billed, for which days, and what has been paid against it. */
export function renderInvoice(inv: InvoiceDoc, now = new Date()): Buffer {
  const L: PdfLine[] = [];
  const R: PdfRule[] = [];
  const B: PdfBox[] = [];
  const balance = balanceOf(inv);
  const late = (inv.status === 'DUE' || inv.status === 'PARTIALLY_PAID') && balance > 0 && toDateString(inv.overdueAfter) < todayIn(inv.hostel.timezone, now);
  const status = inv.status === 'VOID' ? 'CANCELLED' : inv.status === 'PAID' ? 'PAID' : late ? 'OVERDUE' : inv.status === 'PARTIALLY_PAID' ? 'PART PAID' : 'DUE';
  header('RENT INVOICE', status, L, B);

  const row = (y: number, label: string, value: string, bold = false) => { L.push({ text: label, x: LEFT, y, size: 10, gray: 0.4 }); L.push({ text: value, x: 200, y, size: 10, bold }); };
  let y = 735;
  L.push({ text: inv.number, x: LEFT, y, size: 16, bold: true });
  L.push({ text: `Issued ${day(toDateString(inv.issuedAt))} · due ${day(toDateString(inv.dueDate))}`, x: LEFT, y: y - 16, size: 10, gray: 0.4 });
  y -= 52;
  L.push({ text: 'BILLED TO', x: LEFT, y, size: 8, bold: true, gray: 0.5 }); y -= 16;
  row(y, 'Tenant', inv.tenant.profile?.fullName ?? inv.tenant.email, true); y -= 15;
  row(y, 'Property', `${inv.hostel.name}, ${inv.hostel.city}`); y -= 15;
  row(y, 'Bed / room', `${inv.tenancy.unit.label}  (stay ${inv.tenancy.code})`); y -= 15;
  row(y, 'Period', `${day(toDateString(inv.periodStart))} to ${day(toDateString(inv.periodEnd))}`); y -= 28;

  L.push({ text: 'CHARGES', x: LEFT, y, size: 8, bold: true, gray: 0.5 }); y -= 8;
  R.push({ x1: LEFT, x2: RIGHT, y }); y -= 14;
  const room = (extra: number) => y - extra * 15 > 330; // keep the payment section on the page
  let shown = 0;
  for (const l of inv.lines) {
    if (!room(1)) break;
    L.push({ text: l.description.slice(0, 80), x: LEFT, y, size: 10 }); L.push({ text: money(l.amountPaise), x: 470, y, size: 10 }); y -= 15; shown++;
  }
  if (shown < inv.lines.length) { L.push({ text: `…and ${inv.lines.length - shown} more charge${inv.lines.length - shown === 1 ? '' : 's'} (see the app)`, x: LEFT, y, size: 9, gray: 0.5 }); y -= 15; }
  if (inv.taxPaise > 0) { L.push({ text: `GST (${inv.gstRateBps / 100}% on rent)`, x: LEFT, y, size: 10 }); L.push({ text: money(inv.taxPaise), x: 470, y, size: 10 }); y -= 15; }
  R.push({ x1: LEFT, x2: RIGHT, y: y + 6 }); y -= 8;
  L.push({ text: 'Total', x: LEFT, y, size: 10, bold: true }); L.push({ text: money(inv.totalPaise), x: 470, y, size: 10, bold: true }); y -= 15;
  L.push({ text: 'Paid', x: LEFT, y, size: 10 }); L.push({ text: money(inv.paidPaise), x: 470, y, size: 10 }); y -= 15;
  L.push({ text: inv.status === 'VOID' ? 'Balance (invoice cancelled)' : 'Balance due', x: LEFT, y, size: 11, bold: true }); L.push({ text: money(inv.status === 'VOID' ? 0 : balance), x: 470, y, size: 11, bold: true }); y -= 30;

  if (inv.status === 'VOID' && inv.voidReason) { L.push({ text: `Cancelled: ${inv.voidReason}`.slice(0, 90), x: LEFT, y, size: 9, gray: 0.4 }); y -= 22; }
  if (inv.payments.length > 0) {
    L.push({ text: 'PAYMENTS', x: LEFT, y, size: 8, bold: true, gray: 0.5 }); y -= 16;
    let listed = 0;
    for (const p of inv.payments) {
      if (y < 100) break;
      const text = `${day(toDateString(p.receivedOn))} · ${METHOD[p.method] ?? p.method} · ${p.receiptNo}${p.reversedAt ? ' (reversed)' : ''}${p.refundedPaise > 0 ? ` (refunded ${money(p.refundedPaise)})` : ''}`;
      L.push({ text, x: LEFT, y, size: 10, gray: p.reversedAt ? 0.5 : 0 }); L.push({ text: money(p.amountPaise), x: 470, y, size: 10, gray: p.reversedAt ? 0.5 : 0 }); y -= 15; listed++;
    }
    if (listed < inv.payments.length) L.push({ text: `…and ${inv.payments.length - listed} more payment${inv.payments.length - listed === 1 ? '' : 's'}`, x: LEFT, y, size: 9, gray: 0.5 });
  }
  footer(`Issued by Hostel Booking on behalf of the property owner. Invoice ${inv.number}.`, L, R);
  return buildPdf({ lines: L, rules: R, boxes: B, title: `Rent invoice ${inv.number}` });
}

export interface DepositDoc {
  code: string; depositPaise: number; depositReceivedAt: Date; depositMethod: string | null; depositReference: string | null;
  hostel: { name: string; city: string };
  tenant: { email: string; profile: { fullName: string } | null } | null;
  unit: { label: string };
  settlement: null | { status: string; deductionsPaise: number; refundPaise: number; completedAt: Date | null; payoutMethod: string | null; deductions: { description: string; amountPaise: number }[] };
}

/** The security deposit: what was received and how, and (once settled) what was kept and what went back. */
export function renderDepositReceipt(t: DepositDoc): Buffer {
  const L: PdfLine[] = [];
  const R: PdfRule[] = [];
  const B: PdfBox[] = [];
  const done = t.settlement?.status === 'COMPLETED';
  header('SECURITY DEPOSIT RECEIPT', done ? 'SETTLED' : 'HELD', L, B);
  const row = (y: number, label: string, value: string, bold = false) => { L.push({ text: label, x: LEFT, y, size: 10, gray: 0.4 }); L.push({ text: value, x: 200, y, size: 10, bold }); };
  let y = 735;
  L.push({ text: `DEP-${t.code}`, x: LEFT, y, size: 16, bold: true });
  L.push({ text: `Received on ${day(toDateString(t.depositReceivedAt))}`, x: LEFT, y: y - 16, size: 10, gray: 0.4 });
  y -= 52;
  L.push({ text: 'PAID BY', x: LEFT, y, size: 8, bold: true, gray: 0.5 }); y -= 16;
  row(y, 'Tenant', t.tenant?.profile?.fullName ?? t.tenant?.email ?? 'Tenant', true); y -= 15;
  row(y, 'Property', `${t.hostel.name}, ${t.hostel.city}`); y -= 15;
  row(y, 'Bed / room', `${t.unit.label}  (stay ${t.code})`); y -= 28;
  L.push({ text: 'DEPOSIT', x: LEFT, y, size: 8, bold: true, gray: 0.5 }); y -= 16;
  row(y, 'Amount', money(t.depositPaise), true); y -= 15;
  row(y, 'Paid by', t.depositMethod === 'ONLINE' ? 'Online (held by Hostel Booking until the stay ends)' : (METHOD[t.depositMethod ?? ''] ?? 'Recorded by the owner') + ' (held by the property owner)'); y -= 15;
  if (t.depositReference) { row(y, 'Reference', t.depositReference); y -= 15; }
  y -= 13;

  if (t.settlement && t.settlement.status !== 'DRAFT') {
    L.push({ text: done ? 'SETTLEMENT' : `SETTLEMENT (${t.settlement.status === 'PROPOSED' ? 'WAITING FOR THE TENANT' : t.settlement.status})`, x: LEFT, y, size: 8, bold: true, gray: 0.5 }); y -= 8;
    R.push({ x1: LEFT, x2: RIGHT, y }); y -= 14;
    L.push({ text: 'Deposit held', x: LEFT, y, size: 10 }); L.push({ text: money(t.depositPaise), x: 470, y, size: 10 }); y -= 15;
    for (const d of t.settlement.deductions) {
      if (y < 130) break;
      L.push({ text: `- ${d.description}`.slice(0, 80), x: LEFT, y, size: 10, gray: 0.35 }); L.push({ text: money(d.amountPaise), x: 470, y, size: 10, gray: 0.35 }); y -= 15;
    }
    R.push({ x1: LEFT, x2: RIGHT, y: y + 6 }); y -= 8;
    L.push({ text: 'Returned to the tenant', x: LEFT, y, size: 11, bold: true }); L.push({ text: money(t.settlement.refundPaise), x: 470, y, size: 11, bold: true }); y -= 18;
    if (done) L.push({ text: `${t.settlement.refundPaise === 0 ? 'Nothing was due back.' : t.depositMethod === 'ONLINE' ? 'Refunded to the original payment method.' : `Paid back by ${METHOD[t.settlement.payoutMethod ?? ''] ?? 'the owner'}.`}${t.settlement.completedAt ? ` ${day(toDateString(t.settlement.completedAt))}.` : ''}`, x: LEFT, y, size: 9, gray: 0.4 });
  }
  footer(`Issued by Hostel Booking on behalf of the property owner. Deposit DEP-${t.code}.`, L, R);
  return buildPdf({ lines: L, rules: R, boxes: B, title: `Security deposit receipt DEP-${t.code}` });
}
