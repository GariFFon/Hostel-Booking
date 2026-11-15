import type { ComplaintStatus, Prisma } from '@/generated/prisma/client';
import { prisma } from '@/infra/db/prisma';
import { Errors } from '@/core/errors/app-error';
import type { Actor } from '@/core/context/request-context';
import { requireRole, requireVerifiedEmail } from '@/core/auth/rbac';
import { cursorArgs, toPage } from '@/core/http/pagination';
import { recordAudit } from '@/modules/audit/audit.service';
import { verifyUploadedAsset } from '@/modules/media/asset-verifier';
import { prefixFor } from '@/modules/uploads/upload-policy';
import { loadViewable } from './complaints.access';
import { loadComplaint, lockComplaint, moveComplaint, type Mover } from './complaints.core';
import { complaintInclude, toComplaintDetail, toComplaintSummary, type ComplaintFull, type Viewer } from './complaints.mapper';
import { notifyComplaint, runEffects, type Effect, type Note } from './complaints-notify';
import {
  MAX_PHOTOS_PER_COMPLAINT, MAX_REOPENS, MAX_UNRESOLVED_PER_TENANT, REOPEN_WINDOW_DAYS, SLA_HOURS, TRADE_FOR_CATEGORY, isUniqueViolation, newComplaintCode, slaDueAt, visitIssue, windowIssue,
} from './complaints.rules';
import { SLA_RUNNING, UNRESOLVED, WITH_STAFF } from './complaints.status';
import type { CommentInput, CreateComplaintInput, OwnerAction, StaffAction, TenantAction } from './complaints.schema';

type Tx = Prisma.TransactionClient;
type ListQ = { limit: number; cursor?: string; status?: ComplaintStatus; hostelId?: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; assignedStaffId?: string; unassigned?: 'true' | 'false'; overdue?: 'true' | 'false'; open?: 'true' | 'false' };

const nameOf = (u: { profile: { fullName: string } | null; email: string }) => u.profile?.fullName ?? u.email;
const fullName = async (tx: Tx, id: string) => nameOf(await tx.user.findUniqueOrThrow({ where: { id }, select: { email: true, profile: { select: { fullName: true } } } }));

const when = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const span = (a: Date, b: Date) => `${when(a)} to ${b.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}`;

/** The tenant's free time, validated: a wrong one is a 422 on the field, in words. */
function parseWindow(fromIso: string, toIso: string, now: Date) {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const issue = windowIssue(from, to, now);
  if (issue) throw Errors.validation([issue]);
  return { from, to };
}

/** Books (or moves) the visit. It never changes the status: the window the tenant gave is their agreement to it. */
async function scheduleVisit(tx: Tx, c: ComplaintFull, a: { visitStart: string; visitEnd: string }, now: Date, by: 'OWNER' | 'STAFF', actorId: string) {
  if (!WITH_STAFF.includes(c.status)) throw Errors.conflict('A visit can be booked once the complaint is with a staff member');
  const start = new Date(a.visitStart);
  const end = new Date(a.visitEnd);
  const issue = visitIssue(start, end, now, { from: c.availableFrom, to: c.availableTo });
  if (issue) throw Errors.validation([issue]);
  const after = await tx.complaint.update({ where: { id: c.id }, data: { visitStart: start, visitEnd: end, visitMissedNotifiedAt: null, version: { increment: 1 } }, include: complaintInclude });
  await recordAudit({ action: 'complaint.schedule', entityType: 'complaint', entityId: c.id, before: c.visitStart ? { start: c.visitStart.toISOString(), end: c.visitEnd?.toISOString() } : undefined, after: { start: start.toISOString(), end: end.toISOString(), by }, metadata: { hostelId: c.hostelId, code: c.code } }, tx);
  const who = await fullName(tx, actorId);
  const notes: Note[] = [{ to: 'TENANT', type: 'COMPLAINT_UPDATED', title: 'Visit booked', body: `${c.code}: ${who} will come ${span(start, end)}.${c.allowEntryIfAway ? '' : ' Please be home.'}`, mail: true }];
  if (by === 'OWNER' && after.assigned) notes.push({ to: 'STAFF', type: 'COMPLAINT_UPDATED', title: `Visit set for ${c.code}`, body: `${c.title}: ${span(start, end)}.` });
  if (by === 'STAFF') notes.push({ to: 'OWNER', type: 'COMPLAINT_UPDATED', title: `Visit booked for ${c.code}`, body: `${who}: ${span(start, end)}.` });
  return { after, notes };
}

