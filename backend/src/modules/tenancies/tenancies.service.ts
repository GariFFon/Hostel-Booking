import type { Prisma, TenancyStatus } from '@/generated/prisma/client';
import { prisma } from '@/infra/db/prisma';
import { Errors } from '@/core/errors/app-error';
import type { Actor } from '@/core/context/request-context';
import { requireRole, requireVerifiedEmail } from '@/core/auth/rbac';
import { hashToken, newOpaqueToken } from '@/core/auth/tokens';
import { addDays, parseDate, todayIn, toDateString } from '@/core/dates';
import { cursorArgs, toPage } from '@/core/http/pagination';
import { recordAudit } from '@/modules/audit/audit.service';
import { stayModeOf } from '@/modules/hostels/property-mode';
import { INVITE_TTL_DAYS, LIVE_TENANCY, MAX_BACKDATE_DAYS, MAX_MOVE_IN_DAYS_AHEAD, freeUnits, isUniqueViolation, lockRow, newTenancyCode } from './tenancy.rules';
import { tenancyInclude, toTenancyDto, type TenancyFull, type Viewer } from './tenancy.mapper';
import { fitInvoicesToStay, issueDueInvoices } from '@/modules/rent/rent-invoicing';
import { bedsChangedEffect, notifyTenancy, runEffects, type Effect } from './tenancy-notify';
import { fmtRupees } from '@/modules/bookings/booking-core';
import { createDraft } from './deposits.service';
import { liveOpenDepositOrder } from './deposit-online';
import type { CreateTenancyInput, GiveNoticeInput, MoveOutInput, UpdateTenancyTermsInput } from './tenancy.schema';

type Tx = Prisma.TransactionClient;
type ListQ = { limit: number; cursor?: string; status?: TenancyStatus; hostelId?: string };

/** Pre-move-in: the terms can still change and the stay can still be cancelled. */
const PRE_MOVE_IN: TenancyStatus[] = ['INVITED', 'PENDING_MOVE_IN'];

async function load(db: Tx | typeof prisma, actor: Actor, id: string, viewer: Viewer): Promise<TenancyFull> {
  let where: Prisma.TenancyWhereInput;
  if (viewer === 'TENANT') where = { id, tenantId: actor.id };
  else if (viewer === 'OWNER') { requireRole(actor, 'OWNER'); where = { id, hostel: { ownerId: actor.id } }; }
  else { requireRole(actor, 'ADMIN'); where = { id }; }
  const t = await db.tenancy.findFirst({ where, include: tenancyInclude });
  if (!t) throw Errors.notFound('Stay'); // someone else's stay looks exactly like a missing one
  return t;
}

const ownerEmail = async (tx: Tx, ownerId: string) => (await tx.user.findUniqueOrThrow({ where: { id: ownerId }, select: { email: true } })).email;

/** Applies one status change under a row lock, bumping the version, and writes the audit row. */
async function transition(tx: Tx, t: TenancyFull, to: TenancyStatus, data: Prisma.TenancyUncheckedUpdateInput, action: string, extra: Record<string, unknown> = {}) {
  const after = await tx.tenancy.update({ where: { id: t.id }, data: { ...data, status: to, version: { increment: 1 } }, include: tenancyInclude });
  await recordAudit({ action, entityType: 'tenancy', entityId: t.id, before: { status: t.status }, after: { status: to, ...extra }, metadata: { hostelId: t.hostelId, code: t.code } }, tx);
  return after;
}

/** The reason on invoices cancelled because notice was given: only these are brought back if the notice is withdrawn. */
const NOTICE_VOID_REASON = 'Stay ending (notice given)';
const MAX_NOTICE_DAYS_AHEAD = 365;

