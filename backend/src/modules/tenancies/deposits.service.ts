import { randomUUID } from 'node:crypto';
import type { DepositSettlementStatus, Prisma } from '@/generated/prisma/client';
import { Errors } from '@/core/errors/app-error';
import type { Actor } from '@/core/context/request-context';
import { requireRole } from '@/core/auth/rbac';
import { logger } from '@/core/logger/logger';
import { todayIn } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { getPaymentProvider } from '@/infra/payments/provider';
import { recordAudit } from '@/modules/audit/audit.service';
import { fmtRupees } from '@/modules/bookings/booking-core';
import { notifyAdmins } from '@/modules/notifications/notifications.service';
import { verifyUploadedAsset } from '@/modules/media/asset-verifier';
import { prefixFor } from '@/modules/uploads/upload-policy';
import { newReceiptNumber } from '@/modules/rent/rent.rules';
import { lockInvoice } from '@/modules/rent/rent.service';
import type { DeductionInput, SaveSettlementInput } from './deposits.schema';
import { isUniqueViolation, lockRow } from './tenancy.rules';
import { notifyTenancy, runEffects, type Effect } from './tenancy-notify';

type Tx = Prisma.TransactionClient;
type Viewer = 'TENANT' | 'OWNER' | 'ADMIN';

/** The tenant has this long to respond; silence counts as acceptance. */
export const RESPOND_WITHIN_DAYS = 7;
export const MAX_PROOFS = 10;
const GIVE_UP_AFTER_MS = 48 * 3600_000;

const include = {
  deductions: { orderBy: { createdAt: 'asc' as const } },
  proofs: { orderBy: { createdAt: 'asc' as const } },
  tenancy: { select: { id: true, code: true, status: true, depositMethod: true, depositPaise: true, hostelId: true, tenantId: true, hostel: { select: { id: true, name: true, timezone: true, ownerId: true, owner: { select: { email: true } } } }, tenant: { select: { id: true, email: true, profile: { select: { fullName: true } } } } } },
} satisfies Prisma.DepositSettlementInclude;
type Full = Prisma.DepositSettlementGetPayload<{ include: typeof include }>;

const online = (s: Full) => s.tenancy.depositMethod === 'ONLINE';
const respondBy = (s: Full) => (s.proposedAt ? new Date(s.proposedAt.getTime() + RESPOND_WITHIN_DAYS * 86_400_000) : null);

async function openInvoicesOf(db: Tx | typeof prisma, tenancyId: string) {
  const rows = await db.rentInvoice.findMany({ where: { tenancyId, status: { in: ['DUE', 'PARTIALLY_PAID'] } }, orderBy: { periodStart: 'asc' }, select: { id: true, number: true, totalPaise: true, paidPaise: true } });
  return rows.map((i) => ({ id: i.id, number: i.number, balancePaise: Math.max(i.totalPaise - i.paidPaise, 0) })).filter((i) => i.balancePaise > 0);
}

