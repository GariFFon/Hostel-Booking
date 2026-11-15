import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { POST as initiateRoute } from '@/app/api/v1/me/rent-invoices/[id]/payments/route';
import { GET as myInvoicesRoute } from '@/app/api/v1/me/rent-invoices/route';
import { GET as myInvoiceRoute } from '@/app/api/v1/me/rent-invoices/[id]/route';
import { GET as myOrderRoute } from '@/app/api/v1/me/rent-orders/[id]/route';
import { POST as checkoutRoute } from '@/app/api/v1/me/rent-orders/[id]/demo-checkout/route';
import { GET as ownerInvoicesRoute } from '@/app/api/v1/owner/rent-invoices/route';
import { GET as ownerInvoiceRoute } from '@/app/api/v1/owner/rent-invoices/[id]/route';
import { POST as recordRoute } from '@/app/api/v1/owner/rent-invoices/[id]/payments/route';
import { POST as lineRoute } from '@/app/api/v1/owner/rent-invoices/[id]/lines/route';
import { POST as voidRoute } from '@/app/api/v1/owner/rent-invoices/[id]/void/route';
import { POST as reverseRoute } from '@/app/api/v1/owner/rent-payments/[id]/reverse/route';
import { GET as rollRoute } from '@/app/api/v1/owner/rent-roll/route';
import { GET as adminInvoicesRoute } from '@/app/api/v1/admin/rent-invoices/route';
import { POST as ownerRefundRoute } from '@/app/api/v1/owner/rent-payments/[id]/refund/route';
import { POST as adminRefundRoute } from '@/app/api/v1/admin/rent-payments/[id]/refund/route';
import { POST as myLinkRoute } from '@/app/api/v1/me/rent-payments/[id]/receipt-link/route';
import { POST as ownerLinkRoute } from '@/app/api/v1/owner/rent-payments/[id]/receipt-link/route';
import { POST as adminLinkRoute } from '@/app/api/v1/admin/rent-payments/[id]/receipt-link/route';
import { GET as receiptRoute } from '@/app/api/v1/receipts/[token]/route';
import { GET as adminInvoiceRoute } from '@/app/api/v1/admin/rent-invoices/[id]/route';
import { GET as adminRollRoute } from '@/app/api/v1/admin/rent-roll/route';
import { NextRequest } from 'next/server';
import { signDemoPayload } from '@/infra/payments/demo.provider';
import { POST as webhookRoute } from '@/app/api/v1/payments/webhooks/demo/route';
import { call } from './http';
import { TODAY } from './publish';
import { api, approvedTenant, makeStay } from './tenancy';

export const rentApi = {
  myInvoices: (token: string, query = '') => call(myInvoicesRoute, { method: 'GET', token, query }),
  myInvoice: (token: string, id: string) => call(myInvoiceRoute, { method: 'GET', token, params: { id } }),
  initiate: (token: string, invoiceId: string) => call(initiateRoute, { token, params: { id: invoiceId }, body: undefined }),
  order: (token: string, id: string) => call(myOrderRoute, { method: 'GET', token, params: { id } }),
  checkout: (token: string, orderId: string, instrument = 'DEMO_SUCCESS') => call(checkoutRoute, { token, params: { id: orderId }, body: { instrument, method: 'UPI' } }),
  ownerInvoices: (token: string, query = '') => call(ownerInvoicesRoute, { method: 'GET', token, query }),
  ownerInvoice: (token: string, id: string) => call(ownerInvoiceRoute, { method: 'GET', token, params: { id } }),
  record: (token: string, id: string, body: unknown) => call(recordRoute, { token, params: { id }, body }),
  addLine: (token: string, id: string, body: unknown) => call(lineRoute, { token, params: { id }, body }),
  void: (token: string, id: string, body: unknown = { reason: 'Issued by mistake' }) => call(voidRoute, { token, params: { id }, body }),
  reverse: (token: string, paymentId: string, body: unknown = { reason: 'Wrong amount' }) => call(reverseRoute, { token, params: { id: paymentId }, body }),
  roll: (token: string, query = '') => call(rollRoute, { method: 'GET', token, query }),
  adminInvoices: (token: string, query = '') => call(adminInvoicesRoute, { method: 'GET', token, query }),
  adminInvoice: (token: string, id: string) => call(adminInvoiceRoute, { method: 'GET', token, params: { id } }),
  adminRoll: (token: string, query = '') => call(adminRollRoute, { method: 'GET', token, query }),
  refund: (token: string, paymentId: string, body: unknown) => call(ownerRefundRoute, { token, params: { id: paymentId }, body }),
  adminRefund: (token: string, paymentId: string, body: unknown) => call(adminRefundRoute, { token, params: { id: paymentId }, body }),
  myLink: (token: string, paymentId: string) => call(myLinkRoute, { token, params: { id: paymentId } }),
  ownerLink: (token: string, paymentId: string) => call(ownerLinkRoute, { token, params: { id: paymentId } }),
  adminLink: (token: string, paymentId: string) => call(adminLinkRoute, { token, params: { id: paymentId } }),
};

/** Opens a receipt link the way a phone or browser would: no credentials, just the URL. */
export async function openReceipt(url: string) {
  const token = url.split('/receipts/')[1]!;
  const res = await (receiptRoute as unknown as (r: NextRequest, s: { params: Promise<Record<string, string>> }) => Promise<Response>)(new NextRequest(url, { method: 'GET' }), { params: Promise.resolve({ token }) });
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, bytes, text: bytes.toString('latin1') };
}

