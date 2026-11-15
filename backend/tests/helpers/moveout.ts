import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { POST as noticeRoute } from '@/app/api/v1/me/tenancies/[id]/notice/route';
import { POST as noticeWithdrawRoute } from '@/app/api/v1/me/tenancies/[id]/notice/withdraw/route';
import { POST as depositPayRoute } from '@/app/api/v1/me/tenancies/[id]/deposit/payments/route';
import { GET as mySettlementRoute } from '@/app/api/v1/me/tenancies/[id]/settlement/route';
import { POST as acceptSettlementRoute } from '@/app/api/v1/me/tenancies/[id]/settlement/accept/route';
import { POST as disputeSettlementRoute } from '@/app/api/v1/me/tenancies/[id]/settlement/dispute/route';
import { POST as ownerNoticeRoute } from '@/app/api/v1/owner/tenancies/[id]/notice/route';
import { POST as ownerNoticeWithdrawRoute } from '@/app/api/v1/owner/tenancies/[id]/notice/withdraw/route';
import { POST as moveOutRoute } from '@/app/api/v1/owner/tenancies/[id]/move-out/route';
import { GET as ownerSettlementRoute, PUT as saveSettlementRoute } from '@/app/api/v1/owner/tenancies/[id]/settlement/route';
import { POST as proposeRoute } from '@/app/api/v1/owner/tenancies/[id]/settlement/propose/route';
import { POST as retractRoute } from '@/app/api/v1/owner/tenancies/[id]/settlement/retract/route';
import { POST as payoutRoute } from '@/app/api/v1/owner/tenancies/[id]/settlement/payout/route';
import { POST as proofRoute } from '@/app/api/v1/owner/tenancies/[id]/settlement/proofs/route';
import { DELETE as removeProofRoute } from '@/app/api/v1/owner/tenancies/[id]/settlement/proofs/[proofId]/route';
import { GET as adminSettlementRoute } from '@/app/api/v1/admin/tenancies/[id]/settlement/route';
import { POST as resolveRoute } from '@/app/api/v1/admin/tenancies/[id]/settlement/resolve/route';
import { GET as ownerAuditRoute } from '@/app/api/v1/owner/audit-logs/route';
import { GET as occupancyRoute } from '@/app/api/v1/owner/reports/occupancy/route';
import { GET as duesRoute } from '@/app/api/v1/owner/reports/dues/route';
import { POST as signatureRoute } from '@/app/api/v1/uploads/signature/route';
import { call } from './http';
import { TODAY } from './publish';
import { activeTenant, rentApi, payOnline, type Invoice } from './rent';
import { api, approvedTenant, makeStay } from './tenancy';
import type { FakeStorage } from './fake-storage';

export const mo = {
  notice: (token: string, id: string, body: unknown) => call(noticeRoute, { token, params: { id }, body }),
  noticeWithdraw: (token: string, id: string) => call(noticeWithdrawRoute, { token, params: { id } }),
  ownerNotice: (token: string, id: string, body: unknown) => call(ownerNoticeRoute, { token, params: { id }, body }),
  ownerNoticeWithdraw: (token: string, id: string) => call(ownerNoticeWithdrawRoute, { token, params: { id } }),
  moveOut: (token: string, id: string, body: unknown = {}) => call(moveOutRoute, { token, params: { id }, body }),
  payDeposit: (token: string, id: string) => call(depositPayRoute, { token, params: { id } }),
  mySettlement: (token: string, id: string) => call(mySettlementRoute, { method: 'GET', token, params: { id } }),
  accept: (token: string, id: string) => call(acceptSettlementRoute, { token, params: { id } }),
  dispute: (token: string, id: string, body: unknown = { note: 'The damage was already there' }) => call(disputeSettlementRoute, { token, params: { id }, body }),
  settlement: (token: string, id: string) => call(ownerSettlementRoute, { method: 'GET', token, params: { id } }),
  save: (token: string, id: string, body: unknown) => call(saveSettlementRoute, { method: 'PUT', token, params: { id }, body }),
  propose: (token: string, id: string) => call(proposeRoute, { token, params: { id } }),
  retract: (token: string, id: string) => call(retractRoute, { token, params: { id } }),
  payout: (token: string, id: string, body: unknown = { method: 'CASH' }) => call(payoutRoute, { token, params: { id }, body }),
  proof: (token: string, id: string, publicId: string) => call(proofRoute, { token, params: { id }, body: { publicId } }),
  removeProof: (token: string, id: string, proofId: string) => call(removeProofRoute, { method: 'DELETE', token, params: { id, proofId } }),
  adminSettlement: (token: string, id: string) => call(adminSettlementRoute, { method: 'GET', token, params: { id } }),
  resolve: (token: string, id: string, body: unknown) => call(resolveRoute, { token, params: { id }, body }),
  audit: (token: string, query = '') => call(ownerAuditRoute, { method: 'GET', token, query }),
  occupancy: (token: string, query = '') => call(occupancyRoute, { method: 'GET', token, query }),
  dues: (token: string, query = '') => call(duesRoute, { method: 'GET', token, query }),
  signature: (token: string, body: unknown) => call(signatureRoute, { token, body }),
};

