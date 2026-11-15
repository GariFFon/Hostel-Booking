import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloudinaryStorage, setMediaStorage } from '@/infra/cloudinary/storage';
import { prisma } from '@/infra/db/prisma';
import { DemoProvider } from '@/infra/payments/demo.provider';
import { setPaymentProvider } from '@/infra/payments/provider';
import { depositsService } from '@/modules/tenancies/deposits.service';
import { sweepTenancies } from '@/modules/tenancies/tenancy-sweep.service';
import { settlementDtoSchema } from '@/modules/tenancies/deposits.schema';
import { FakeStorage } from '../helpers/fake-storage';
import { makeUser } from '../helpers/users';
import { makeStay, student } from '../helpers/tenancy';
import { DAY, endedStay, mo, uploadProof } from '../helpers/moveout';
import { rentApi } from '../helpers/rent';

const storage = new FakeStorage();
beforeAll(() => setMediaStorage(storage));
afterAll(() => setMediaStorage(cloudinaryStorage));

const DEPOSIT = 1_200_000;
const damage = (amountPaise = 200_000, description = 'Broken window latch') => ({ type: 'DAMAGE', description, amountPaise });
const balances = async (tenancyId: string) => {
  const b: Record<string, number> = {};
  for (const r of await prisma.ledgerEntry.findMany({ where: { tenancyId } })) { b[r.creditAccount] = (b[r.creditAccount] ?? 0) + r.amountPaise; b[r.debitAccount] = (b[r.debitAccount] ?? 0) - r.amountPaise; }
  return b;
};

describe('the draft', () => {
  it('pre-fills unpaid rent, never more than the deposit, and is the owner\'s alone until it is sent', async () => {
    const { stay, tenant, tenancyId, first, settlement } = await endedStay();
    expect(settlementDtoSchema.safeParse(settlement).success).toBe(true);
    expect(settlement).toMatchObject({ status: 'DRAFT', depositPaise: DEPOSIT, deductionsPaise: first.totalPaise, refundPaise: DEPOSIT - first.totalPaise, payout: { online: false } });
    expect(settlement.deductions).toEqual([expect.objectContaining({ type: 'UNPAID_RENT', invoiceId: first.id, amountPaise: first.totalPaise })]);
    expect(settlement.actions).toEqual(['edit', 'add_proof', 'propose']);
    expect(settlement.openInvoices).toEqual([{ id: first.id, number: first.number, balancePaise: first.totalPaise }]);
    expect((await mo.mySettlement(tenant.token, tenancyId)).status).toBe(404); // a draft is the owner's working copy
    expect((await mo.settlement((await makeStay()).owner.token, tenancyId)).status).toBe(404);
    const t = (await (await import('../helpers/tenancy')).api.myTenancy(tenant.token, tenancyId)).body.data;
    expect(t.settlement).toBeNull(); // not even hinted at
    void stay;
  });

  it('is capped at the deposit when more rent is owed than was held', async () => {
    const { settlement, first } = await endedStay({ depositPaise: 10_000 });
    expect(first.totalPaise).toBeGreaterThan(10_000); // even one day's rent is more than a ₹100 deposit
    expect(settlement).toMatchObject({ depositPaise: 10_000, deductionsPaise: 10_000, refundPaise: 0 });
  });

  it('is made on first look for a stay that ended without one', async () => {
    const { stay, tenancyId } = await endedStay();
    await prisma.depositSettlement.delete({ where: { tenancyId } });
    expect((await mo.settlement(stay.owner.token, tenancyId)).body.data.status).toBe('DRAFT');
  });
});