/** The free-to-work staff member for this kind of problem at this property: right trade, active, and the fewest jobs already. */
async function pickStaff(tx: Tx, hostelId: string, category: ComplaintFull['category']) {
  const trade = TRADE_FOR_CATEGORY[category];
  if (!trade) return null;
  const candidates = await tx.staffAssignment.findMany({ where: { hostelId, active: true, staff: { status: 'ACTIVE', trade } }, select: { staffUserId: true } });
  if (candidates.length === 0) return null;
  const ids = candidates.map((c) => c.staffUserId);
  const load = new Map((await tx.complaint.groupBy({ by: ['assignedStaffId'], where: { assignedStaffId: { in: ids }, status: { in: [...WITH_STAFF] } }, _count: { _all: true } })).map((r) => [r.assignedStaffId, r._count._all]));
  return [...ids].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b))[0]!;
}

async function page(where: Prisma.ComplaintWhereInput, q: ListQ, viewer: Viewer) {
  const rows = await prisma.complaint.findMany({ where, include: complaintInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q) });
  const { items, nextCursor } = toPage(rows, q.limit);
  const now = new Date();
  return { items: items.map((c) => toComplaintSummary(c, viewer, now)), nextCursor };
}

/** Runs one action under the complaint's row lock for the person it is meant for, then sends the notifications. */
async function act(actor: Actor, id: string, required: Viewer, fn: (tx: Tx, c: ComplaintFull, now: Date) => Promise<{ after: ComplaintFull; notes: Note[] }>) {
  const effects: Effect[] = [];
  const dto = await prisma.$transaction(async (tx) => {
    await lockComplaint(tx, id);
    const { c, viewer } = await loadViewable(tx, actor, id);
    if (viewer !== required) throw Errors.notFound('Complaint'); // another role's action on this complaint looks like it does not exist
    const now = new Date();
    const { after, notes } = await fn(tx, c, now);
    effects.push(...(await notifyComplaint(tx, after, notes)));
    return toComplaintDetail(after, viewer, now);
  });
  await runEffects(effects);
  return dto;
}

const MOVER = { TENANT: (a: Actor): Mover => ({ id: a.id, role: 'TENANT' }), OWNER: (a: Actor): Mover => ({ id: a.id, role: 'OWNER' }), STAFF: (a: Actor): Mover => ({ id: a.id, role: 'STAFF' }) };

