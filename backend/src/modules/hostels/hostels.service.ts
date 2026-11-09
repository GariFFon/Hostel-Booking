import type { HostelStatus, Prisma } from '@/generated/prisma/client';
import { requireRole, requireVerifiedEmail } from '@/core/auth/rbac';
import type { Actor } from '@/core/context/request-context';
import { Errors } from '@/core/errors/app-error';
import { cursorArgs, toPage } from '@/core/http/pagination';
import { invalidateHostel } from '@/infra/cache/invalidation';
import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';
import { notifyAdmins } from '@/modules/notifications/notifications.service';
import { hostelInclude, toHostelDto, toHostelSummary } from './hostels.mapper';
import { hasLiveBookings, loadOwnedHostel } from './hostels.policy';
import { OWNER_EDITABLE, assertHostelTransition } from './hostels.status';
import { uniqueHostelSlug } from './slug';
import type { CreateHostelInput, UpdateHostelInput } from './hostels.schema';

const MAX_HOSTELS_PER_OWNER = 50;
export const MIN_PHOTOS_TO_SUBMIT = 3;

async function amenityIds(db: Prisma.TransactionClient, codes: string[]): Promise<string[]> {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return [];
  const found = await db.amenity.findMany({ where: { code: { in: unique } }, select: { id: true, code: true } });
  const missing = unique.filter((c) => !found.some((f) => f.code === c));
  if (missing.length) throw Errors.validation([{ path: 'amenityCodes', message: `Unknown amenities: ${missing.join(', ')}` }]);
  return found.map((f) => f.id);
}

const pick = <T extends object>(o: T, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (o as Record<string, unknown>)[k]]));