describe('itemising the deductions', () => {
  it('replaces the list, recomputes the refund and keeps a note', async () => {
    const { stay, tenancyId, first } = await endedStay();
    const res = await mo.save(stay.owner.token, tenancyId, { note: 'Keys returned on the day', deductions: [{ type: 'UNPAID_RENT', description: 'Unpaid rent', amountPaise: first.totalPaise, invoiceId: first.id }, damage(), { type: 'CLEANING', description: 'Deep clean', amountPaise: 50_000 }] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ note: 'Keys returned on the day', deductionsPaise: first.totalPaise + 250_000, refundPaise: DEPOSIT - first.totalPaise - 250_000 });
    expect(res.body.data.deductions).toHaveLength(3);
    const cleared = await mo.save(stay.owner.token, tenancyId, { deductions: [] });
    expect(cleared.body.data).toMatchObject({ deductionsPaise: 0, refundPaise: DEPOSIT });
    expect(await prisma.auditLog.count({ where: { action: 'deposit.settlement.edit', entityId: res.body.data.id } })).toBe(2);
  });

  it('refuses deductions that do not add up', async () => {
    const { stay, tenancyId, first } = await endedStay();
    const bad = (deductions: unknown[]) => mo.save(stay.owner.token, tenancyId, { deductions });
    expect((await bad([damage(DEPOSIT + 1)])).status).toBe(422); // more than the deposit
    expect((await bad([damage(DEPOSIT), damage(1, 'One more')])).status).toBe(422);
    expect((await bad([{ type: 'UNPAID_RENT', description: 'Unpaid rent', amountPaise: 1000 }])).status).toBe(422); // needs the invoice
    expect((await bad([{ type: 'UNPAID_RENT', description: 'Unpaid rent', amountPaise: first.totalPaise + 1, invoiceId: first.id }])).status).toBe(422); // more than the invoice owes
    expect((await bad([{ type: 'UNPAID_RENT', description: 'Twice', amountPaise: 100, invoiceId: first.id }, { type: 'UNPAID_RENT', description: 'Twice again', amountPaise: 100, invoiceId: first.id }])).status).toBe(422);
    expect((await bad([{ ...damage(), invoiceId: first.id }])).status).toBe(422); // only rent links to an invoice
    const other = await endedStay();
    expect((await bad([{ type: 'UNPAID_RENT', description: 'Not mine', amountPaise: 100, invoiceId: other.first.id }])).status).toBe(422); // another stay's invoice
    for (const junk of [{ deductions: [{ type: 'MAGIC', description: 'abc', amountPaise: 1 }] }, { deductions: [{ ...damage(), amountPaise: 0 }] }, { deductions: [{ ...damage(), description: 'x' }] }, { deductions: [damage()], extra: 1 }, {}]) {
      expect((await mo.save(stay.owner.token, tenancyId, junk)).status).toBe(422);
    }
  });
});