export async function toSettlementDto(db: Tx | typeof prisma, s: Full, viewer: Viewer) {
  const editable = s.status === 'DRAFT' || s.status === 'DISPUTED';
  const actions: ('edit' | 'add_proof' | 'propose' | 'retract' | 'accept' | 'dispute' | 'record_payout' | 'resolve')[] = [];
  if (viewer === 'OWNER') {
    if (editable) actions.push('edit', 'add_proof', 'propose');
    if (s.status === 'PROPOSED') actions.push('retract');
    if (s.status === 'AGREED' && !online(s) && s.refundPaise > 0) actions.push('record_payout');
  }
  if (viewer === 'TENANT' && s.status === 'PROPOSED') actions.push('accept', 'dispute');
  if (viewer === 'ADMIN' && s.status === 'DISPUTED') actions.push('resolve');
  return {
    id: s.id, tenancyId: s.tenancyId, status: s.status,
    tenant: { id: s.tenancy.tenant?.id ?? s.tenantId, name: s.tenancy.tenant?.profile?.fullName ?? null }, hostel: { id: s.tenancy.hostel.id, name: s.tenancy.hostel.name },
    depositPaise: s.depositPaise, deductionsPaise: s.deductionsPaise, refundPaise: s.refundPaise, note: s.note, disputeNote: s.disputeNote,
    proposedAt: s.proposedAt?.toISOString() ?? null, respondBy: s.status === 'PROPOSED' ? (respondBy(s)?.toISOString() ?? null) : null, respondedAt: s.respondedAt?.toISOString() ?? null,
    agreedAt: s.agreedAt?.toISOString() ?? null, autoAgreed: s.autoAgreed, completedAt: s.completedAt?.toISOString() ?? null,
    payout: { online: online(s), method: s.payoutMethod, reference: s.payoutReference },
    deductions: s.deductions.map((d) => ({ id: d.id, type: d.type, description: d.description, amountPaise: d.amountPaise, invoiceId: d.invoiceId })),
    proofs: s.proofs.map((p) => ({ id: p.id, url: p.url, createdAt: p.createdAt.toISOString() })),
    openInvoices: (viewer === 'OWNER' || viewer === 'ADMIN') && editable ? await openInvoicesOf(db, s.tenancyId) : [],
    version: s.version, actions,
  };
}

const sum = (lines: { amountPaise: number }[]) => lines.reduce((n, l) => n + l.amountPaise, 0);

/** Checks the itemised deductions against the deposit and the invoices. Throws a 422 naming the problem. */
async function validateLines(tx: Tx, tenancyId: string, depositPaise: number, lines: DeductionInput[]) {
  const problems: { path: string; message: string }[] = [];
  if (sum(lines) > depositPaise) problems.push({ path: 'deductions', message: `Deductions can be at most the deposit held (${fmtRupees(depositPaise)})` });
  const seen = new Set<string>();
  for (const [i, l] of lines.entries()) {
    if (l.type === 'UNPAID_RENT') {
      if (!l.invoiceId) { problems.push({ path: `deductions.${i}.invoiceId`, message: 'Pick the invoice this unpaid rent belongs to' }); continue; }
      if (seen.has(l.invoiceId)) { problems.push({ path: `deductions.${i}.invoiceId`, message: 'That invoice is already deducted' }); continue; }
      seen.add(l.invoiceId);
      const inv = await tx.rentInvoice.findFirst({ where: { id: l.invoiceId, tenancyId, status: { in: ['DUE', 'PARTIALLY_PAID'] } }, select: { totalPaise: true, paidPaise: true } });
      if (!inv) problems.push({ path: `deductions.${i}.invoiceId`, message: 'That invoice is not an open invoice of this stay' });
      else if (l.amountPaise > inv.totalPaise - inv.paidPaise) problems.push({ path: `deductions.${i}.amountPaise`, message: `That invoice only has ${fmtRupees(inv.totalPaise - inv.paidPaise)} left to pay` });
    } else if (l.invoiceId) problems.push({ path: `deductions.${i}.invoiceId`, message: 'Only unpaid rent is linked to an invoice' });
  }
  if (problems.length) throw Errors.validation(problems);
}

async function replaceLines(tx: Tx, s: Full, lines: DeductionInput[], note: string | null | undefined) {
  await validateLines(tx, s.tenancyId, s.depositPaise, lines);
  await tx.depositDeduction.deleteMany({ where: { settlementId: s.id } });
  if (lines.length) await tx.depositDeduction.createMany({ data: lines.map((l) => ({ settlementId: s.id, type: l.type, description: l.description, amountPaise: l.amountPaise, invoiceId: l.invoiceId ?? null })) });
  const total = sum(lines);
  await tx.depositSettlement.update({ where: { id: s.id }, data: { deductionsPaise: total, refundPaise: s.depositPaise - total, ...(note !== undefined ? { note } : {}), version: { increment: 1 } } });
}

const meta = (s: Full) => ({ hostelId: s.hostelId, tenancyId: s.tenancyId, code: s.tenancy.code });
const reload = (db: Tx | typeof prisma, id: string) => db.depositSettlement.findUniqueOrThrow({ where: { id }, include });

