import { Prisma } from '@/generated/prisma/client';
import type { Actor } from '@/core/context/request-context';
import { Errors } from '@/core/errors/app-error';
import { logger } from '@/core/logger/logger';
import { invalidateHostel } from '@/infra/cache/invalidation';
import { mediaStorage } from '@/infra/cloudinary/storage';
import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';
import { loadOwnedHostel } from '@/modules/hostels/hostels.policy';
import { OWNER_EDITABLE } from '@/modules/hostels/hostels.status';
import { MAX_MEDIA_PER_HOSTEL } from '@/modules/uploads/uploads.service';
import { prefixFor } from '@/modules/uploads/upload-policy';
import { verifyUploadedAsset } from './asset-verifier';
import { toMediaDto } from './media.mapper';

async function loadOwnedMedia(db: Prisma.TransactionClient, actor: Actor, mediaId: string) {
  const media = await db.media.findFirst({ where: { id: mediaId, deletedAt: null, hostel: { ownerId: actor.id, deletedAt: null } }, include: { hostel: true } });
  if (!media) throw Errors.notFound('Photo');
  return media;
}

const assertEditable = (status: Parameters<typeof OWNER_EDITABLE.includes>[0]) => {
  if (!OWNER_EDITABLE.includes(status)) throw Errors.conflict('Withdraw the listing from review before editing it');
};

export const mediaService = {
  async list(actor: Actor, hostelId: string) {
    const hostel = await loadOwnedHostel(prisma, actor, hostelId);
    const rows = await prisma.media.findMany({ where: { hostelId: hostel.id, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(toMediaDto);
  },

  async add(actor: Actor, hostelId: string, input: { publicId: string; roomTypeId?: string | null; altText?: string | null }) {
    const hostel = await loadOwnedHostel(prisma, actor, hostelId);
    assertEditable(hostel.status);
    const resource = await verifyUploadedAsset(input.roomTypeId ? 'ROOM_IMAGE' : 'HOSTEL_IMAGE', input.publicId, prefixFor.hostel(hostel.id));
    if (input.roomTypeId && !(await prisma.roomType.findFirst({ where: { id: input.roomTypeId, hostelId: hostel.id, deletedAt: null } }))) {
      throw Errors.validation([{ path: 'roomTypeId', message: 'Room type not found in this listing' }]);
    }
    try {
      const dto = await prisma.$transaction(async (tx) => {
        const existing = await tx.media.findMany({ where: { hostelId: hostel.id, deletedAt: null }, select: { sortOrder: true, isCover: true } });
        if (existing.length >= MAX_MEDIA_PER_HOSTEL) throw Errors.conflict(`A listing can have at most ${MAX_MEDIA_PER_HOSTEL} photos`);
        const created = await tx.media.create({
          data: {
            hostelId: hostel.id, roomTypeId: input.roomTypeId ?? null, publicId: resource.publicId, url: resource.secureUrl,
            width: resource.width, height: resource.height, bytes: resource.bytes, format: resource.format, altText: input.altText ?? null,
            sortOrder: existing.reduce((m, e) => Math.max(m, e.sortOrder), -1) + 1,
            isCover: !input.roomTypeId && !existing.some((e) => e.isCover), // first listing photo becomes the cover
          },
        });
        await recordAudit({ action: 'media.add', entityType: 'hostel', entityId: hostel.id, after: { mediaId: created.id, publicId: created.publicId } }, tx);
        return toMediaDto(created);
      });
      await invalidateHostel(hostel.id);
      return dto;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Errors.conflict('This photo is already attached');
      throw e;
    }
  },

  async update(actor: Actor, mediaId: string, input: { altText?: string | null; isCover?: true }) {
    const result = await prisma.$transaction(async (tx) => {
      const media = await loadOwnedMedia(tx, actor, mediaId);
      assertEditable(media.hostel.status);
      if (input.isCover) {
        if (media.roomTypeId) throw Errors.validation([{ path: 'isCover', message: 'Only listing photos can be the cover' }]);
        await tx.media.updateMany({ where: { hostelId: media.hostelId, isCover: true }, data: { isCover: false } });
      }
      const updated = await tx.media.update({ where: { id: mediaId }, data: { altText: input.altText, isCover: input.isCover } });
      await recordAudit({ action: 'media.update', entityType: 'hostel', entityId: media.hostelId, before: { altText: media.altText, isCover: media.isCover }, after: { altText: updated.altText, isCover: updated.isCover } }, tx);
      return { dto: toMediaDto(updated), hostelId: media.hostelId };
    });
    await invalidateHostel(result.hostelId);
    return result.dto;
  },

  async reorder(actor: Actor, hostelId: string, ids: string[]) {
    const result = await prisma.$transaction(async (tx) => {
      const hostel = await loadOwnedHostel(tx, actor, hostelId);
      assertEditable(hostel.status);
      const current = await tx.media.findMany({ where: { hostelId, deletedAt: null }, select: { id: true } });
      const same = ids.length === current.length && new Set(ids).size === ids.length && current.every((c) => ids.includes(c.id));
      if (!same) throw Errors.validation([{ path: 'ids', message: 'Provide every photo of this listing exactly once' }]);
      await Promise.all(ids.map((id, i) => tx.media.update({ where: { id }, data: { sortOrder: i } })));
      await recordAudit({ action: 'media.reorder', entityType: 'hostel', entityId: hostelId, after: { order: ids } }, tx);
      return (await tx.media.findMany({ where: { hostelId, deletedAt: null }, orderBy: { sortOrder: 'asc' } })).map(toMediaDto);
    });
    await invalidateHostel(hostelId);
    return result;
  },

  async remove(actor: Actor, mediaId: string) {
    const removed = await prisma.$transaction(async (tx) => {
      const media = await loadOwnedMedia(tx, actor, mediaId);
      assertEditable(media.hostel.status);
      await tx.media.update({ where: { id: mediaId }, data: { deletedAt: new Date(), isCover: false } });
      if (media.isCover) {
        const next = await tx.media.findFirst({ where: { hostelId: media.hostelId, deletedAt: null, roomTypeId: null }, orderBy: { sortOrder: 'asc' } });
        if (next) await tx.media.update({ where: { id: next.id }, data: { isCover: true } });
      }
      await recordAudit({ action: 'media.remove', entityType: 'hostel', entityId: media.hostelId, before: { mediaId, publicId: media.publicId } }, tx);
      return media;
    });
    await invalidateHostel(removed.hostelId);
    // Best effort: an orphaned asset is harmless, a failed request is not.
    await mediaStorage().destroy(removed.publicId, 'upload').catch((e) => logger.warn({ err: (e as Error).message, publicId: removed.publicId }, 'could not delete asset'));
  },
};