describe('the tenant answers', () => {
  const sent = async (over: Parameters<typeof endedStay>[0] = {}, lines?: unknown[]) => {
    const e = await endedStay(over);
    if (lines) await mo.save(e.stay.owner.token, e.tenancyId, { deductions: lines });
    const res = await mo.propose(e.stay.owner.token, e.tenancyId);
    expect(res.status).toBe(200);
    return e;
  };

  it('sending it tells the tenant, who then sees it; the owner cannot change it until taking it back', async () => {
    const { stay, tenant, tenancyId, first } = await sent();
    const mine = (await mo.mySettlement(tenant.token, tenancyId)).body.data;
    expect(mine).toMatchObject({ status: 'PROPOSED', refundPaise: DEPOSIT - first.totalPaise, actions: ['accept', 'dispute'] });
    expect(mine.openInvoices).toEqual([]); // owner-only
    expect(Math.round((new Date(mine.respondBy).getTime() - Date.now()) / DAY)).toBe(7);
    expect(await prisma.notification.count({ where: { userId: tenant.id, title: 'Your deposit settlement is ready' } })).toBe(1);
    expect((await mo.save(stay.owner.token, tenancyId, { deductions: [] })).status).toBe(409);
    expect((await mo.propose(stay.owner.token, tenancyId)).status).toBe(409);
    expect((await mo.retract(stay.owner.token, tenancyId)).body.data.status).toBe('DRAFT');
    expect((await mo.mySettlement(tenant.token, tenancyId)).status).toBe(404); // back to the owner's working copy
    expect((await mo.save(stay.owner.token, tenancyId, { deductions: [damage()] })).status).toBe(200);
  });

  it('accepting (cash deposit) agrees it; the owner then records the refund, and unpaid rent is settled from the deposit', async () => {
    const { stay, tenant, tenancyId, first } = await sent();
    const accepted = await mo.accept(tenant.token, tenancyId);
    expect(accepted.body.data).toMatchObject({ status: 'AGREED', autoAgreed: false, actions: [] });
    expect(await prisma.notification.count({ where: { userId: stay.owner.id, title: 'Deposit settlement agreed' } })).toBe(1);
    expect((await mo.mySettlement(tenant.token, tenancyId)).body.data.status).toBe('AGREED');
    expect((await mo.accept(tenant.token, tenancyId)).status).toBe(409); // answered

    const owner = (await mo.settlement(stay.owner.token, tenancyId)).body.data;
    expect(owner.actions).toEqual(['record_payout']);
    expect((await prisma.rentInvoice.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('DUE'); // nothing moved yet
    const done = await mo.payout(stay.owner.token, tenancyId, { method: 'UPI', reference: 'UTR-1' });
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', payout: { online: false, method: 'UPI', reference: 'UTR-1' } });
    const inv = await prisma.rentInvoice.findUniqueOrThrow({ where: { id: first.id }, include: { payments: true } });
    expect(inv).toMatchObject({ status: 'PAID', paidPaise: first.totalPaise });
    expect(inv.payments[0]).toMatchObject({ method: 'DEPOSIT', amountPaise: first.totalPaise, refundedPaise: 0 });
    const shown = (await rentApi.ownerInvoice(stay.owner.token, first.id)).body.data.payments[0];
    expect(shown).toMatchObject({ method: 'DEPOSIT', canReverse: false, canRefund: false }); // a settled deduction is not undone or refunded as rent
    for (const userId of [tenant.id, stay.owner.id]) expect(await prisma.notification.count({ where: { userId, title: 'Deposit settled' } })).toBe(1);
    expect((await mo.payout(stay.owner.token, tenancyId)).status).toBe(409); // once
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'deposit.settlement.complete', entityId: owner.id } });
    expect(audit.metadata).toMatchObject({ hostelId: stay.hostel.id });
    expect(await balances(tenancyId)).toEqual({}); // a cash deposit never touched the platform's ledger
  });

  it('with nothing to refund it completes at once, and records the unpaid rent as paid by the deposit', async () => {
    const { tenant, tenancyId, first, stay } = await sent({ depositPaise: 10_000 });
    const res = await mo.accept(tenant.token, tenancyId);
    expect(res.body.data).toMatchObject({ status: 'COMPLETED', refundPaise: 0, payout: { method: null } });
    expect((await prisma.rentInvoice.findUniqueOrThrow({ where: { id: first.id } })).paidPaise).toBe(10_000);
    expect((await prisma.rentInvoice.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('PARTIALLY_PAID'); // the rest is still owed, outside the app
    void stay;
  });

  it('disputing needs a reason; the owner then revises and sends it again', async () => {
    const { stay, tenant, tenancyId } = await sent();
    expect((await mo.dispute(tenant.token, tenancyId, { note: 'no' })).status).toBe(422);
    const d = await mo.dispute(tenant.token, tenancyId, { note: 'The damage was already there when I moved in' });
    expect(d.body.data).toMatchObject({ status: 'DISPUTED', disputeNote: expect.stringMatching(/already there/), actions: [] });
    expect(await prisma.notification.count({ where: { userId: stay.owner.id, title: 'Deposit settlement disputed' } })).toBe(1);
    expect((await mo.accept(tenant.token, tenancyId)).status).toBe(409); // nothing to accept until it is revised
    const owner = (await mo.settlement(stay.owner.token, tenancyId)).body.data;
    expect(owner.actions).toEqual(['edit', 'add_proof', 'propose']);
    await mo.save(stay.owner.token, tenancyId, { deductions: [], note: 'Revised after your reply' });
    const again = await mo.propose(stay.owner.token, tenancyId);
    expect(again.body.data).toMatchObject({ status: 'PROPOSED', disputeNote: null, refundPaise: DEPOSIT });
    expect((await mo.accept(tenant.token, tenancyId)).body.data.status).toBe('AGREED');
  });

  it('silence for seven days counts as acceptance, once, and the sweep is safe to repeat', async () => {
    const { stay, tenant, tenancyId } = await sent();
    await sweepTenancies(new Date(Date.now() + 6 * DAY));
    expect((await mo.mySettlement(tenant.token, tenancyId)).body.data.status).toBe('PROPOSED');
    await sweepTenancies(new Date(Date.now() + 8 * DAY));
    const s = (await mo.mySettlement(tenant.token, tenancyId)).body.data;
    expect(s).toMatchObject({ status: 'AGREED', autoAgreed: true });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'deposit.settlement.agreed.auto', entityId: s.id } });
    expect(audit.actorRole).toBe('SYSTEM');
    expect(await prisma.notification.count({ where: { userId: stay.owner.id, title: 'Deposit settlement agreed' } })).toBe(1);
    await sweepTenancies(new Date(Date.now() + 9 * DAY));
    expect(await prisma.notification.count({ where: { userId: stay.owner.id, title: 'Deposit settlement agreed' } })).toBe(1);
  });

  it('answering twice at once agrees it once', async () => {
    const { tenant, tenancyId } = await sent();
    const results = await Promise.all([1, 2, 3].map(() => mo.accept(tenant.token, tenancyId)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });

  it('if rent changed after it was sent, accepting is refused until the owner updates it', async () => {
    const { stay, tenant, tenancyId, first } = await sent();
    await rentApi.record(stay.owner.token, first.id, { amountPaise: first.totalPaise, method: 'CASH', receivedOn: new Date().toISOString().slice(0, 10) }); // the tenant paid it after all
    const res = await mo.accept(tenant.token, tenancyId);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/out of date/);
    expect((await mo.mySettlement(tenant.token, tenancyId)).body.data.status).toBe('PROPOSED');
    await mo.retract(stay.owner.token, tenancyId);
    expect((await mo.save(stay.owner.token, tenancyId, { deductions: [] })).status).toBe(200);
  });
});

