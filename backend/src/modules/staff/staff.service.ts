import type { Prisma, StaffTrade } from '@/generated/prisma/client';
import { prisma } from '@/infra/db/prisma';
import { Errors } from '@/core/errors/app-error';
import type { Actor } from '@/core/context/request-context';
import { requireRole, requireVerifiedEmail } from '@/core/auth/rbac';
import { revokeAccessTokens } from '@/core/auth/revocation';
import { hashToken, newOpaqueToken } from '@/core/auth/tokens';
import { env } from '@/core/config/env';
import { enqueue } from '@/infra/queue/queue';
import { layout } from '@/infra/mail/templates';
import { recordAudit } from '@/modules/audit/audit.service';
import { stayModeOf } from '@/modules/hostels/property-mode';
import { WITH_STAFF } from '@/modules/complaints/complaints.status';
import { releaseComplaints } from '@/modules/complaints/complaints.release';
import { runEffects, type Effect } from '@/modules/complaints/complaints-notify';
import { notify } from '@/modules/notifications/notifications.service';
import type { AdminInviteInput, OwnerInviteInput } from './staff.schema';

type Tx = Prisma.TransactionClient;
const INVITE_TTL_DAYS = 7;
const TRADE_LABEL: Record<StaffTrade, string> = { ELECTRICIAN: 'electrician', PLUMBER: 'plumber', CARPENTER: 'carpenter', CLEANER: 'cleaner', COOK: 'cook', SECURITY: 'security guard', WARDEN: 'warden', NETWORK: 'Wi-Fi technician', OTHER: 'staff member' };

const nameOf = (u: { email: string; profile: { fullName: string; phone?: string | null } | null }) => u.profile?.fullName ?? u.email;
const userSelect = { select: { id: true, email: true, profile: { select: { fullName: true, phone: true } } } } as const;

/** Hostels the owner can staff: their own, live, and long-term (hotels take nightly bookings, so they have no tenants to complain). */
async function ownedLongTermHostels(tx: Tx, ownerId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = unique.length ? await tx.hostel.findMany({ where: { id: { in: unique }, ownerId, deletedAt: null }, select: { id: true, name: true, propertyType: true } }) : [];
  const bad = unique.filter((id) => !rows.find((r) => r.id === id && stayModeOf(r.propertyType) === 'TENANCY'));
  if (bad.length) throw Errors.validation([{ path: 'hostelIds', message: 'Staff can only work at your own hostels and PGs' }]);
  return rows;
}

const hostelsOf = (links: { hostel: { id: string; name: string } }[]) => links.map((l) => ({ id: l.hostel.id, name: l.hostel.name }));

async function openJobs(db: Tx | typeof prisma, staffIds: string[], hostelIds?: string[]) {
  if (staffIds.length === 0) return new Map<string | null, number>();
  const rows = await db.complaint.groupBy({ by: ['assignedStaffId'], where: { assignedStaffId: { in: staffIds }, status: { in: [...WITH_STAFF] }, ...(hostelIds ? { hostelId: { in: hostelIds } } : {}) }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.assignedStaffId, r._count._all]));
}