/** Rent stops at the last day: unpaid invoices for periods that begin after it are cancelled. Returns how many. */
async function voidInvoicesAfter(tx: Tx, tenancyId: string, lastDay: string, reason: string, now: Date) {
  const r = await tx.rentInvoice.updateMany({ where: { tenancyId, status: 'DUE', paidPaise: 0, periodStart: { gt: parseDate(lastDay) } }, data: { status: 'VOID', voidedAt: now, voidReason: reason, version: { increment: 1 } } });
  return r.count;
}

/**
 * Ends a running stay (moved out): frees the bed, stops billing, and starts the deposit settlement. Used by the owner's move-out and by
 * the hourly sweep once a notice period is over. Call under the tenancy row lock.
 */
export async function endTenancy(tx: Tx, t: TenancyFull, opts: { movedOutOn: string; by: 'OWNER' | 'SYSTEM'; note?: string | null; now?: Date }, effects: Effect[]) {
  const now = opts.now ?? new Date();
  const hostel = await tx.hostel.findUniqueOrThrow({ where: { id: t.hostelId }, select: { id: true, name: true, ownerId: true } });
  const voided = await voidInvoicesAfter(tx, t.id, opts.movedOutOn, 'Stay ended', now);
  const prorated = await fitInvoicesToStay(tx, t.id, opts.movedOutOn, now, effects);
  const draft = await createDraft(tx, t.id); // before the update below, so the returned stay already shows its settlement
  const after = await tx.tenancy.update({ where: { id: t.id }, data: { status: 'ENDED', endDate: parseDate(opts.movedOutOn), movedOutAt: now, version: { increment: 1 } }, include: tenancyInclude });
  await recordAudit({
    action: 'tenancy.move_out', entityType: 'tenancy', entityId: t.id, before: { status: t.status }, after: { status: 'ENDED', movedOutOn: opts.movedOutOn, voidedInvoices: voided, proratedInvoices: prorated, note: opts.note ?? undefined },
    metadata: { hostelId: t.hostelId, code: t.code, by: opts.by }, ...(opts.by === 'SYSTEM' ? { actorId: null, actorRole: 'SYSTEM' } : {}),
  }, tx);
  effects.push(bedsChangedEffect());
  const held = t.depositReceivedAt && t.depositPaise > 0 ? fmtRupees(t.depositPaise) : undefined;
  const ctx = { property: hostel.name, hostelId: hostel.id, tenancyId: t.id, code: t.code, date: opts.movedOutOn, amount: held };
  if (t.tenant) effects.push(...(await notifyTenancy(tx, 'ended', { ...ctx, audience: 'TENANT', to: { userId: t.tenant.id, email: t.tenant.email } })));
  effects.push(...(await notifyTenancy(tx, 'ended', { ...ctx, audience: 'OWNER', to: { userId: hostel.ownerId, email: await ownerEmail(tx, hostel.ownerId) } })));
  return { after, draft };
}