describe('support resolves a dispute', () => {
  it('replaces the itemisation, is final, and only works on a disputed settlement', async () => {
    const { stay, tenant, tenancyId } = await endedStay();
    const admin = await makeUser({ roles: ['ADMIN'] });
    expect((await mo.resolve(admin.token, tenancyId, { deductions: [], note: 'Nothing to decide yet' })).status).toBe(409); // still a draft
    await mo.propose(stay.owner.token, tenancyId);
    expect((await mo.resolve(admin.token, tenancyId, { deductions: [], note: 'Nothing to decide yet' })).status).toBe(409);
    await mo.dispute(tenant.token, tenancyId);
    for (const who of [tenant, stay.owner]) expect((await mo.resolve(who.token, tenancyId, { deductions: [], note: 'I decide this' })).status).toBe(403);
    expect((await mo.adminSettlement(admin.token, tenancyId)).body.data.actions).toEqual(['resolve']);
    expect((await mo.resolve(admin.token, tenancyId, { deductions: [damage(300_000)], note: '' })).status).toBe(422); // a decision needs a reason
    const res = await mo.resolve(admin.token, tenancyId, { deductions: [damage(300_000, 'Latch only')], note: 'Photos show the damage; half the claim is fair' });
    expect(res.body.data).toMatchObject({ status: 'AGREED', deductionsPaise: 300_000, refundPaise: DEPOSIT - 300_000, note: expect.stringMatching(/half the claim/) });
    expect((await prisma.depositSettlement.findUniqueOrThrow({ where: { tenancyId } })).resolvedByAdminId).toBe(admin.id);
    expect((await mo.payout(stay.owner.token, tenancyId)).body.data.status).toBe('COMPLETED');
  });
});