export const complaintsService = {
  // ── filing ──
  async create(actor: Actor, input: CreateComplaintInput) {
    requireVerifiedEmail(actor);
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      const win = parseWindow(input.availableFrom, input.availableTo, new Date());
      const tenancy = await tx.tenancy.findFirst({ where: { tenantId: actor.id, status: { in: ['ACTIVE', 'NOTICE'] } }, include: { unit: { select: { label: true } } } });
      if (!tenancy) throw Errors.conflict('You can file a complaint once you have moved in to a stay');
      if ((await tx.complaint.count({ where: { raisedById: actor.id, status: { in: [...UNRESOLVED] } } })) >= MAX_UNRESOLVED_PER_TENANT) throw Errors.conflict(`You already have ${MAX_UNRESOLVED_PER_TENANT} open complaints. Wait for some to be resolved first.`);

      let code = newComplaintCode();
      for (let i = 0; i < 5 && (await tx.complaint.findUnique({ where: { code }, select: { id: true } })); i++) code = newComplaintCode();
      const now = new Date();
      const created = await tx.complaint.create({
        data: {
          code, hostelId: tenancy.hostelId, tenancyId: tenancy.id, unitId: tenancy.unitId, raisedById: actor.id, category: input.category, priority: input.priority, title: input.title,
          description: input.description, location: input.location ?? `Bed ${tenancy.unit.label}`, slaDueAt: slaDueAt(now, input.priority),
          availableFrom: win.from, availableTo: win.to, allowEntryIfAway: input.allowEntryIfAway,
        },
        include: complaintInclude,
      });
      await tx.complaintStatusHistory.create({ data: { complaintId: created.id, toStatus: 'OPEN', actorId: actor.id, actorRole: 'TENANT' } });
      await recordAudit({ action: 'complaint.create', entityType: 'complaint', entityId: created.id, after: { code, category: input.category, priority: input.priority }, metadata: { hostelId: created.hostelId, code } }, tx);

      let after = (await loadComplaint(tx, created.id)) ?? created; // include the history row just written
      const notes: Note[] = [{ to: 'OWNER', type: 'COMPLAINT_CREATED', title: 'New complaint', body: `${created.title} (${created.category.toLowerCase()}, ${created.priority.toLowerCase()}) from bed ${tenancy.unit.label} at ${created.hostel.name}. Tenant is free ${span(win.from, win.to)}.` }];
      const staffId = await pickStaff(tx, created.hostelId, created.category);
      if (staffId) {
        after = await moveComplaint(tx, created, 'ASSIGNED', { actor: { id: null, role: 'SYSTEM' }, action: 'auto_assign', note: `Auto-assigned to ${await fullName(tx, staffId)}`, data: { assignedStaffId: staffId } });
        notes.push({ to: 'STAFF', type: 'COMPLAINT_ASSIGNED', title: 'New job assigned', body: `${after.title} at ${after.hostel.name}, bed ${tenancy.unit.label}. Tenant is free ${span(win.from, win.to)}${input.allowEntryIfAway ? ' (you may go in if they are out)' : ''}. Due ${after.slaDueAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.`, mail: true });
        notes.push({ to: 'TENANT', type: 'COMPLAINT_UPDATED', title: 'Complaint assigned', body: `${after.code} was assigned to ${nameOf(after.assigned!)}.` });
      }
      effects.push(...(await notifyComplaint(tx, after, notes)));
      return toComplaintDetail(after, 'TENANT', now);
    });
    await runEffects(effects);
    return dto;
  },

  // ── reading ──
  listMine: (actor: Actor, q: ListQ) => page({ raisedById: actor.id, ...(q.status ? { status: q.status } : {}) }, q, 'TENANT'),

  ownerList(actor: Actor, q: ListQ) {
    requireRole(actor, 'OWNER');
    const where: Prisma.ComplaintWhereInput = { hostel: { ownerId: actor.id }, ...(q.hostelId ? { hostelId: q.hostelId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.priority ? { priority: q.priority } : {}), ...(q.assignedStaffId ? { assignedStaffId: q.assignedStaffId } : {}) };
    if (q.unassigned === 'true') { where.assignedStaffId = null; where.status = q.status ?? { in: ['OPEN', 'ACKNOWLEDGED', 'REOPENED'] }; }
    if (q.overdue === 'true') { where.status = { in: [...SLA_RUNNING] }; where.slaDueAt = { lt: new Date() }; }
    return page(where, q, 'OWNER');
  },

  staffList(actor: Actor, q: ListQ) {
    requireRole(actor, 'STAFF');
    return page({ assignedStaffId: actor.id, ...(q.status ? { status: q.status } : q.open === 'true' ? { status: { in: [...WITH_STAFF] } } : {}) }, q, 'STAFF');
  },

  adminList(actor: Actor, q: ListQ) {
    requireRole(actor, 'ADMIN');
    return page({ ...(q.hostelId ? { hostelId: q.hostelId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.priority ? { priority: q.priority } : {}) }, q, 'ADMIN');
  },

  async get(actor: Actor, id: string) {
    const { c, viewer } = await loadViewable(prisma, actor, id);
    return toComplaintDetail(c, viewer);
  },

  // ── talking and showing ──
  async addComment(actor: Actor, id: string, input: CommentInput) {
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockComplaint(tx, id);
      const { c, viewer } = await loadViewable(tx, actor, id);
      if (viewer === 'ADMIN') throw Errors.forbidden('Admins can read complaints but not post on them');
      if (c.status === 'CLOSED' || c.status === 'REJECTED') throw Errors.conflict('This complaint is closed');
      if (viewer === 'TENANT' && input.internal) throw Errors.validation([{ path: 'internal', message: 'Tenants cannot post internal notes' }]);
      await tx.complaintComment.create({ data: { complaintId: id, authorId: actor.id, authorRole: viewer, authorName: await fullName(tx, actor.id), body: input.body, internal: input.internal } });
      await tx.complaint.update({ where: { id }, data: { version: { increment: 1 } } });
      await recordAudit({ action: 'complaint.comment', entityType: 'complaint', entityId: id, after: { internal: input.internal, length: input.body.length }, metadata: { hostelId: c.hostelId, code: c.code } }, tx);
      const after = (await tx.complaint.findUniqueOrThrow({ where: { id }, include: complaintInclude }));
      const who = viewer === 'TENANT' ? 'the tenant' : viewer === 'OWNER' ? 'the owner' : 'staff';
      const notes: Note[] = [];
      // Everyone but the author and, for internal notes, the tenant.
      for (const to of ['TENANT', 'OWNER', 'STAFF'] as const) {
        if (to === viewer || (to === 'TENANT' && input.internal)) continue;
        notes.push({ to, type: 'COMPLAINT_UPDATED', title: `New message on ${c.code}`, body: `${who} wrote: ${input.body.length > 120 ? `${input.body.slice(0, 117)}...` : input.body}` });
      }
      effects.push(...(await notifyComplaint(tx, after, notes)));
      return toComplaintDetail(after, viewer);
    });
    await runEffects(effects);
    return dto;
  },

  /** Attaches a photo the person already uploaded with a signed request. The server confirms with the storage provider that it is real. */
  async attachMedia(actor: Actor, id: string, publicId: string) {
    const { c, viewer } = await loadViewable(prisma, actor, id);
    if (viewer === 'ADMIN') throw Errors.forbidden('Admins can read complaints but not add to them');
    if (c.status === 'CLOSED' || c.status === 'REJECTED') throw Errors.conflict('This complaint is closed');
    const resource = await verifyUploadedAsset('COMPLAINT_IMAGE', publicId, prefixFor.complaint(id));
    return prisma.$transaction(async (tx) => {
      if ((await tx.complaintMedia.count({ where: { complaintId: id } })) >= MAX_PHOTOS_PER_COMPLAINT) throw Errors.conflict(`A complaint can have at most ${MAX_PHOTOS_PER_COMPLAINT} photos`);
      try {
        await tx.complaintMedia.create({ data: { complaintId: id, publicId: resource.publicId, url: resource.secureUrl, width: resource.width, height: resource.height, uploadedById: actor.id, uploaderRole: viewer } });
      } catch (e) {
        if (isUniqueViolation(e)) throw Errors.conflict('This photo is already attached');
        throw e;
      }
      await recordAudit({ action: 'complaint.photo', entityType: 'complaint', entityId: id, after: { publicId }, metadata: { hostelId: c.hostelId, code: c.code } }, tx);
      return toComplaintDetail(await tx.complaint.findUniqueOrThrow({ where: { id }, include: complaintInclude }), viewer);
    });
  },

  // ── the tenant ──
  tenantAction(actor: Actor, id: string, a: TenantAction) {
    return act(actor, id, 'TENANT', async (tx, c, now) => {
      const me = MOVER.TENANT(actor);
      if (a.action === 'close') {
        const confirming = c.status === 'RESOLVED';
        const after = await moveComplaint(tx, c, 'CLOSED', { actor: me, action: confirming ? 'close' : 'withdraw', note: confirming ? 'Confirmed resolved by the tenant' : 'Withdrawn by the tenant' });
        const notes: Note[] = [{ to: 'OWNER', type: 'COMPLAINT_UPDATED', title: `${c.code} ${confirming ? 'confirmed resolved' : 'withdrawn'}`, body: `${c.title}: the tenant ${confirming ? 'confirmed it is fixed' : 'withdrew the complaint'}.` }];
        if (c.assigned) notes.push({ to: 'STAFF', type: 'COMPLAINT_UPDATED', title: `${c.code} ${confirming ? 'confirmed resolved' : 'withdrawn'}`, body: c.title });
        return { after, notes };
      }
      if (a.action === 'reopen') {
        if (!c.resolvedAt || now.getTime() - c.resolvedAt.getTime() > REOPEN_WINDOW_DAYS * 86_400_000) throw Errors.conflict(`A complaint can only be reopened within ${REOPEN_WINDOW_DAYS} days of being resolved`);
        if (c.reopenCount >= MAX_REOPENS) throw Errors.conflict(`This complaint was already reopened ${MAX_REOPENS} times. Please contact the owner directly.`);
        const newWin = a.availableFrom && a.availableTo ? parseWindow(a.availableFrom, a.availableTo, now) : null;
        if (!newWin && !(c.availableTo && c.availableTo > now)) throw Errors.validation([{ path: 'availableFrom', message: 'Tell us when you are free for the second visit' }]);
        await tx.complaintComment.create({ data: { complaintId: id, authorId: actor.id, authorRole: 'TENANT', authorName: await fullName(tx, actor.id), body: a.reason, internal: false } });
        const after = await moveComplaint(tx, c, 'REOPENED', {
          actor: me, action: 'reopen', note: a.reason, now,
          data: { reopenCount: { increment: 1 }, resolvedAt: null, slaDueAt: new Date(now.getTime() + SLA_HOURS[c.priority] * 3_600_000), slaBreachNotifiedAt: null,
                  visitStart: null, visitEnd: null, visitMissedNotifiedAt: null, // the old visit is history: book a new one
                  ...(newWin ? { availableFrom: newWin.from, availableTo: newWin.to, ...(a.allowEntryIfAway !== undefined ? { allowEntryIfAway: a.allowEntryIfAway } : {}) } : {}) },
        });
        const notes: Note[] = [{ to: 'OWNER', type: 'COMPLAINT_UPDATED', title: `${c.code} reopened`, body: `The tenant says it is not fixed: ${a.reason}` }];
        if (c.assigned) notes.push({ to: 'STAFF', type: 'COMPLAINT_UPDATED', title: `${c.code} reopened`, body: `The tenant says it is not fixed: ${a.reason}`, mail: true });
        return { after, notes };
      }
      if (a.action === 'set_availability') {
        if (['RESOLVED', 'CLOSED', 'REJECTED'].includes(c.status)) throw Errors.conflict('This complaint is no longer open');
        const win = parseWindow(a.availableFrom, a.availableTo, now);
        const visitFits = c.visitStart && c.visitEnd && c.visitStart >= win.from && c.visitEnd <= win.to;
        const dropVisit = !!c.visitStart && !visitFits;
        const after = await tx.complaint.update({
          where: { id: c.id }, data: { availableFrom: win.from, availableTo: win.to, allowEntryIfAway: a.allowEntryIfAway, ...(dropVisit ? { visitStart: null, visitEnd: null, visitMissedNotifiedAt: null } : {}), version: { increment: 1 } }, include: complaintInclude,
        });
        await recordAudit({ action: 'complaint.availability', entityType: 'complaint', entityId: c.id, after: { from: win.from.toISOString(), to: win.to.toISOString(), allowEntryIfAway: a.allowEntryIfAway, visitCleared: dropVisit }, metadata: { hostelId: c.hostelId, code: c.code } }, tx);
        const body = `${c.code}: the tenant is now free ${span(win.from, win.to)}.${dropVisit ? ' The booked visit no longer fits: please book a new time.' : ''}`;
        const notes: Note[] = [{ to: 'OWNER', type: 'COMPLAINT_UPDATED', title: 'Tenant changed their free time', body }];
        if (c.assigned) notes.push({ to: 'STAFF', type: 'COMPLAINT_UPDATED', title: 'Tenant changed their free time', body, mail: dropVisit });
        return { after, notes };
      }
      // rate
      if (c.rating !== null) throw Errors.conflict('You already rated this complaint');
      if (!(c.status === 'RESOLVED' || (c.status === 'CLOSED' && c.resolvedAt))) throw Errors.conflict('You can rate a complaint once it has been resolved');
      const after = await tx.complaint.update({ where: { id: c.id }, data: { rating: a.rating, feedback: a.feedback ?? null, version: { increment: 1 } }, include: complaintInclude });
      await recordAudit({ action: 'complaint.rate', entityType: 'complaint', entityId: c.id, after: { rating: a.rating }, metadata: { hostelId: c.hostelId, code: c.code } }, tx);
      return { after, notes: c.assigned ? [{ to: 'STAFF' as const, type: 'COMPLAINT_UPDATED' as const, title: `Rated ${a.rating}/5`, body: `${c.code}: ${a.feedback ?? 'The tenant rated your work.'}` }] : [] };
    });
  },

  // ── the owner ──
  ownerAction(actor: Actor, id: string, a: OwnerAction) {
    requireRole(actor, 'OWNER');
    return act(actor, id, 'OWNER', async (tx, c) => {
      const me = MOVER.OWNER(actor);
      switch (a.action) {
        case 'acknowledge': {
          const after = await moveComplaint(tx, c, 'ACKNOWLEDGED', { actor: me, action: 'acknowledge' });
          return { after, notes: [{ to: 'TENANT', type: 'COMPLAINT_UPDATED', title: 'Complaint seen', body: `${c.code}: the owner has seen your complaint and will arrange a fix.` }] };
        }
        case 'assign': {
          const link = await tx.staffAssignment.findFirst({ where: { staffUserId: a.staffUserId, hostelId: c.hostelId, active: true, staff: { status: 'ACTIVE' } }, select: { staffUserId: true } });
          if (!link) throw Errors.validation([{ path: 'staffUserId', message: 'This person is not working at this property' }]);
          const previous = c.assigned;
          const after = await moveComplaint(tx, c, 'ASSIGNED', { actor: me, action: previous ? 'reassign' : 'assign', note: a.note ?? `Assigned to ${await fullName(tx, a.staffUserId)}`, data: { assignedStaffId: a.staffUserId, ...(previous && previous.id !== a.staffUserId ? { visitStart: null, visitEnd: null, visitMissedNotifiedAt: null } : {}) } });
          if (previous && previous.id !== a.staffUserId) await tx.notification.create({ data: { userId: previous.id, type: 'COMPLAINT_UPDATED', title: `${c.code} reassigned`, body: `${c.title} was given to someone else.`, data: { complaintId: c.id, code: c.code, hostelId: c.hostelId, audience: 'STAFF' } } });
          return { after, notes: [
            { to: 'STAFF', type: 'COMPLAINT_ASSIGNED', title: 'New job assigned', body: `${c.title} at ${c.hostel.name}, bed ${c.tenancy.unit.label}.${a.note ? ` Note: ${a.note}` : ''}`, mail: true },
            { to: 'TENANT', type: 'COMPLAINT_UPDATED', title: 'Complaint assigned', body: `${c.code} was assigned to ${nameOf(after.assigned!)}.` },
          ] };
        }
        case 'unassign': {
          const previous = c.assigned;
          const after = await moveComplaint(tx, c, 'OPEN', { actor: me, action: 'unassign', note: 'Taken off staff', data: { assignedStaffId: null, visitStart: null, visitEnd: null, visitMissedNotifiedAt: null } });
          if (previous) await tx.notification.create({ data: { userId: previous.id, type: 'COMPLAINT_UPDATED', title: `${c.code} taken back`, body: `${c.title} is no longer assigned to you.`, data: { complaintId: c.id, code: c.code, hostelId: c.hostelId, audience: 'STAFF' } } });
          return { after, notes: [] };
        }
        case 'reject': {
          const after = await moveComplaint(tx, c, 'REJECTED', { actor: me, action: 'reject', note: a.reason });
          return { after, notes: [{ to: 'TENANT', type: 'COMPLAINT_UPDATED', title: 'Complaint not accepted', body: `${c.code}: ${a.reason}` }] };
        }
        case 'resolve': {
          const after = await moveComplaint(tx, c, 'RESOLVED', { actor: me, action: 'resolve', note: a.note, data: { resolutionNote: a.note } });
          return { after, notes: [{ to: 'TENANT', type: 'COMPLAINT_RESOLVED', title: 'Complaint resolved', body: `${c.code}: ${a.note} Please confirm it is fixed, or reopen it within ${REOPEN_WINDOW_DAYS} days.`, mail: true }] };
        }
        case 'schedule':
          return scheduleVisit(tx, c, a, new Date(), 'OWNER', actor.id);
        case 'priority': {
          if (a.priority === c.priority) throw Errors.conflict(`It is already ${a.priority.toLowerCase()} priority`);
          const due = slaDueAt(c.createdAt, a.priority);
          const after = await tx.complaint.update({ where: { id: c.id }, data: { priority: a.priority, slaDueAt: due, slaBreachNotifiedAt: due > new Date() ? null : c.slaBreachNotifiedAt, version: { increment: 1 } }, include: complaintInclude });
          await recordAudit({ action: 'complaint.priority', entityType: 'complaint', entityId: c.id, before: { priority: c.priority }, after: { priority: a.priority }, metadata: { hostelId: c.hostelId, code: c.code } }, tx);
          return { after, notes: c.assigned ? [{ to: 'STAFF', type: 'COMPLAINT_UPDATED', title: `${c.code} is now ${a.priority.toLowerCase()} priority`, body: c.title }] : [] };
        }
      }
    });
  },

  // ── the staff member it is assigned to ──
  staffAction(actor: Actor, id: string, a: StaffAction) {
    requireRole(actor, 'STAFF');
    return act(actor, id, 'STAFF', async (tx, c) => {
      const me = MOVER.STAFF(actor);
      if (a.action === 'start') {
        const after = await moveComplaint(tx, c, 'IN_PROGRESS', { actor: me, action: 'start' });
        return { after, notes: [{ to: 'TENANT', type: 'COMPLAINT_UPDATED', title: 'Work started', body: `${c.code}: ${nameOf(c.assigned!)} has started on it.` }] };
      }
      if (a.action === 'schedule') return scheduleVisit(tx, c, a, new Date(), 'STAFF', actor.id);
      if (a.action === 'hold') {
        const after = await moveComplaint(tx, c, 'ON_HOLD', { actor: me, action: 'hold', note: a.reason });
        return { after, notes: [{ to: 'TENANT', type: 'COMPLAINT_UPDATED', title: 'Work on hold', body: `${c.code}: ${a.reason}` }, { to: 'OWNER', type: 'COMPLAINT_UPDATED', title: `${c.code} on hold`, body: a.reason }] };
      }
      const after = await moveComplaint(tx, c, 'RESOLVED', { actor: me, action: 'resolve', note: a.note, data: { resolutionNote: a.note } });
      return { after, notes: [
        { to: 'TENANT', type: 'COMPLAINT_RESOLVED', title: 'Complaint resolved', body: `${c.code}: ${a.note} Please confirm it is fixed, or reopen it within ${REOPEN_WINDOW_DAYS} days.`, mail: true },
        { to: 'OWNER', type: 'COMPLAINT_UPDATED', title: `${c.code} resolved`, body: `${nameOf(c.assigned!)}: ${a.note}` },
      ] };
    });
  },
};