async function loadFor(db: Tx | typeof prisma, actor: Actor, tenancyId: string, viewer: Viewer): Promise<Full> {
  let where: Prisma.DepositSettlementWhereInput;
  if (viewer === 'TENANT') where = { tenancyId, tenantId: actor.id, status: { not: 'DRAFT' } }; // a draft is the owner's working copy
  else if (viewer === 'OWNER') { requireRole(actor, 'OWNER'); where = { tenancyId, tenancy: { hostel: { ownerId: actor.id } } }; }
  else { requireRole(actor, 'ADMIN'); where = { tenancyId }; }
  const s = await db.depositSettlement.findFirst({ where, include });
  if (!s) throw Errors.notFound('Settlement'); // someone else's looks exactly like a missing one
  return s;
}

/** Starts the settlement when a stay ends with a deposit held: unpaid rent is pre-filled as deductions (never more than the deposit). Safe to call twice. */
export async function createDraft(tx: Tx, tenancyId: string) {
  if (await tx.depositSettlement.findUnique({ where: { tenancyId }, select: { id: true } })) return null;
  const t = await tx.tenancy.findUniqueOrThrow({ where: { id: tenancyId } });
  if (t.depositPaise <= 0 || !t.depositReceivedAt || !t.tenantId) return null;
  let left = t.depositPaise;
  const lines: DeductionInput[] = [];
  for (const inv of await openInvoicesOf(tx, tenancyId)) {
    const amount = Math.min(inv.balancePaise, left);
    if (amount <= 0) break;
    lines.push({ type: 'UNPAID_RENT', description: `Unpaid rent, invoice ${inv.number}`, amountPaise: amount, invoiceId: inv.id });
    left -= amount;
  }
  const total = sum(lines);
  const s = await tx.depositSettlement.create({
    data: { tenancyId, hostelId: t.hostelId, tenantId: t.tenantId, depositPaise: t.depositPaise, deductionsPaise: total, refundPaise: t.depositPaise - total, deductions: { create: lines.map((l) => ({ type: l.type, description: l.description, amountPaise: l.amountPaise, invoiceId: l.invoiceId })) } },
  });
  await recordAudit({ action: 'deposit.settlement.create', entityType: 'deposit_settlement', entityId: s.id, after: { depositPaise: t.depositPaise, prefilledDeductionsPaise: total }, metadata: { hostelId: t.hostelId, tenancyId, code: t.code } }, tx);
  return s.id;
}

/**
 * Pays the deposit out and books everything, once the settlement is AGREED: unpaid-rent deductions settle their invoices (a rent payment
 * by DEPOSIT), and for an online deposit the ledger moves the held money to the owner (deductions) and back to the tenant (refund).
 * Runs under the tenancy lock inside the caller's transaction.
 */