async function createInvite(tx: Tx, input: { email: string; trade: StaffTrade; ownerId: string | null; hostelIds: string[]; invitedBy: { id: string; name: string } }) {
  const email = input.email.trim().toLowerCase();
  const user = await tx.user.findFirst({ where: { email, deletedAt: null }, select: { id: true, staffProfile: { select: { userId: true } } } });
  if (user?.staffProfile) throw Errors.conflict('This person is already staff');
  const pending = await tx.staffInvite.findFirst({ where: { email, ownerId: input.ownerId, acceptedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
  if (pending) throw Errors.conflict('This person already has a pending invitation. Cancel it first to send a new one.');
  const token = newOpaqueToken();
  const invite = await tx.staffInvite.create({
    data: { email, tokenHash: hashToken(token), trade: input.trade, ownerId: input.ownerId, hostelIds: input.hostelIds, invitedById: input.invitedBy.id, expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000) },
  });
  await recordAudit({ action: 'staff.invite', entityType: 'staff_invite', entityId: invite.id, after: { email, trade: input.trade, vendor: input.ownerId === null }, metadata: { hostelIds: input.hostelIds, hostelId: input.hostelIds[0] ?? null } }, tx);
  const who = input.ownerId === null ? 'the platform' : input.invitedBy.name;
  const title = `${who} invited you to work as a ${TRADE_LABEL[input.trade]}`;
  const body = `Accept the invitation to receive and update maintenance jobs. It expires in ${INVITE_TTL_DAYS} days.`;
  if (user) await notify({ userId: user.id, type: 'STAFF_INVITED', title, body, data: { audience: 'STAFF' } }, tx);
  const { html, text } = layout(title, body, 'Accept invitation', `${env().FRONTEND_URL}/staff?invite=${encodeURIComponent(token)}`);
  const mail = { to: email, subject: title, html, text };
  return { invite, effects: [() => enqueue('mail', mail)] as Effect[] };
}

async function inviteDto(tx: Tx | typeof prisma, i: { id: string; email: string; trade: StaffTrade; ownerId: string | null; hostelIds: string[]; expiresAt: Date; createdAt: Date }) {
  const hostels = i.hostelIds.length ? await tx.hostel.findMany({ where: { id: { in: i.hostelIds } }, select: { id: true, name: true } }) : [];
  return { id: i.id, email: i.email, trade: i.trade, kind: (i.ownerId ? 'OWN' : 'VENDOR') as 'OWN' | 'VENDOR', hostels, expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString() };
}

async function profileOf(db: Tx | typeof prisma, userId: string) {
  const p = await db.staffProfile.findUnique({ where: { userId }, include: { assignments: { where: { active: true }, include: { hostel: { select: { id: true, name: true, city: true } } } } } });
  if (!p) throw Errors.notFound('Staff profile');
  const owner = p.ownerId ? await db.user.findUnique({ where: { id: p.ownerId }, select: { email: true, profile: { select: { fullName: true } } } }) : null;
  const load = await openJobs(db, [userId]);
  return {
    userId: p.userId, trade: p.trade, kind: (p.ownerId ? 'OWN' : 'VENDOR') as 'OWN' | 'VENDOR', status: p.status, employer: owner ? nameOf(owner) : null,
    hostels: p.assignments.map((a) => ({ id: a.hostel.id, name: a.hostel.name, city: a.hostel.city })), openJobs: load.get(userId) ?? 0,
  };
}

export const staffService = {
  // ── invitations ──
  async ownerInvite(actor: Actor, input: OwnerInviteInput) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await ownedLongTermHostels(tx, actor.id, input.hostelIds);
      const me = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { email: true, profile: { select: { fullName: true } } } });
      const r = await createInvite(tx, { email: input.email, trade: input.trade, ownerId: actor.id, hostelIds: [...new Set(input.hostelIds)], invitedBy: { id: actor.id, name: nameOf(me) } });
      effects.push(...r.effects);
      return inviteDto(tx, r.invite);
    });
    await runEffects(effects);
    return dto;
  },

  /** An admin invites a platform vendor: someone any owner can engage for their properties. */
  async adminInvite(actor: Actor, input: AdminInviteInput) {
    requireRole(actor, 'ADMIN');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      const r = await createInvite(tx, { email: input.email, trade: input.trade, ownerId: null, hostelIds: [], invitedBy: { id: actor.id, name: 'Admin' } });
      effects.push(...r.effects);
      return inviteDto(tx, r.invite);
    });
    await runEffects(effects);
    return dto;
  },

  async cancelInvite(actor: Actor, inviteId: string) {
    const isAdmin = actor.roles.includes('ADMIN');
    if (!isAdmin) requireRole(actor, 'OWNER');
    await prisma.$transaction(async (tx) => {
      const i = await tx.staffInvite.findFirst({ where: { id: inviteId, acceptedAt: null, cancelledAt: null, ...(isAdmin ? {} : { ownerId: actor.id }) } });
      if (!i) throw Errors.notFound('Invitation');
      await tx.staffInvite.update({ where: { id: i.id }, data: { cancelledAt: new Date() } });
      await recordAudit({ action: 'staff.invite.cancel', entityType: 'staff_invite', entityId: i.id, metadata: { hostelId: i.hostelIds[0] ?? null } }, tx);
    });
  },

  /** Becoming staff: the emailed token proves the invitation was meant for this address. Grants the STAFF role and the property access. */
  async accept(actor: Actor, token: string) {
    requireVerifiedEmail(actor);
    const found = await prisma.staffInvite.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!found) throw Errors.notFound('Invitation');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      const me = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { id: true, email: true, staffProfile: { select: { userId: true } } } });
      const i = await tx.staffInvite.findUniqueOrThrow({ where: { id: found.id } });
      if (i.acceptedAt || i.cancelledAt || me.email.toLowerCase() !== i.email) throw Errors.notFound('Invitation'); // wrong person or used up: looks like it does not exist
      if (i.expiresAt < new Date()) throw Errors.conflict('This invitation has expired. Ask for a new one.');
      if (me.staffProfile) throw Errors.conflict('You are already staff');

      await tx.staffProfile.create({ data: { userId: actor.id, trade: i.trade, ownerId: i.ownerId } });
      await tx.userRoleAssignment.upsert({ where: { userId_role: { userId: actor.id, role: 'STAFF' } }, update: {}, create: { userId: actor.id, role: 'STAFF' } });
      const hostels = i.ownerId ? await ownedLongTermHostels(tx, i.ownerId, i.hostelIds).catch(() => []) : []; // a property that was removed or turned into a hotel since is skipped
      for (const h of hostels) await tx.staffAssignment.create({ data: { staffUserId: actor.id, hostelId: h.id, assignedById: i.invitedById } });
      await tx.staffInvite.update({ where: { id: i.id }, data: { acceptedAt: new Date(), acceptedById: actor.id } });
      await recordAudit({ action: 'user.role.grant', entityType: 'user', entityId: actor.id, after: { role: 'STAFF', trade: i.trade }, metadata: { hostelIds: hostels.map((h) => h.id), hostelId: hostels[0]?.id ?? null } }, tx);
      await recordAudit({ action: 'staff.invite.accept', entityType: 'staff_invite', entityId: i.id, metadata: { hostelId: hostels[0]?.id ?? null } }, tx);
      if (i.ownerId) await notify({ userId: i.ownerId, type: 'STAFF_INVITED', title: 'Staff member joined', body: `${i.email} accepted your invitation to work as a ${TRADE_LABEL[i.trade]}.`, data: { audience: 'OWNER' } }, tx);
      return profileOf(tx, actor.id); // the caller's token does not carry the STAFF role yet, so this must not check it
    });
    await revokeAccessTokens(actor.id); // the old token lacks the STAFF role; the client refreshes to get a new one
    await runEffects(effects);
    return dto;
  },

  // ── the owner's team ──
  async ownerTeam(actor: Actor) {
    requireRole(actor, 'OWNER');
    const mine = await prisma.hostel.findMany({ where: { ownerId: actor.id, deletedAt: null }, select: { id: true } });
    const hostelIds = mine.map((h) => h.id);
    const profiles = await prisma.staffProfile.findMany({
      where: { OR: [{ ownerId: actor.id }, { ownerId: null, assignments: { some: { hostelId: { in: hostelIds } } } }] },
      include: { user: userSelect, assignments: { where: { hostelId: { in: hostelIds }, active: true }, include: { hostel: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    const load = await openJobs(prisma, profiles.map((p) => p.userId), hostelIds);
    const invites = await prisma.staffInvite.findMany({ where: { ownerId: actor.id, acceptedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    return {
      staff: profiles.map((p) => ({
        userId: p.userId, name: p.user.profile?.fullName ?? null, email: p.user.email, phone: p.user.profile?.phone ?? null, trade: p.trade, kind: (p.ownerId ? 'OWN' : 'VENDOR') as 'OWN' | 'VENDOR',
        status: p.status, hostels: hostelsOf(p.assignments), openJobs: load.get(p.userId) ?? 0, createdAt: p.createdAt.toISOString(),
      })),
      invites: await Promise.all(invites.map((i) => inviteDto(prisma, i))),
    };
  },

  /** Platform vendors an owner could engage (active, not employed by anyone), with where this owner already uses them. */
  async vendors(actor: Actor) {
    requireRole(actor, 'OWNER');
    const mine = (await prisma.hostel.findMany({ where: { ownerId: actor.id, deletedAt: null }, select: { id: true } })).map((h) => h.id);
    const rows = await prisma.staffProfile.findMany({
      where: { ownerId: null, status: 'ACTIVE' }, include: { user: userSelect, assignments: { where: { hostelId: { in: mine }, active: true }, include: { hostel: { select: { id: true, name: true } } } } }, orderBy: { createdAt: 'asc' },
    });
    return rows.map((p) => ({ userId: p.userId, name: p.user.profile?.fullName ?? null, trade: p.trade, hostels: hostelsOf(p.assignments) }));
  },

  /** Sets exactly which of the owner's properties a staff member (or an engaged vendor) works at. Removing one hands back their open jobs there. */
  async setHostels(actor: Actor, staffUserId: string, hostelIds: string[]) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    await prisma.$transaction(async (tx) => {
      const profile = await tx.staffProfile.findFirst({ where: { userId: staffUserId, status: 'ACTIVE', OR: [{ ownerId: actor.id }, { ownerId: null }] } });
      if (!profile) throw Errors.notFound('Staff member');
      const wanted = await ownedLongTermHostels(tx, actor.id, hostelIds);
      const mineAll = (await tx.hostel.findMany({ where: { ownerId: actor.id }, select: { id: true } })).map((h) => h.id);
      const current = await tx.staffAssignment.findMany({ where: { staffUserId, hostelId: { in: mineAll }, active: true }, select: { hostelId: true } });
      const wantedIds = new Set(wanted.map((h) => h.id));
      const removed = current.map((c) => c.hostelId).filter((id) => !wantedIds.has(id));
      const added = wanted.filter((h) => !current.some((c) => c.hostelId === h.id));
      for (const h of wanted) await tx.staffAssignment.upsert({ where: { staffUserId_hostelId: { staffUserId, hostelId: h.id } }, update: { active: true, assignedById: actor.id }, create: { staffUserId, hostelId: h.id, assignedById: actor.id } });
      if (removed.length) {
        await tx.staffAssignment.updateMany({ where: { staffUserId, hostelId: { in: removed } }, data: { active: false } });
        const r = await releaseComplaints(tx, { staffUserId, hostelIds: removed }, 'the staff member no longer works at this property');
        effects.push(...r.effects);
      }
      await recordAudit({ action: 'staff.assignments.set', entityType: 'staff', entityId: staffUserId, before: { hostelIds: current.map((c) => c.hostelId) }, after: { hostelIds: [...wantedIds] }, metadata: { hostelId: [...wantedIds, ...removed][0] ?? null, added: added.map((h) => h.id), removed } }, tx);
      if (added.length) await notify({ userId: staffUserId, type: 'STAFF_INVITED', title: 'You were added to a property', body: `You can now receive jobs at ${added.map((h) => h.name).join(', ')}.`, data: { audience: 'STAFF' } }, tx);
    });
    await runEffects(effects);
    return this.ownerTeam(actor);
  },

  /** Stops (or restores) a staff member. An owner can do this to their own staff; an admin to anyone. Stopping hands back every open job. */
  async setStatus(actor: Actor, staffUserId: string, status: 'ACTIVE' | 'INACTIVE') {
    const isAdmin = actor.roles.includes('ADMIN');
    if (!isAdmin) requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    await prisma.$transaction(async (tx) => {
      const p = await tx.staffProfile.findFirst({ where: { userId: staffUserId, ...(isAdmin ? {} : { ownerId: actor.id }) } });
      if (!p) throw Errors.notFound('Staff member'); // an owner cannot touch a vendor or another owner's staff
      if (p.status === status) throw Errors.conflict(`This person is already ${status === 'ACTIVE' ? 'active' : 'inactive'}`);
      await tx.staffProfile.update({ where: { userId: staffUserId }, data: { status } });
      if (status === 'INACTIVE') {
        await tx.staffAssignment.updateMany({ where: { staffUserId }, data: { active: false } });
        const r = await releaseComplaints(tx, { staffUserId }, 'the staff member was deactivated');
        effects.push(...r.effects);
      }
      const first = await tx.staffAssignment.findFirst({ where: { staffUserId }, select: { hostelId: true } });
      await recordAudit({ action: status === 'ACTIVE' ? 'staff.reactivate' : 'staff.deactivate', entityType: 'staff', entityId: staffUserId, before: { status: p.status }, after: { status }, metadata: { hostelId: first?.hostelId ?? null } }, tx);
    });
    await runEffects(effects);
  },

  // ── admin ──
  async adminList(actor: Actor) {
    requireRole(actor, 'ADMIN');
    const rows = await prisma.staffProfile.findMany({
      include: { user: userSelect, assignments: { where: { active: true }, include: { hostel: { select: { id: true, name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200,
    });
    const owners = new Map((await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.ownerId).filter((x): x is string => !!x) } }, select: { id: true, email: true, profile: { select: { fullName: true } } } })).map((o) => [o.id, nameOf(o)]));
    const load = await openJobs(prisma, rows.map((r) => r.userId));
    return rows.map((p) => ({
      userId: p.userId, name: p.user.profile?.fullName ?? null, email: p.user.email, phone: p.user.profile?.phone ?? null, trade: p.trade, kind: (p.ownerId ? 'OWN' : 'VENDOR') as 'OWN' | 'VENDOR', status: p.status,
      hostels: hostelsOf(p.assignments), openJobs: load.get(p.userId) ?? 0, createdAt: p.createdAt.toISOString(), ownerName: p.ownerId ? (owners.get(p.ownerId) ?? null) : null,
    }));
  },

  // ── the staff member themself ──
  me(actor: Actor) {
    requireRole(actor, 'STAFF');
    return profileOf(prisma, actor.id);
  },
};