export const tenanciesService = {
  // ── notice and move-out ──
  /** Either side gives notice on a running stay. The move-out day must be at least the stay's notice period away. */
  async giveNotice(actor: Actor, id: string, input: GiveNoticeInput, as: 'TENANT' | 'OWNER') {
    if (as === 'OWNER') requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', id);
      const t = await load(tx, actor, id, as);
      if (t.status === 'NOTICE') throw Errors.conflict('Notice has already been given for this stay');
      if (t.status !== 'ACTIVE') throw Errors.conflict('Notice can only be given on a stay that has started');
      const hostel = await tx.hostel.findUniqueOrThrow({ where: { id: t.hostelId }, select: { timezone: true, ownerId: true, name: true } });
      const today = todayIn(hostel.timezone);
      const earliest = addDays(today, t.noticeDays);
      if (input.moveOutDate < earliest) throw Errors.validation([{ path: 'moveOutDate', message: t.noticeDays > 0 ? `This stay needs ${t.noticeDays} days' notice. The earliest move-out is ${earliest}.` : 'Choose a date from today' }]);
      if (input.moveOutDate > addDays(today, MAX_NOTICE_DAYS_AHEAD)) throw Errors.validation([{ path: 'moveOutDate', message: 'Choose a move-out date within the next year' }]);
      const now = new Date();
      const voided = await voidInvoicesAfter(tx, id, input.moveOutDate, NOTICE_VOID_REASON, now);
      const prorated = await fitInvoicesToStay(tx, id, input.moveOutDate, now, effects);
      const after = await transition(tx, t, 'NOTICE', { noticeGivenAt: now, noticeBy: as, noticeReason: input.reason ?? null, endDate: parseDate(input.moveOutDate) }, 'tenancy.notice.give', { by: as, moveOutDate: input.moveOutDate, reason: input.reason, voidedInvoices: voided, proratedInvoices: prorated });
      const ctx = { property: hostel.name, hostelId: t.hostelId, tenancyId: id, code: t.code, date: input.moveOutDate, reason: input.reason };
      if (as === 'TENANT') effects.push(...(await notifyTenancy(tx, 'notice_given', { ...ctx, audience: 'OWNER', to: { userId: hostel.ownerId, email: await ownerEmail(tx, hostel.ownerId) } })));
      else if (t.tenant) effects.push(...(await notifyTenancy(tx, 'notice_given', { ...ctx, audience: 'TENANT', to: { userId: t.tenant.id, email: t.tenant.email } })));
      return toTenancyDto(after, as);
    });
    await runEffects(effects);
    return dto;
  },

  /** Only the side that gave notice can take it back, while the stay is still running. */
  async withdrawNotice(actor: Actor, id: string, as: 'TENANT' | 'OWNER') {
    if (as === 'OWNER') requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', id);
      const t = await load(tx, actor, id, as);
      if (t.status !== 'NOTICE') throw Errors.conflict('There is no notice to withdraw');
      if (t.noticeBy !== as) throw Errors.conflict(as === 'TENANT' ? 'The owner gave this notice, so only the owner can withdraw it' : 'The tenant gave this notice, so only the tenant can withdraw it');
      const restored = await tx.rentInvoice.updateMany({ where: { tenancyId: id, status: 'VOID', voidReason: NOTICE_VOID_REASON, paidPaise: 0 }, data: { status: 'DUE', voidedAt: null, voidReason: null, version: { increment: 1 } } });
      const restoredFull = await fitInvoicesToStay(tx, id, null, new Date(), effects);
      const after = await transition(tx, t, 'ACTIVE', { noticeGivenAt: null, noticeBy: null, noticeReason: null, endDate: null }, 'tenancy.notice.withdraw', { by: as, restoredInvoices: restored.count, restoredFullMonth: restoredFull });
      const hostel = await tx.hostel.findUniqueOrThrow({ where: { id: t.hostelId }, select: { name: true, ownerId: true } });
      const ctx = { property: hostel.name, hostelId: t.hostelId, tenancyId: id, code: t.code };
      if (as === 'TENANT') effects.push(...(await notifyTenancy(tx, 'notice_withdrawn', { ...ctx, audience: 'OWNER', to: { userId: hostel.ownerId, email: await ownerEmail(tx, hostel.ownerId) } })));
      else if (t.tenant) effects.push(...(await notifyTenancy(tx, 'notice_withdrawn', { ...ctx, audience: 'TENANT', to: { userId: t.tenant.id, email: t.tenant.email } })));
      return toTenancyDto(after, as);
    });
    await runEffects(effects);
    return dto;
  },

  /** The owner records that the tenant has left. Works with or without notice (an early move-out). */
  async moveOut(actor: Actor, id: string, input: MoveOutInput) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', id);
      const t = await load(tx, actor, id, 'OWNER');
      if (t.status !== 'ACTIVE' && t.status !== 'NOTICE') throw Errors.conflict(t.status === 'ENDED' ? 'This stay has already ended' : 'Only a running stay can end with a move-out');
      const hostel = await tx.hostel.findUniqueOrThrow({ where: { id: t.hostelId }, select: { timezone: true } });
      const today = todayIn(hostel.timezone);
      const on = input.movedOutOn ?? today;
      if (on > today) throw Errors.validation([{ path: 'movedOutOn', message: 'The move-out day cannot be in the future. Give notice instead.' }]);
      if (t.activatedAt && on < toDateString(t.startDate)) throw Errors.validation([{ path: 'movedOutOn', message: 'The move-out day cannot be before the stay started' }]);
      const { after } = await endTenancy(tx, t, { movedOutOn: on, by: 'OWNER', note: input.note }, effects);
      return toTenancyDto(after, 'OWNER');
    });
    await runEffects(effects);
    return dto;
  },

  // ── owner adds or invites a tenant (people already living there, or who applied off-platform) ──
  async create(actor: Actor, input: CreateTenancyInput) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      const room = await tx.roomType.findFirst({ where: { id: input.roomTypeId, deletedAt: null, hostel: { ownerId: actor.id, deletedAt: null } }, include: { hostel: true } });
      if (!room) throw Errors.notFound('Room type');
      const hostel = room.hostel;
      if (stayModeOf(hostel.propertyType) !== 'TENANCY') throw Errors.conflict('Tenants are only added to hostels and PGs. Hotels take nightly bookings.');
      if (hostel.status === 'SUSPENDED') throw Errors.conflict('This listing is suspended');

      const today = todayIn(hostel.timezone);
      if (input.startDate < addDays(today, -MAX_BACKDATE_DAYS) || input.startDate > addDays(today, MAX_MOVE_IN_DAYS_AHEAD)) throw Errors.validation([{ path: 'startDate', message: 'Choose a start date within the last 3 years or the next 6 months' }]);

      const free = await freeUnits(tx, room.id);
      const unit = input.unitId ? free.find((u) => u.id === input.unitId) : free[0];
      if (!unit) throw Errors.conflict(input.unitId ? 'That bed is not free' : 'No beds are free in this room type. Add or free a unit first.');

      const email = input.tenantEmail.trim().toLowerCase();
      const user = await tx.user.findFirst({ where: { email, status: 'ACTIVE', deletedAt: null }, select: { id: true, email: true } });
      if (user?.id === actor.id) throw Errors.conflict("You can't add yourself as a tenant");
      if (user && (await tx.tenancy.findFirst({ where: { tenantId: user.id, status: { in: [...LIVE_TENANCY] } }, select: { id: true } }))) throw Errors.conflict('This person already has a stay');

      const rentPaise = input.rentPaise ?? room.basePricePaise;
      const depositPaise = input.depositPaise ?? hostel.depositMonths * rentPaise;
      if (input.depositReceived && depositPaise === 0) throw Errors.validation([{ path: 'depositReceived', message: 'There is no deposit to record' }]);
      const token = user ? undefined : newOpaqueToken();

      let t;
      try {
        t = await tx.tenancy.create({
          data: {
            code: newTenancyCode(), hostelId: hostel.id, roomTypeId: room.id, unitId: unit.id, tenantId: user?.id ?? null, status: 'INVITED',
            startDate: parseDate(input.startDate), rentPaise, depositPaise, dueDay: hostel.rentDueDay, graceDays: hostel.rentGraceDays, noticeDays: hostel.noticeDays, gstRateBps: hostel.rentGstBps, lateFeePaise: hostel.rentLateFeePaise,
            ...(input.depositReceived ? { depositReceivedAt: new Date(), depositMethod: input.depositReceived.method, depositReference: input.depositReceived.reference } : {}),
            emergencyContactName: input.emergencyContactName, emergencyContactPhone: input.emergencyContactPhone,
            inviteEmail: email, inviteTokenHash: token ? hashToken(token) : null, inviteExpiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000), createdById: actor.id,
          },
          include: tenancyInclude,
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw Errors.conflict('That bed was just taken, or this person already has a stay');
        throw e;
      }
      await recordAudit({ action: 'tenancy.create', entityType: 'tenancy', entityId: t.id, after: { code: t.code, unitId: unit.id, rentPaise, depositPaise, startDate: input.startDate }, metadata: { hostelId: hostel.id, via: 'invite', registered: Boolean(user) } }, tx);
      effects.push(bedsChangedEffect());
      effects.push(...(await notifyTenancy(tx, 'invited', { property: hostel.name, hostelId: hostel.id, tenancyId: t.id, code: t.code, inviteToken: token, to: { userId: user?.id, email } })));
      return toTenancyDto(t, 'OWNER');
    });
    await runEffects(effects);
    return dto;
  },

  // ── listing ──
  async listMine(actor: Actor, q: ListQ) {
    const rows = await prisma.tenancy.findMany({ where: { tenantId: actor.id, ...(q.status ? { status: q.status } : {}) }, include: tenancyInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q) });
    const { items, nextCursor } = toPage(rows, q.limit);
    return { items: items.map((t) => toTenancyDto(t, 'TENANT')), nextCursor };
  },
  async getMine(actor: Actor, id: string) { return toTenancyDto(await load(prisma, actor, id, 'TENANT'), 'TENANT'); },

  async ownerList(actor: Actor, q: ListQ) {
    requireRole(actor, 'OWNER');
    const rows = await prisma.tenancy.findMany({
      where: { hostel: { ownerId: actor.id }, ...(q.hostelId ? { hostelId: q.hostelId } : {}), ...(q.status ? { status: q.status } : {}) },
      include: tenancyInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q),
    });
    const { items, nextCursor } = toPage(rows, q.limit);
    return { items: items.map((t) => toTenancyDto(t, 'OWNER')), nextCursor };
  },
  async ownerGet(actor: Actor, id: string) { return toTenancyDto(await load(prisma, actor, id, 'OWNER'), 'OWNER'); },

  async adminList(actor: Actor, q: ListQ) {
    requireRole(actor, 'ADMIN');
    const rows = await prisma.tenancy.findMany({ where: { ...(q.hostelId ? { hostelId: q.hostelId } : {}), ...(q.status ? { status: q.status } : {}) }, include: tenancyInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q) });
    const { items, nextCursor } = toPage(rows, q.limit);
    return { items: items.map((t) => toTenancyDto(t, 'ADMIN')), nextCursor };
  },
  async adminGet(actor: Actor, id: string) { return toTenancyDto(await load(prisma, actor, id, 'ADMIN'), 'ADMIN'); },

  // ── tenant side of an invitation ──
  /** For someone who already has an account: the owner added them by email. */
  async accept(actor: Actor, id: string) {
    requireVerifiedEmail(actor);
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', id);
      const t = await load(tx, actor, id, 'TENANT');
      if (t.status !== 'INVITED') throw Errors.conflict('This invitation is no longer open');
      if (t.inviteExpiresAt && t.inviteExpiresAt < new Date()) throw Errors.conflict('This invitation has expired. Ask the owner to send a new one.');
      const after = await transition(tx, t, 'PENDING_MOVE_IN', { inviteTokenHash: null, inviteExpiresAt: null }, 'tenancy.accept');
      const owner = await tx.hostel.findUniqueOrThrow({ where: { id: t.hostelId }, select: { ownerId: true } });
      effects.push(...(await notifyTenancy(tx, 'invite_accepted', { property: t.hostel.name, hostelId: t.hostelId, tenancyId: t.id, code: t.code, to: { userId: owner.ownerId, email: await ownerEmail(tx, owner.ownerId) } })));
      return toTenancyDto(after, 'TENANT');
    });
    await runEffects(effects);
    return dto;
  },

  /** For someone who registered after the invite: the emailed token proves it was meant for their address. */
  async acceptByToken(actor: Actor, token: string) {
    requireVerifiedEmail(actor);
    const found = await prisma.tenancy.findUnique({ where: { inviteTokenHash: hashToken(token) }, select: { id: true } });
    if (!found) throw Errors.notFound('Invitation');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', found.id);
      const t = await tx.tenancy.findUnique({ where: { id: found.id }, include: tenancyInclude });
      const me = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { email: true } });
      if (!t || t.status !== 'INVITED' || t.tenantId !== null || me.email.toLowerCase() !== t.inviteEmail) throw Errors.notFound('Invitation'); // wrong person looks like a missing invite
      if (t.inviteExpiresAt && t.inviteExpiresAt < new Date()) throw Errors.conflict('This invitation has expired. Ask the owner to send a new one.');
      let after;
      try {
        after = await transition(tx, t, 'PENDING_MOVE_IN', { tenantId: actor.id, inviteTokenHash: null, inviteExpiresAt: null }, 'tenancy.accept', { via: 'token' });
      } catch (e) {
        if (isUniqueViolation(e)) throw Errors.conflict('You already have a stay');
        throw e;
      }
      const owner = await tx.hostel.findUniqueOrThrow({ where: { id: t.hostelId }, select: { ownerId: true } });
      effects.push(...(await notifyTenancy(tx, 'invite_accepted', { property: t.hostel.name, hostelId: t.hostelId, tenancyId: t.id, code: t.code, to: { userId: owner.ownerId, email: await ownerEmail(tx, owner.ownerId) } })));
      return toTenancyDto(after, 'TENANT');
    });
    await runEffects(effects);
    return dto;
  },

  async decline(actor: Actor, id: string) {
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', id);
      const t = await load(tx, actor, id, 'TENANT');
      if (!PRE_MOVE_IN.includes(t.status)) throw Errors.conflict('Only a stay that has not started can be declined');
      const after = await transition(tx, t, 'CANCELLED', { cancelledAt: new Date(), cancelReason: 'Declined by the tenant' }, 'tenancy.decline');
      const owner = await tx.hostel.findUniqueOrThrow({ where: { id: t.hostelId }, select: { ownerId: true } });
      effects.push(bedsChangedEffect());
      effects.push(...(await notifyTenancy(tx, 'invite_declined', { property: t.hostel.name, hostelId: t.hostelId, tenancyId: t.id, code: t.code, to: { userId: owner.ownerId, email: await ownerEmail(tx, owner.ownerId) } })));
      return toTenancyDto(after, 'TENANT');
    });
    await runEffects(effects);
    return dto;
  },

  // ── owner actions ──
  async updateTerms(actor: Actor, id: string, input: UpdateTenancyTermsInput) {
    requireRole(actor, 'OWNER');
    return prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', id);
      const t = await load(tx, actor, id, 'OWNER');
      if (!PRE_MOVE_IN.includes(t.status)) throw Errors.conflict('Terms can only change before move-in');
      if (input.expectedVersion !== undefined && input.expectedVersion !== t.version) throw Errors.conflict('This stay was changed elsewhere. Reload and try again.', { currentVersion: t.version });
      if (input.depositPaise !== undefined && input.depositPaise !== t.depositPaise && t.depositReceivedAt) throw Errors.conflict('The deposit was already received, so it can no longer change');
      const today = todayIn((await tx.hostel.findUniqueOrThrow({ where: { id: t.hostelId }, select: { timezone: true } })).timezone);
      if (input.startDate && input.startDate < today) throw Errors.validation([{ path: 'startDate', message: 'Start date cannot be in the past' }]);
      const { expectedVersion: _v, startDate, ...rest } = input;
      const after = await transition(tx, t, t.status, { ...rest, ...(startDate ? { startDate: parseDate(startDate) } : {}) }, 'tenancy.terms.update', { changed: Object.keys(input).filter((k) => k !== 'expectedVersion') });
      return toTenancyDto(after, 'OWNER');
    });
  },

  async recordDeposit(actor: Actor, id: string, input: { method: 'CASH' | 'UPI' | 'BANK'; reference?: string }) {
    requireRole(actor, 'OWNER');
    return prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', id);
      const t = await load(tx, actor, id, 'OWNER');
      if (t.status === 'CANCELLED' || t.status === 'ENDED') throw Errors.conflict('This stay is over');
      if (t.depositPaise === 0) throw Errors.conflict('There is no deposit due for this stay');
      if (t.depositReceivedAt) throw Errors.conflict('The deposit was already recorded');
      if (await liveOpenDepositOrder(tx, id)) throw Errors.conflict('The tenant is paying the deposit online right now. Try again in a few minutes.');
      const after = await transition(tx, t, t.status, { depositReceivedAt: new Date(), depositMethod: input.method, depositReference: input.reference ?? null }, 'tenancy.deposit.record', { method: input.method, amountPaise: t.depositPaise });
      return toTenancyDto(after, 'OWNER');
    });
  },

  /** Move-in: the tenant has arrived. Needs the deposit unless there is none. */
  async activate(actor: Actor, id: string) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', id);
      const t = await load(tx, actor, id, 'OWNER');
      if (t.status === 'INVITED') throw Errors.conflict('The tenant has not accepted yet');
      if (t.status !== 'PENDING_MOVE_IN') throw Errors.conflict('Only a stay waiting for move-in can be started');
      if (t.depositPaise > 0 && !t.depositReceivedAt) throw Errors.conflict('Record the deposit before move-in');
      const hostel = await tx.hostel.findUniqueOrThrow({ where: { id: t.hostelId } });
      const today = todayIn(hostel.timezone);
      const start = toDateString(t.startDate) > today ? today : toDateString(t.startDate); // moving in early pulls the start date forward
      const after = await transition(tx, t, 'ACTIVE', { activatedAt: new Date(), startDate: parseDate(start) }, 'tenancy.activate', { startDate: start });
      const tenant = t.tenant!;
      // Billing starts now: the first (possibly part-month) invoice is issued at move-in, later ones by the hourly rent sweep.
      effects.push(...(await issueDueInvoices(tx, t.id, new Date(), { id: actor.id, role: 'OWNER' })).effects);
      effects.push(...(await notifyTenancy(tx, 'started', { property: hostel.name, hostelId: hostel.id, tenancyId: t.id, code: t.code, to: { userId: tenant.id, email: tenant.email } })));
      effects.push(...(await notifyTenancy(tx, 'started', { property: hostel.name, hostelId: hostel.id, tenancyId: t.id, code: t.code, audience: 'OWNER', to: { userId: hostel.ownerId, email: await ownerEmail(tx, hostel.ownerId) } })));
      return toTenancyDto(after, 'OWNER');
    });
    await runEffects(effects);
    return dto;
  },

  /** Before move-in only. Ending a running stay is a move-out (phase 14). */
  async cancel(actor: Actor, id: string, reason: string) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', id);
      const t = await load(tx, actor, id, 'OWNER');
      if (!PRE_MOVE_IN.includes(t.status)) throw Errors.conflict(t.status === 'ACTIVE' || t.status === 'NOTICE' ? 'A running stay ends through move-out, not cancellation' : 'This stay is already over');
      const after = await transition(tx, t, 'CANCELLED', { cancelledAt: new Date(), cancelReason: reason }, 'tenancy.cancel', { reason });
      effects.push(bedsChangedEffect());
      const to = t.tenant ? { userId: t.tenant.id, email: t.tenant.email } : t.inviteEmail ? { email: t.inviteEmail } : null;
      if (to) effects.push(...(await notifyTenancy(tx, 'cancelled', { property: t.hostel.name, hostelId: t.hostelId, tenancyId: t.id, code: t.code, reason, to })));
      return toTenancyDto(after, 'OWNER');
    });
    await runEffects(effects);
    return dto;
  },
};