async function complete(tx: Tx, s: Full, payout: { method: 'ONLINE' | 'CASH' | 'UPI' | 'BANK' | null; reference?: string | null; providerRefundId?: string | null }, actorId: string | null, now: Date, effects: Effect[]) {
  const today = todayIn(s.tenancy.hostel.timezone, now);
  const rentLines = s.deductions.filter((d) => d.type === 'UNPAID_RENT' && d.invoiceId).sort((a, b) => a.invoiceId!.localeCompare(b.invoiceId!));
  for (const d of rentLines) {
    await lockInvoice(tx, d.invoiceId!);
    const inv = await tx.rentInvoice.findUniqueOrThrow({ where: { id: d.invoiceId! } });
    if (inv.status === 'VOID' || inv.totalPaise - inv.paidPaise < d.amountPaise) throw Errors.conflict('This settlement is out of date because rent changed. Ask the owner to update it.');
    await tx.rentPayment.create({ data: { receiptNo: newReceiptNumber(today), invoiceId: inv.id, tenancyId: inv.tenancyId, hostelId: inv.hostelId, tenantId: inv.tenantId, amountPaise: d.amountPaise, method: 'DEPOSIT', reference: `Deposit settlement ${s.tenancy.code}`, receivedOn: new Date(`${today}T00:00:00.000Z`), recordedById: actorId } });
    const paid = inv.paidPaise + d.amountPaise;
    await tx.rentInvoice.update({ where: { id: inv.id }, data: { paidPaise: paid, status: paid >= inv.totalPaise ? 'PAID' : 'PARTIALLY_PAID', paidAt: paid >= inv.totalPaise ? now : null, version: { increment: 1 } } });
  }
  if (online(s)) {
    const groupId = randomUUID();
    const entries = [
      { debitAccount: 'DEPOSIT_HELD' as const, creditAccount: 'OWNER_PAYABLE' as const, amountPaise: s.deductionsPaise, memo: `Deposit ${s.tenancy.code}: deductions to the owner` },
      { debitAccount: 'DEPOSIT_HELD' as const, creditAccount: 'GUEST' as const, amountPaise: s.refundPaise, memo: `Deposit ${s.tenancy.code}: refunded to the tenant` },
    ].filter((e) => e.amountPaise > 0);
    if (entries.length) await tx.ledgerEntry.createMany({ data: entries.map((e) => ({ ...e, groupId, tenancyId: s.tenancyId })) });
  }
  await tx.depositSettlement.update({ where: { id: s.id }, data: { status: 'COMPLETED', completedAt: now, payoutMethod: payout.method, payoutReference: payout.reference ?? null, providerRefundId: payout.providerRefundId ?? null, version: { increment: 1 } } });
  await recordAudit({ action: 'deposit.settlement.complete', entityType: 'deposit_settlement', entityId: s.id, after: { refundPaise: s.refundPaise, deductionsPaise: s.deductionsPaise, method: payout.method }, metadata: meta(s) }, tx);
  const ctx = { property: s.tenancy.hostel.name, hostelId: s.hostelId, tenancyId: s.tenancyId, code: s.tenancy.code, amount: fmtRupees(s.refundPaise) };
  if (s.tenancy.tenant) effects.push(...(await notifyTenancy(tx, 'settlement_completed', { ...ctx, audience: 'TENANT', to: { userId: s.tenancy.tenant.id, email: s.tenancy.tenant.email } })));
  effects.push(...(await notifyTenancy(tx, 'settlement_completed', { ...ctx, audience: 'OWNER', to: { userId: s.tenancy.hostel.ownerId, email: s.tenancy.hostel.owner.email } })));
}

/** AGREED -> the money moves. An online refund with something to return goes through the gateway (and is retried hourly if it is down); everything else completes now. */
async function settleAgreed(tx: Tx, s: Full, actorId: string | null, now: Date, effects: Effect[]): Promise<'completed' | 'waiting'> {
  if (s.refundPaise > 0 && online(s)) {
    await tx.depositSettlement.update({ where: { id: s.id }, data: { refundIdempotencyKey: s.refundIdempotencyKey ?? `deposit_refund_${s.id}` } });
    return 'waiting';
  }
  if (s.refundPaise > 0) return 'waiting'; // cash/UPI/bank: the owner records the payout
  await complete(tx, s, { method: null }, actorId, now, effects);
  return 'completed';
}