/** The tenant pays an invoice online and it succeeds. Returns the payment as the owner sees it. */
export async function payOnline(tenantToken: string, ownerToken: string, invoiceId: string) {
  const order = (await rentApi.initiate(tenantToken, invoiceId)).body.data;
  const done = await rentApi.checkout(tenantToken, order.id, 'DEMO_SUCCESS');
  if (done.status !== 200 || done.body.data.status !== 'CAPTURED') throw new Error(`payment failed: ${JSON.stringify(done.body)}`);
  const inv = (await rentApi.ownerInvoice(ownerToken, invoiceId)).body.data as Invoice;
  return inv.payments.find((p) => p.method === 'ONLINE')!;
}

/** "Now" at noon IST on a given date: lets a test run the hourly sweep on any day. */
export const at = (day: string) => new Date(`${day}T06:30:00.000Z`);
export { TODAY, addDays };

/** A stay with a moved-in tenant, so the first invoice already exists. Terms are set on the property before the tenancy is created. */
export async function activeTenant(over: { terms?: Record<string, unknown>; rentPaise?: number; units?: number; stay?: Awaited<ReturnType<typeof makeStay>> } = {}) {
  const stay = over.stay ?? (await makeStay({ units: over.units ?? 3, room: over.rentPaise ? { price: over.rentPaise } : undefined }));
  if (over.terms) {
    const res = await api.patchTerms(stay.owner.token, stay.hostel.id, over.terms);
    if (res.status !== 200) throw new Error(`terms failed: ${JSON.stringify(res.body)}`);
  }
  const { tenant, tenancyId } = await approvedTenant(stay, { depositPaise: 0 });
  const started = await api.activate(stay.owner.token, tenancyId);
  if (started.status !== 200) throw new Error(`activate failed: ${JSON.stringify(started.body)}`);
  const invoices = (await rentApi.myInvoices(tenant.token)).body.data as Invoice[];
  return { stay, tenant, tenancyId, invoices, first: invoices[0]! };
}

export interface Invoice {
  id: string; number: string; status: string; periodStart: string; periodEnd: string; dueDate: string; subtotalPaise: number; taxPaise: number; totalPaise: number; paidPaise: number; balancePaise: number;
  gstRateBps: number; lines: { id: string; type: string; description: string; amountPaise: number }[]; payments: { id: string; receiptNo: string; amountPaise: number; method: string; reversed: boolean; canReverse: boolean }[];
  overdue: { isOverdue: boolean; days: number }; openOrder: { id: string; status: string; amountPaise: number } | null; actions: string[];
}

export const invoicesOf = async (tenancyId: string) => prisma.rentInvoice.findMany({ where: { tenancyId }, orderBy: { periodStart: 'asc' } });

/** A correctly signed gateway event for a rent order, built the way the demo job builds it. */
export async function rentEvent(orderId: string, over: { id?: string; type?: 'payment.captured' | 'payment.failed'; amountPaise?: number } = {}) {
  const o = await prisma.rentOrder.findUniqueOrThrow({ where: { id: orderId } });
  const type = over.type ?? 'payment.captured';
  return {
    id: over.id ?? `evt_rent_${orderId}_${Math.random().toString(36).slice(2, 8)}`, type, createdAt: new Date().toISOString(),
    data: { orderId: o.providerOrderId, paymentId: `demo_pay_${orderId.replace(/-/g, '')}`, amountPaise: over.amountPaise ?? o.amountPaise, currency: 'INR', method: 'UPI', ...(type === 'payment.failed' ? { failureCode: 'DEMO_DECLINED', failureReason: 'Declined' } : {}) },
  };
}
export const deliverRent = (event: object) => {
  const raw = JSON.stringify(event);
  return call(webhookRoute, { rawBody: raw, headers: { 'x-demo-signature': signDemoPayload(raw) } });
};

// ── PDF invoices and deposit receipts ──
import { POST as myInvoicePdfRoute } from '@/app/api/v1/me/rent-invoices/[id]/pdf-link/route';
import { POST as ownerInvoicePdfRoute } from '@/app/api/v1/owner/rent-invoices/[id]/pdf-link/route';
import { POST as adminInvoicePdfRoute } from '@/app/api/v1/admin/rent-invoices/[id]/pdf-link/route';
import { POST as myDepositLinkRoute } from '@/app/api/v1/me/tenancies/[id]/deposit-receipt-link/route';
import { POST as ownerDepositLinkRoute } from '@/app/api/v1/owner/tenancies/[id]/deposit-receipt-link/route';
import { POST as adminDepositLinkRoute } from '@/app/api/v1/admin/tenancies/[id]/deposit-receipt-link/route';

export const docApi = {
  myInvoice: (token: string, id: string) => call(myInvoicePdfRoute, { token, params: { id } }),
  ownerInvoice: (token: string, id: string) => call(ownerInvoicePdfRoute, { token, params: { id } }),
  adminInvoice: (token: string, id: string) => call(adminInvoicePdfRoute, { token, params: { id } }),
  myDeposit: (token: string, id: string) => call(myDepositLinkRoute, { token, params: { id } }),
  ownerDeposit: (token: string, id: string) => call(ownerDepositLinkRoute, { token, params: { id } }),
  adminDeposit: (token: string, id: string) => call(adminDepositLinkRoute, { token, params: { id } }),
};
