import type { HostelStatus } from '@/generated/prisma/client';
import { requireRole } from '@/core/auth/rbac';
import type { Actor } from '@/core/context/request-context';
import { Errors } from '@/core/errors/app-error';
import { cursorArgs, toPage } from '@/core/http/pagination';
import { invalidateHostel } from '@/infra/cache/invalidation';
import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';
import { notify } from '@/modules/notifications/notifications.service';
import { hostelInclude, toHostelDto, toHostelSummary } from './hostels.mapper';
import { assertHostelTransition } from './hostels.status';

const ownerSelect = { select: { id: true, email: true, profile: { select: { fullName: true, phone: true } }, ownerProfile: { select: { kycStatus: true, businessName: true } } } };

async function loadForAdmin(actor: Actor, hostelId: string) {
  requireRole(actor, 'ADMIN');
  const hostel = await prisma.hostel.findFirst({ where: { id: hostelId, deletedAt: null }, include: { ...hostelInclude, owner: ownerSelect } });
  if (!hostel) throw Errors.notFound('Hostel');
  return hostel;
}

async function transition(actor: Actor, hostelId: string, to: HostelStatus, opts: { reason?: string; action: string; notice?: { type: 'HOSTEL_APPROVED' | 'HOSTEL_REJECTED' | 'SYSTEM'; title: string; body: (name: string) => string } }) {
  const hostel = await loadForAdmin(actor, hostelId);
  assertHostelTransition(hostel.status, to, 'ADMIN');
  if (to === 'APPROVED' && hostel.owner.ownerProfile?.kycStatus !== 'APPROVED') throw Errors.conflict('The owner has not passed KYC verification yet');
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.hostel.update({
      where: { id: hostelId },
      data: {
        status: to, version: { increment: 1 },
        rejectionReason: to === 'REJECTED' || to === 'SUSPENDED' ? (opts.reason ?? null) : null,
        ...(to === 'APPROVED' ? { approvedAt: new Date(), approvedById: actor.id } : {}),
      },
      include: { ...hostelInclude, owner: ownerSelect },
    });
    await recordAudit({ action: opts.action, entityType: 'hostel', entityId: hostelId, before: { status: hostel.status }, after: { status: to }, metadata: opts.reason ? { reason: opts.reason } : undefined }, tx);
    if (opts.notice) {
      await notify({ userId: hostel.ownerId, type: opts.notice.type, title: opts.notice.title, body: opts.notice.body(hostel.name) + (opts.reason ? ` Reason: ${opts.reason}` : ''), data: { hostelId } }, tx);
    }
    return { ...toHostelDto(updated), owner: updated.owner };
  });
  await invalidateHostel(hostelId); // public visibility changed
  return result;
}

export const hostelModerationService = {
  async list(actor: Actor, q: { status?: HostelStatus; limit: number; cursor?: string }) {
    requireRole(actor, 'ADMIN');
    const rows = await prisma.hostel.findMany({
      where: { deletedAt: null, status: q.status ?? 'PENDING_REVIEW' },
      include: { ...hostelInclude, owner: ownerSelect }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], ...cursorArgs(q), // oldest first = fair queue
    });
    const { items, nextCursor } = toPage(rows, q.limit);
    return { items: items.map((h) => ({ ...toHostelSummary(h), owner: h.owner })), nextCursor };
  },

  async get(actor: Actor, hostelId: string) {
    const hostel = await loadForAdmin(actor, hostelId);
    const history = await prisma.auditLog.findMany({ where: { entityType: 'hostel', entityId: hostelId }, orderBy: { id: 'desc' }, take: 30, select: { id: true, action: true, actorId: true, actorRole: true, outcome: true, createdAt: true, metadata: true } });
    return { ...toHostelDto(hostel), owner: hostel.owner, history: history.map((h) => ({ ...h, id: String(h.id) })) };
  },

  approve: (actor: Actor, id: string) =>
    transition(actor, id, 'APPROVED', { action: 'hostel.approve', notice: { type: 'HOSTEL_APPROVED', title: 'Your listing is live', body: (n) => `${n} has been approved and is now visible to guests.` } }),
  reject: (actor: Actor, id: string, reason: string) =>
    transition(actor, id, 'REJECTED', { reason, action: 'hostel.reject', notice: { type: 'HOSTEL_REJECTED', title: 'Listing needs changes', body: (n) => `${n} was not approved.` } }),
  suspend: (actor: Actor, id: string, reason: string) =>
    transition(actor, id, 'SUSPENDED', { reason, action: 'hostel.suspend', notice: { type: 'SYSTEM', title: 'Listing suspended', body: (n) => `${n} has been suspended.` } }),
  reinstate: (actor: Actor, id: string) =>
    transition(actor, id, 'APPROVED', { action: 'hostel.reinstate', notice: { type: 'HOSTEL_APPROVED', title: 'Listing reinstated', body: (n) => `${n} is live again.` } }),
};