export const DAY = 86_400_000;
/** The day a notice may name: at least the default 30 days away. */
export const noticeDay = (days = 30) => addDays(TODAY, days);

export type Stay = Awaited<ReturnType<typeof makeStay>>;

/**
 * A moved-in tenant whose deposit was received. By default in cash; pass `online` to pay it through the gateway instead.
 * The stay's default terms give a 2-month deposit (₹12,000 on ₹6,000 rent).
 */
export async function tenantWithDeposit(over: { stay?: Stay; online?: boolean; depositPaise?: number } = {}) {
  const stay = over.stay ?? (await makeStay({ units: 3 }));
  const { tenant, tenancyId } = await approvedTenant(stay, { depositPaise: over.depositPaise ?? 1_200_000 });
  if (over.online) {
    const order = (await mo.payDeposit(tenant.token, tenancyId)).body.data;
    const done = await rentApi.checkout(tenant.token, order.id, 'DEMO_SUCCESS');
    if (done.status !== 200 || done.body.data.status !== 'CAPTURED') throw new Error(`deposit payment failed: ${JSON.stringify(done.body)}`);
  } else {
    const rec = await api.deposit(stay.owner.token, tenancyId, { method: 'CASH' });
    if (rec.status !== 200) throw new Error(`deposit failed: ${JSON.stringify(rec.body)}`);
  }
  const started = await api.activate(stay.owner.token, tenancyId);
  if (started.status !== 200) throw new Error(`activate failed: ${JSON.stringify(started.body)}`);
  const invoices = (await rentApi.myInvoices(tenant.token)).body.data as Invoice[];
  return { stay, tenant, tenancyId, first: invoices[0]! };
}

/** …and then the owner records the move-out, which starts the settlement. */
export async function endedStay(over: Parameters<typeof tenantWithDeposit>[0] = {}) {
  const t = await tenantWithDeposit(over);
  const res = await mo.moveOut(t.stay.owner.token, t.tenancyId);
  if (res.status !== 200) throw new Error(`move-out failed: ${JSON.stringify(res.body)}`);
  const settlement = (await mo.settlement(t.stay.owner.token, t.tenancyId)).body.data;
  // Rent now stops at the move-out day, so the invoice the tenant was first billed is re-fitted to it: report the invoice as it stands.
  const first = ((await rentApi.myInvoices(t.tenant.token)).body.data as Invoice[])[0]!;
  return { ...t, first, settlement };
}

/** Signs and "uploads" a proof photo to the fake storage; returns its public id. */
export async function uploadProof(token: string, tenancyId: string, storage: FakeStorage) {
  const sig = await mo.signature(token, { purpose: 'DEPOSIT_PROOF', tenancyId });
  if (sig.status !== 200 && sig.status !== 201) throw new Error(`signature failed: ${JSON.stringify(sig.body)}`);
  storage.put(sig.body.data.publicId);
  return sig.body.data.publicId as string;
}

export { prisma, rentApi, payOnline, api };