export const hostelsService = {
  async create(actor: Actor, input: CreateHostelInput) {
    requireRole(actor, 'OWNER');
    requireVerifiedEmail(actor);
    return prisma.$transaction(async (tx) => {
      if ((await tx.hostel.count({ where: { ownerId: actor.id, deletedAt: null } })) >= MAX_HOSTELS_PER_OWNER) throw Errors.conflict(`You can list at most ${MAX_HOSTELS_PER_OWNER} properties`);
      const { amenityCodes, ...data } = input;
      const ids = await amenityIds(tx, amenityCodes);
      const hostel = await tx.hostel.create({
        data: { ...data, ownerId: actor.id, slug: await uniqueHostelSlug(tx, `${data.name} ${data.city}`), amenities: { create: ids.map((amenityId) => ({ amenityId })) } },
        include: hostelInclude,
      });
      await recordAudit({ action: 'hostel.create', entityType: 'hostel', entityId: hostel.id, after: toHostelDto(hostel) }, tx);
      return toHostelDto(hostel);
    });
  },

  async list(actor: Actor, q: { status?: HostelStatus; limit: number; cursor?: string }) {
    requireRole(actor, 'OWNER');
    const rows = await prisma.hostel.findMany({
      where: { ownerId: actor.id, deletedAt: null, ...(q.status ? { status: q.status } : {}) },
      include: hostelInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q),
    });
    const { items, nextCursor } = toPage(rows, q.limit);
    return { items: items.map(toHostelSummary), nextCursor };
  },

  async get(actor: Actor, hostelId: string) {
    const owned = await loadOwnedHostel(prisma, actor, hostelId);
    return toHostelDto(await prisma.hostel.findUniqueOrThrow({ where: { id: owned.id }, include: hostelInclude }));
  },

  async update(actor: Actor, hostelId: string, input: UpdateHostelInput) {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await loadOwnedHostel(tx, actor, hostelId);
      if (!OWNER_EDITABLE.includes(existing.status)) throw Errors.conflict(existing.status === 'SUSPENDED' ? 'This listing is suspended. Contact support.' : 'Withdraw the listing from review before editing it');
      if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) throw Errors.conflict('This listing was changed elsewhere. Reload and try again.', { currentVersion: existing.version });
      const { expectedVersion: _v, amenityCodes, ...changes } = input;
      const before = await tx.hostel.findUniqueOrThrow({ where: { id: hostelId }, include: hostelInclude });
      if (amenityCodes) {
        const ids = await amenityIds(tx, amenityCodes);
        await tx.hostelAmenity.deleteMany({ where: { hostelId } });
        await tx.hostelAmenity.createMany({ data: ids.map((amenityId) => ({ hostelId, amenityId })) });
      }
      const after = await tx.hostel.update({ where: { id: hostelId }, data: { ...changes, version: { increment: 1 } }, include: hostelInclude });
      const changed = [...Object.keys(changes), ...(amenityCodes ? ['amenities'] : [])];
      const snap = (h: typeof after) => ({ ...pick(h, Object.keys(changes)), ...(amenityCodes ? { amenities: h.amenities.map((a) => a.amenity.code).sort() } : {}) });
      await recordAudit({ action: 'hostel.update', entityType: 'hostel', entityId: hostelId, before: snap(before), after: snap(after), metadata: { changed } }, tx);
      return toHostelDto(after);
    });
    await invalidateHostel(hostelId);
    return result;
  },

  async remove(actor: Actor, hostelId: string) {
    await prisma.$transaction(async (tx) => {
      const hostel = await loadOwnedHostel(tx, actor, hostelId);
      if (await hasLiveBookings(tx, hostelId, hostel.timezone)) throw Errors.conflict('This property has upcoming or active bookings. Cancel or complete them first.');
      await tx.hostel.update({ where: { id: hostelId }, data: { deletedAt: new Date(), status: 'DRAFT' } });
      await recordAudit({ action: 'hostel.delete', entityType: 'hostel', entityId: hostelId, before: { name: hostel.name, status: hostel.status } }, tx);
    });
    await invalidateHostel(hostelId);
  },

  /** Lists everything still missing before an admin can review the listing. */
  async readiness(db: Prisma.TransactionClient, hostelId: string, ownerId: string) {
    const [photos, rooms, owner] = await Promise.all([
      db.media.count({ where: { hostelId, deletedAt: null, roomTypeId: null } }),
      db.roomType.count({ where: { hostelId, deletedAt: null, isActive: true } }),
      db.ownerProfile.findUnique({ where: { userId: ownerId }, select: { kycStatus: true } }),
    ]);
    const missing: { path: string; message: string }[] = [];
    if (owner?.kycStatus !== 'APPROVED') missing.push({ path: 'kyc', message: 'Complete owner KYC verification and wait for approval' });
    if (photos < MIN_PHOTOS_TO_SUBMIT) missing.push({ path: 'media', message: `Add at least ${MIN_PHOTOS_TO_SUBMIT} photos (you have ${photos})` });
    if (rooms < 1) missing.push({ path: 'roomTypes', message: 'Add at least one active room type' });
    return missing;
  },

  async submit(actor: Actor, hostelId: string) {
    return prisma.$transaction(async (tx) => {
      const hostel = await loadOwnedHostel(tx, actor, hostelId);
      assertHostelTransition(hostel.status, 'PENDING_REVIEW', 'OWNER');
      const missing = await hostelsService.readiness(tx, hostelId, actor.id);
      if (missing.length) throw Errors.validation(missing, 'Your listing is not ready to be submitted yet');
      const updated = await tx.hostel.update({ where: { id: hostelId }, data: { status: 'PENDING_REVIEW', rejectionReason: null, version: { increment: 1 } }, include: hostelInclude });
      await recordAudit({ action: 'hostel.submit', entityType: 'hostel', entityId: hostelId, before: { status: hostel.status }, after: { status: 'PENDING_REVIEW' } }, tx);
      await notifyAdmins({ type: 'SYSTEM', title: 'Listing awaiting review', body: `${hostel.name} (${hostel.city}) was submitted for approval.`, data: { hostelId } }, tx);
      return toHostelDto(updated);
    });
  },

  /** Owner pulls a pending listing back to draft, or takes a published one offline. */
  async withdraw(actor: Actor, hostelId: string) {
    const result = await prisma.$transaction(async (tx) => {
      const hostel = await loadOwnedHostel(tx, actor, hostelId);
      assertHostelTransition(hostel.status, 'DRAFT', 'OWNER');
      if (hostel.status === 'APPROVED' && (await hasLiveBookings(tx, hostelId, hostel.timezone))) throw Errors.conflict('You have upcoming or active bookings, so this listing must stay online.');
      const updated = await tx.hostel.update({ where: { id: hostelId }, data: { status: 'DRAFT', version: { increment: 1 } }, include: hostelInclude });
      await recordAudit({ action: 'hostel.withdraw', entityType: 'hostel', entityId: hostelId, before: { status: hostel.status }, after: { status: 'DRAFT' } }, tx);
      return toHostelDto(updated);
    });
    await invalidateHostel(hostelId);
    return result;
  },
};