export const depositsService = {
  // ── reading ──
  async ownerGet(actor: Actor, tenancyId: string) {
    requireRole(actor, 'OWNER');
    // A stay that ended before settlements existed (or whose draft was never made) gets its draft on first look.
    const created = await prisma.$transaction(async (tx) => {
      const t = await tx.tenancy.findFirst({ where: { id: tenancyId, hostel: { ownerId: actor.id } }, select: { status: true } });
      if (!t) throw Errors.notFound('Stay');
      if (t.status !== 'ENDED') return false;
      await lockRow(tx, 'tenancies', tenancyId);
      return (await createDraft(tx, tenancyId)) !== null;
    });
    void created;
    return toSettlementDto(prisma, await loadFor(prisma, actor, tenancyId, 'OWNER'), 'OWNER');
  },
  async tenantGet(actor: Actor, tenancyId: string) { return toSettlementDto(prisma, await loadFor(prisma, actor, tenancyId, 'TENANT'), 'TENANT'); },
  async adminGet(actor: Actor, tenancyId: string) { return toSettlementDto(prisma, await loadFor(prisma, actor, tenancyId, 'ADMIN'), 'ADMIN'); },

  // ── the owner ──
  /** Saves the itemised deductions (replacing the old list). Only while the owner is still working on it. */
  async save(actor: Actor, tenancyId: string, input: SaveSettlementInput) {
    requireRole(actor, 'OWNER');
    return prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', tenancyId);
      const s = await loadFor(tx, actor, tenancyId, 'OWNER');
      if (s.status !== 'DRAFT' && s.status !== 'DISPUTED') throw Errors.conflict(s.status === 'PROPOSED' ? 'It was sent to the tenant. Take it back to change it.' : 'This settlement can no longer be changed');
      await replaceLines(tx, s, input.deductions, input.note ?? null);
      await recordAudit({ action: 'deposit.settlement.edit', entityType: 'deposit_settlement', entityId: s.id, after: { lines: input.deductions.length, deductionsPaise: sum(input.deductions) }, metadata: meta(s) }, tx);
      return toSettlementDto(tx, await reload(tx, s.id), 'OWNER');
    });
  },

  async addProof(actor: Actor, tenancyId: string, publicId: string) {
    requireRole(actor, 'OWNER');
    const pre = await loadFor(prisma, actor, tenancyId, 'OWNER');
    if (pre.status !== 'DRAFT' && pre.status !== 'DISPUTED') throw Errors.conflict('Proof can only be added while you are working on the settlement');
    const resource = await verifyUploadedAsset('DEPOSIT_PROOF', publicId, prefixFor.deposit(tenancyId));
    return prisma.$transaction(async (tx) => {
      if ((await tx.depositProof.count({ where: { settlementId: pre.id } })) >= MAX_PROOFS) throw Errors.conflict(`At most ${MAX_PROOFS} photos can be attached`);
      try {
        await tx.depositProof.create({ data: { settlementId: pre.id, publicId: resource.publicId, url: resource.secureUrl, uploadedById: actor.id } });
      } catch (e) {
        if (isUniqueViolation(e)) throw Errors.conflict('This photo is already attached');
        throw e;
      }
      await recordAudit({ action: 'deposit.settlement.proof', entityType: 'deposit_settlement', entityId: pre.id, after: { publicId }, metadata: meta(pre) }, tx);
      return toSettlementDto(tx, await reload(tx, pre.id), 'OWNER');
    });
  },

  async removeProof(actor: Actor, tenancyId: string, proofId: string) {
    requireRole(actor, 'OWNER');
    return prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', tenancyId);
      const s = await loadFor(tx, actor, tenancyId, 'OWNER');
      if (s.status !== 'DRAFT' && s.status !== 'DISPUTED') throw Errors.conflict('Proof can only change while you are working on the settlement');
      const gone = await tx.depositProof.deleteMany({ where: { id: proofId, settlementId: s.id } });
      if (gone.count === 0) throw Errors.notFound('Photo');
      return toSettlementDto(tx, await reload(tx, s.id), 'OWNER');
    });
  },

  /** Sends the settlement to the tenant, who has 7 days to accept or dispute. */
  async propose(actor: Actor, tenancyId: string) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', tenancyId);
      const s = await loadFor(tx, actor, tenancyId, 'OWNER');
      if (s.status !== 'DRAFT' && s.status !== 'DISPUTED') throw Errors.conflict('This settlement was already sent');
      await validateLines(tx, tenancyId, s.depositPaise, s.deductions.map((d) => ({ type: d.type, description: d.description, amountPaise: d.amountPaise, invoiceId: d.invoiceId ?? undefined })));
      await tx.depositSettlement.update({ where: { id: s.id }, data: { status: 'PROPOSED', proposedAt: new Date(), respondedAt: null, disputeNote: null, version: { increment: 1 } } });
      await recordAudit({ action: 'deposit.settlement.propose', entityType: 'deposit_settlement', entityId: s.id, before: { status: s.status }, after: { refundPaise: s.refundPaise, deductionsPaise: s.deductionsPaise }, metadata: meta(s) }, tx);
      if (s.tenancy.tenant) effects.push(...(await notifyTenancy(tx, 'settlement_proposed', { property: s.tenancy.hostel.name, hostelId: s.hostelId, tenancyId, code: s.tenancy.code, amount: fmtRupees(s.refundPaise), to: { userId: s.tenancy.tenant.id, email: s.tenancy.tenant.email } })));
      return toSettlementDto(tx, await reload(tx, s.id), 'OWNER');
    });
    await runEffects(effects);
    return dto;
  },

  /** Takes a proposal back to a draft (while the tenant has not answered). */
  async retract(actor: Actor, tenancyId: string) {
    requireRole(actor, 'OWNER');
    return prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', tenancyId);
      const s = await loadFor(tx, actor, tenancyId, 'OWNER');
      if (s.status !== 'PROPOSED') throw Errors.conflict('Only a settlement waiting for the tenant can be taken back');
      await tx.depositSettlement.update({ where: { id: s.id }, data: { status: 'DRAFT', proposedAt: null, version: { increment: 1 } } });
      await recordAudit({ action: 'deposit.settlement.retract', entityType: 'deposit_settlement', entityId: s.id, before: { status: 'PROPOSED' }, after: { status: 'DRAFT' }, metadata: meta(s) }, tx);
      return toSettlementDto(tx, await reload(tx, s.id), 'OWNER');
    });
  },

  /** Cash / UPI / bank deposits: the owner says how they paid the refund back. */
  async recordPayout(actor: Actor, tenancyId: string, input: { method: 'CASH' | 'UPI' | 'BANK'; reference?: string }) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', tenancyId);
      const s = await loadFor(tx, actor, tenancyId, 'OWNER');
      if (s.status !== 'AGREED') throw Errors.conflict(s.status === 'COMPLETED' ? 'This settlement is already complete' : 'The tenant has not agreed to the settlement yet');
      if (online(s)) throw Errors.conflict('This deposit was paid online, so it is refunded through the app automatically');
      if (s.refundPaise === 0) throw Errors.conflict('There is nothing to refund');
      await complete(tx, s, { method: input.method, reference: input.reference ?? null }, actor.id, new Date(), effects);
      return toSettlementDto(tx, await reload(tx, s.id), 'OWNER');
    });
    await runEffects(effects);
    return dto;
  },

  // ── the tenant ──
  async accept(actor: Actor, tenancyId: string) {
    return depositsService.agree(actor, tenancyId, { by: 'TENANT' });
  },

  async dispute(actor: Actor, tenancyId: string, note: string) {
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', tenancyId);
      const s = await loadFor(tx, actor, tenancyId, 'TENANT');
      if (s.status !== 'PROPOSED') throw Errors.conflict('There is nothing to dispute right now');
      await tx.depositSettlement.update({ where: { id: s.id }, data: { status: 'DISPUTED', disputeNote: note, respondedAt: new Date(), version: { increment: 1 } } });
      await recordAudit({ action: 'deposit.settlement.dispute', entityType: 'deposit_settlement', entityId: s.id, before: { status: 'PROPOSED' }, after: { status: 'DISPUTED', note }, metadata: meta(s) }, tx);
      effects.push(...(await notifyTenancy(tx, 'settlement_disputed', { property: s.tenancy.hostel.name, hostelId: s.hostelId, tenancyId, code: s.tenancy.code, reason: note, to: { userId: s.tenancy.hostel.ownerId, email: s.tenancy.hostel.owner.email } })));
      return toSettlementDto(tx, await reload(tx, s.id), 'TENANT');
    });
    await runEffects(effects);
    return dto;
  },

  /** An admin settles a dispute: their itemisation replaces the owner's and is final. */
  async resolve(actor: Actor, tenancyId: string, input: { deductions: DeductionInput[]; note: string }) {
    requireRole(actor, 'ADMIN');
    const effects: Effect[] = [];
    const out = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', tenancyId);
      const s = await loadFor(tx, actor, tenancyId, 'ADMIN');
      if (s.status !== 'DISPUTED') throw Errors.conflict('Only a disputed settlement can be resolved');
      await replaceLines(tx, s, input.deductions, input.note);
      await recordAudit({ action: 'deposit.settlement.resolve', entityType: 'deposit_settlement', entityId: s.id, after: { deductionsPaise: sum(input.deductions), note: input.note }, metadata: meta(s) }, tx);
      await tx.depositSettlement.update({ where: { id: s.id }, data: { resolvedByAdminId: actor.id } });
      return depositsService.finishAgreement(tx, await reload(tx, s.id), actor.id, effects, new Date(), { auto: false, admin: true });
    });
    await runEffects(effects);
    if (out.pendingOnline) await depositsService.payOutOnline(out.id);
    return toSettlementDto(prisma, await reload(prisma, out.id), 'ADMIN');
  },

  // ── agreeing (tenant accepted, or the 7 days passed) ──
  async agree(actor: Actor | null, tenancyId: string, how: { by: 'TENANT' } | { by: 'SYSTEM'; now: Date }) {
    const effects: Effect[] = [];
    const now = how.by === 'SYSTEM' ? how.now : new Date();
    const out = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', tenancyId);
      const s = how.by === 'TENANT' ? await loadFor(tx, actor!, tenancyId, 'TENANT') : await tx.depositSettlement.findUniqueOrThrow({ where: { tenancyId }, include });
      if (s.status !== 'PROPOSED') {
        if (how.by === 'SYSTEM') return null;
        throw Errors.conflict('There is nothing to accept right now');
      }
      return depositsService.finishAgreement(tx, s, actor?.id ?? null, effects, now, { auto: how.by === 'SYSTEM', admin: false });
    });
    if (!out) return null;
    await runEffects(effects);
    if (out.pendingOnline) await depositsService.payOutOnline(out.id);
    return toSettlementDto(prisma, await reload(prisma, out.id), how.by === 'TENANT' ? 'TENANT' : 'OWNER');
  },

  /** AGREED, then paid out or waiting for the payout. Called under the tenancy lock. */
  async finishAgreement(tx: Tx, s: Full, actorId: string | null, effects: Effect[], now: Date, how: { auto: boolean; admin: boolean }) {
    // The invoices must still match what was proposed: if rent changed meanwhile, the owner has to update the settlement.
    await validateLines(tx, s.tenancyId, s.depositPaise, s.deductions.map((d) => ({ type: d.type, description: d.description, amountPaise: d.amountPaise, invoiceId: d.invoiceId ?? undefined }))).catch(() => {
      throw Errors.conflict('This settlement is out of date because rent changed. Ask the owner to update it.');
    });
    await tx.depositSettlement.update({ where: { id: s.id }, data: { status: 'AGREED', agreedAt: now, autoAgreed: how.auto, respondedAt: s.respondedAt ?? now, version: { increment: 1 } } });
    await recordAudit({ action: how.admin ? 'deposit.settlement.agreed.admin' : how.auto ? 'deposit.settlement.agreed.auto' : 'deposit.settlement.accept', entityType: 'deposit_settlement', entityId: s.id, ...(how.auto ? { actorId: null, actorRole: 'SYSTEM' } : {}), before: { status: s.status }, after: { status: 'AGREED', refundPaise: s.refundPaise }, metadata: meta(s) }, tx);
    const fresh = await reload(tx, s.id);
    effects.push(...(await notifyTenancy(tx, 'settlement_agreed', { property: s.tenancy.hostel.name, hostelId: s.hostelId, tenancyId: s.tenancyId, code: s.tenancy.code, amount: fmtRupees(s.refundPaise), reason: how.admin ? 'resolved by support' : how.auto ? 'the tenant did not respond within 7 days' : null, to: { userId: s.tenancy.hostel.ownerId, email: s.tenancy.hostel.owner.email } })));
    const settled = await settleAgreed(tx, fresh, actorId, now, effects);
    return { id: s.id, pendingOnline: settled === 'waiting' && s.refundPaise > 0 && online(s) };
  },

  /** Pays an online deposit's refund through the gateway. Safe to call any number of times: the key is stable and the completion is atomic. */
  async payOutOnline(settlementId: string): Promise<'completed' | 'pending' | 'skipped'> {
    const s = await prisma.depositSettlement.findUnique({ where: { id: settlementId }, include: { ...include, tenancy: { select: { ...include.tenancy.select, orders: { where: { status: 'CAPTURED' }, select: { providerPaymentId: true }, take: 1 } } } } });
    if (!s || s.status !== 'AGREED' || s.tenancy.depositMethod !== 'ONLINE' || s.refundPaise <= 0) return 'skipped';
    const providerPaymentId = s.tenancy.orders[0]?.providerPaymentId;
    if (!providerPaymentId) {
      logger.error({ settlementId }, 'deposit refund without a provider payment id');
      return 'pending';
    }
    let providerRefundId: string;
    try {
      ({ providerRefundId } = await getPaymentProvider().refund({ providerPaymentId, amountPaise: s.refundPaise, idempotencyKey: s.refundIdempotencyKey ?? `deposit_refund_${s.id}` }));
    } catch (e) {
      logger.warn({ settlementId, err: (e as Error).message }, 'gateway deposit refund failed; will retry');
      return 'pending';
    }
    const effects: Effect[] = [];
    const done = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', s.tenancyId);
      const cur = await reload(tx, s.id);
      if (cur.status !== 'AGREED') return false; // someone else completed it
      await complete(tx, cur, { method: 'ONLINE', providerRefundId }, null, new Date(), effects);
      return true;
    });
    if (!done) return 'skipped';
    await runEffects(effects);
    return 'completed';
  },

  /** Hourly: retries refunds the gateway could not take, and tells admins about one stuck for 48 hours (once). */
  async retryPending(now = new Date()): Promise<{ completed: number; stuck: number }> {
    const rows = await prisma.depositSettlement.findMany({ where: { status: 'AGREED', refundPaise: { gt: 0 }, tenancy: { depositMethod: 'ONLINE' } }, orderBy: { agreedAt: 'asc' }, take: 50, select: { id: true, hostelId: true, refundPaise: true, agreedAt: true } });
    let completed = 0, stuck = 0;
    for (const r of rows) {
      const result = await depositsService.payOutOnline(r.id);
      if (result === 'completed') completed++;
      else if (result === 'pending' && r.agreedAt && now.getTime() - r.agreedAt.getTime() > GIVE_UP_AFTER_MS) {
        const already = await prisma.auditLog.count({ where: { action: 'deposit.refund.stuck', entityId: r.id } });
        if (already === 0) {
          await prisma.$transaction(async (tx) => {
            await recordAudit({ action: 'deposit.refund.stuck', entityType: 'deposit_settlement', entityId: r.id, outcome: 'FAILURE', actorRole: 'SYSTEM', actorId: null, metadata: { hostelId: r.hostelId } }, tx);
            await notifyAdmins({ type: 'SYSTEM', title: 'Deposit refund needs manual attention', body: `A deposit refund of ${fmtRupees(r.refundPaise)} could not be paid out after 48 hours.`, data: { settlementId: r.id } }, tx);
          });
          stuck++;
        }
      }
    }
    return { completed, stuck };
  },

  /** Hourly: a proposal nobody answered for 7 days is taken as accepted. */
  async autoAgree(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RESPOND_WITHIN_DAYS * 86_400_000);
    const stale = await prisma.depositSettlement.findMany({ where: { status: 'PROPOSED' satisfies DepositSettlementStatus, proposedAt: { lt: cutoff } }, select: { tenancyId: true }, take: 100, orderBy: { proposedAt: 'asc' } });
    let n = 0;
    for (const { tenancyId } of stale) {
      try {
        if (await depositsService.agree(null, tenancyId, { by: 'SYSTEM', now })) n++;
      } catch (e) {
        logger.warn({ tenancyId, err: (e as Error).message }, 'could not auto-agree a deposit settlement'); // e.g. rent changed: it stays PROPOSED for the owner to fix
      }
    }
    return n;
  },
};