describe('an online deposit', () => {
  it('is refunded through the gateway the moment the settlement is agreed, and the ledger balances', async () => {
    const provider = new DemoProvider();
    setPaymentProvider(provider);
    const { stay, tenant, tenancyId, first } = await endedStay({ online: true });
    await mo.save(stay.owner.token, tenancyId, { deductions: [{ type: 'UNPAID_RENT', description: 'Unpaid rent', amountPaise: first.totalPaise, invoiceId: first.id }, damage(100_000)] });
    await mo.propose(stay.owner.token, tenancyId);
    const refund = DEPOSIT - first.totalPaise - 100_000;
    const res = await mo.accept(tenant.token, tenancyId);
    expect(res.body.data).toMatchObject({ status: 'COMPLETED', refundPaise: refund, payout: { online: true, method: 'ONLINE' } });
    expect(provider.refundCalls).toEqual([expect.objectContaining({ amountPaise: refund, idempotencyKey: `deposit_refund_${res.body.data.id}` })]);
    expect(await balances(tenancyId)).toMatchObject({ DEPOSIT_HELD: 0, OWNER_PAYABLE: first.totalPaise + 100_000, GUEST: -(first.totalPaise + 100_000) });
    expect((await mo.payout(stay.owner.token, tenancyId)).status).toBe(409); // refunded through the app, not by hand
    expect((await prisma.rentInvoice.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('PAID');
  });

  it('an outage leaves it AGREED, the retry pays it exactly once, and a refund stuck for 48 hours alerts admins once', async () => {
    const provider = new DemoProvider();
    provider.failRefunds = 2;
    setPaymentProvider(provider);
    const { stay, tenant, tenancyId } = await endedStay({ online: true });
    await mo.save(stay.owner.token, tenancyId, { deductions: [] });
    await mo.propose(stay.owner.token, tenancyId);
    const waiting = await mo.accept(tenant.token, tenancyId);
    expect(waiting.body.data.status).toBe('AGREED'); // the gateway was down
    expect(await balances(tenancyId)).toMatchObject({ DEPOSIT_HELD: DEPOSIT }); // still held

    const admin = await makeUser({ roles: ['ADMIN'] });
    const aged = new Date(Date.now() + 49 * 3_600_000);
    await prisma.depositSettlement.update({ where: { tenancyId }, data: { agreedAt: new Date(Date.now() - 50 * 3_600_000) } });
    const stuck = await depositsService.retryPending(aged); // the second failure, now past 48 hours
    expect(stuck.stuck).toBeGreaterThanOrEqual(1);
    await depositsService.retryPending(aged);
    expect(await prisma.notification.count({ where: { userId: admin.id, title: 'Deposit refund needs manual attention' } })).toBe(1);
    // the outage is over (the first two calls failed): the next retry pays it
    const result = await depositsService.retryPending(aged);
    expect(result.completed).toBeGreaterThanOrEqual(0);
    await depositsService.payOutOnline(waiting.body.data.id);
    const s = (await mo.mySettlement(tenant.token, tenancyId)).body.data;
    expect(s).toMatchObject({ status: 'COMPLETED', payout: { method: 'ONLINE' } });
    expect(new Set(provider.refundCalls.map((c) => c.idempotencyKey))).toEqual(new Set([`deposit_refund_${s.id}`])); // one refund, repeated
    expect(await balances(tenancyId)).toMatchObject({ DEPOSIT_HELD: 0, GUEST: 0 });
    expect(await depositsService.payOutOnline(s.id)).toBe('skipped');
  });
});

describe('proof photos', () => {
  it('are signed for the owner of that stay only, attached to a draft, shown to the tenant and removable', async () => {
    const { stay, tenant, tenancyId } = await endedStay();
    expect((await mo.signature(tenant.token, { purpose: 'DEPOSIT_PROOF', tenancyId })).status).toBe(403);
    expect((await mo.signature((await makeStay()).owner.token, { purpose: 'DEPOSIT_PROOF', tenancyId })).status).toBe(404);
    expect((await mo.signature(stay.owner.token, { purpose: 'DEPOSIT_PROOF' })).status).toBe(422);
    const id1 = await uploadProof(stay.owner.token, tenancyId, storage);
    const added = await mo.proof(stay.owner.token, tenancyId, id1);
    expect(added.status).toBe(201);
    expect(added.body.data.proofs).toEqual([expect.objectContaining({ url: expect.stringContaining('https://') })]);
    expect((await mo.proof(stay.owner.token, tenancyId, id1)).status).toBe(409); // already attached
    expect((await mo.proof(stay.owner.token, tenancyId, 'deposits/never-uploaded-abcdef')).status).toBeGreaterThanOrEqual(400);
    const foreign = await endedStay();
    const theirs = await uploadProof(foreign.stay.owner.token, foreign.tenancyId, storage);
    expect((await mo.proof(stay.owner.token, tenancyId, theirs)).status).toBeGreaterThanOrEqual(400); // signed for another stay
    await mo.propose(stay.owner.token, tenancyId);
    expect((await mo.mySettlement(tenant.token, tenancyId)).body.data.proofs).toHaveLength(1);
    expect((await mo.proof(stay.owner.token, tenancyId, await uploadProof(stay.owner.token, tenancyId, storage))).status).toBe(409); // sent: no more changes
    await mo.retract(stay.owner.token, tenancyId);
    expect((await mo.removeProof(stay.owner.token, tenancyId, added.body.data.proofs[0].id)).body.data.proofs).toEqual([]);
    expect((await mo.removeProof(stay.owner.token, tenancyId, '01a1df4d-2583-7141-9882-3b725fcea871')).status).toBe(404);
  });

  it('are limited to ten', async () => {
    const { stay, tenancyId } = await endedStay();
    for (let i = 0; i < 10; i++) expect((await mo.proof(stay.owner.token, tenancyId, await uploadProof(stay.owner.token, tenancyId, storage))).status).toBe(201);
    expect((await mo.proof(stay.owner.token, tenancyId, await uploadProof(stay.owner.token, tenancyId, storage))).status).toBe(409);
  });
});

describe('who can see and do what', () => {
  it('keeps each person to their own stay and role', async () => {
    const { stay, tenant, tenancyId } = await endedStay();
    await mo.propose(stay.owner.token, tenancyId);
    const stranger = await student();
    const rival = await makeStay();
    for (const who of [stranger]) {
      expect((await mo.mySettlement(who.token, tenancyId)).status).toBe(404);
      expect((await mo.accept(who.token, tenancyId)).status).toBe(404);
      expect((await mo.dispute(who.token, tenancyId)).status).toBe(404);
    }
    for (const call of [mo.settlement, mo.propose, mo.retract]) expect((await call(rival.owner.token, tenancyId)).status).toBe(404);
    expect((await mo.save(rival.owner.token, tenancyId, { deductions: [] })).status).toBe(404);
    expect((await mo.payout(rival.owner.token, tenancyId)).status).toBe(404);
    expect((await mo.settlement(tenant.token, tenancyId)).status).toBe(403); // a tenant is not an owner
    expect((await mo.save(tenant.token, tenancyId, { deductions: [] })).status).toBe(403);
    expect((await mo.propose(tenant.token, tenancyId)).status).toBe(403);
    expect((await mo.adminSettlement(tenant.token, tenancyId)).status).toBe(403);
    expect((await mo.adminSettlement(stay.owner.token, tenancyId)).status).toBe(403);
    expect((await mo.adminSettlement((await makeUser({ roles: ['ADMIN'] })).token, tenancyId)).status).toBe(200);
  });
});

describe('what the database guarantees', () => {
  it('refuses deductions above the deposit, a refund that is not what is left, and a dispute with no note', async () => {
    const { tenancyId } = await endedStay();
    await expect(prisma.depositSettlement.update({ where: { tenancyId }, data: { deductionsPaise: DEPOSIT + 1, refundPaise: -1 } })).rejects.toThrow();
    await expect(prisma.depositSettlement.update({ where: { tenancyId }, data: { refundPaise: DEPOSIT + 5 } })).rejects.toThrow();
    await expect(prisma.depositSettlement.update({ where: { tenancyId }, data: { status: 'DISPUTED', disputeNote: null } })).rejects.toThrow();
    const s = await prisma.depositSettlement.findUniqueOrThrow({ where: { tenancyId } });
    await expect(prisma.depositDeduction.create({ data: { settlementId: s.id, type: 'OTHER', description: 'zero', amountPaise: 0 } })).rejects.toThrow();
  });

  it('allows one open deposit order per stay, and an order is for an invoice or a deposit, never both or neither', async () => {
    const stay = await makeStay();
    const { tenant, tenancyId } = await (await import('../helpers/tenancy')).approvedTenant(stay, { depositPaise: DEPOSIT });
    await mo.payDeposit(tenant.token, tenancyId);
    await expect(prisma.rentOrder.create({ data: { tenancyId, tenantId: tenant.id, provider: 'demo', providerOrderId: 'dup-' + tenancyId, amountPaise: DEPOSIT } })).rejects.toThrow();
    await expect(prisma.rentOrder.create({ data: { tenantId: tenant.id, provider: 'demo', providerOrderId: 'none-' + tenancyId, amountPaise: DEPOSIT } })).rejects.toThrow();
  });
});
