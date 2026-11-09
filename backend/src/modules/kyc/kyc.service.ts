import type { KycStatus } from '@/generated/prisma/client';
import { requireRole } from '@/core/auth/rbac';
import type { Actor } from '@/core/context/request-context';
import { Errors } from '@/core/errors/app-error';
import { logger } from '@/core/logger/logger';
import { mediaStorage } from '@/infra/cloudinary/storage';
import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';
import { verifyUploadedAsset } from '@/modules/media/asset-verifier';
import { notify, notifyAdmins } from '@/modules/notifications/notifications.service';
import { prefixFor } from '@/modules/uploads/upload-policy';

const MAX_DOCS = 10;
const DOWNLOAD_URL_TTL_SECONDS = 600;

const toDocDto = (d: { id: string; type: string; format: string | null; bytes: number | null; createdAt: Date }) => ({ id: d.id, type: d.type, format: d.format, bytes: d.bytes, uploadedAt: d.createdAt.toISOString() });

async function loadOwnerProfile(actor: Actor) {
  requireRole(actor, 'OWNER');
  const profile = await prisma.ownerProfile.findUnique({ where: { userId: actor.id }, include: { documents: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } } });
  if (!profile) throw Errors.notFound('Owner profile');
  return profile;
}

const toOwnerDto = (p: Awaited<ReturnType<typeof loadOwnerProfile>>) => ({
  businessName: p.businessName, gstin: p.gstin, panLast4: p.panLast4, kycStatus: p.kycStatus,
  rejectionReason: p.kycStatus === 'REJECTED' ? p.kycRejectionReason : null,
  reviewedAt: p.kycReviewedAt?.toISOString() ?? null, documents: p.documents.map(toDocDto),
});

/** Business details and documents may only change before review or after a rejection. */
const assertEditable = (status: KycStatus) => {
  if (status === 'PENDING') throw Errors.conflict('Your documents are under review. You can edit them if they are rejected.');
  if (status === 'APPROVED') throw Errors.conflict('Your verification is complete. Contact support to change these details.');
};

export const kycService = {
  async get(actor: Actor) {
    return toOwnerDto(await loadOwnerProfile(actor));
  },

  async updateProfile(actor: Actor, input: { businessName?: string | null; gstin?: string | null; panLast4?: string | null }) {
    const profile = await loadOwnerProfile(actor);
    assertEditable(profile.kycStatus);
    await prisma.$transaction(async (tx) => {
      await tx.ownerProfile.update({ where: { userId: actor.id }, data: input });
      await recordAudit({ action: 'kyc.profile.update', entityType: 'owner', entityId: actor.id, before: { businessName: profile.businessName, gstin: profile.gstin }, after: { businessName: input.businessName ?? profile.businessName, gstin: input.gstin ?? profile.gstin } }, tx);
    });
    return kycService.get(actor);
  },

  async addDocument(actor: Actor, input: { type: 'GOVERNMENT_ID' | 'PROPERTY_PROOF' | 'BUSINESS_LICENSE' | 'GST_CERTIFICATE' | 'OTHER'; publicId: string }) {
    const profile = await loadOwnerProfile(actor);
    assertEditable(profile.kycStatus);
    if (profile.documents.length >= MAX_DOCS) throw Errors.conflict(`You can upload at most ${MAX_DOCS} documents`);
    if (profile.documents.some((d) => d.publicId === input.publicId)) throw Errors.conflict('This document is already attached');
    const resource = await verifyUploadedAsset('KYC_DOCUMENT', input.publicId, prefixFor.kyc(actor.id));
    await prisma.$transaction(async (tx) => {
      const doc = await tx.kycDocument.create({ data: { ownerId: actor.id, type: input.type, publicId: resource.publicId, format: resource.format, bytes: resource.bytes, resourceType: resource.resourceType } });
      await recordAudit({ action: 'kyc.document.add', entityType: 'owner', entityId: actor.id, after: { documentId: doc.id, type: doc.type } }, tx);
    });
    return kycService.get(actor);
  },

  async removeDocument(actor: Actor, documentId: string) {
    const profile = await loadOwnerProfile(actor);
    assertEditable(profile.kycStatus);
    const doc = profile.documents.find((d) => d.id === documentId);
    if (!doc) throw Errors.notFound('Document');
    await prisma.$transaction(async (tx) => {
      await tx.kycDocument.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
      await recordAudit({ action: 'kyc.document.remove', entityType: 'owner', entityId: actor.id, before: { documentId, type: doc.type } }, tx);
    });
    await mediaStorage().destroy(doc.publicId, 'authenticated').catch((e) => logger.warn({ err: (e as Error).message }, 'could not delete KYC asset'));
    return kycService.get(actor);
  },

  async submit(actor: Actor) {
    const profile = await loadOwnerProfile(actor);
    assertEditable(profile.kycStatus);
    const missing: { path: string; message: string }[] = [];
    if (!profile.businessName) missing.push({ path: 'businessName', message: 'Add your business or owner name' });
    if (!profile.documents.some((d) => d.type === 'GOVERNMENT_ID')) missing.push({ path: 'documents', message: 'Upload a government ID' });
    if (missing.length) throw Errors.validation(missing, 'Your verification is incomplete');
    await prisma.$transaction(async (tx) => {
      await tx.ownerProfile.update({ where: { userId: actor.id }, data: { kycStatus: 'PENDING', kycRejectionReason: null } });
      await recordAudit({ action: 'kyc.submit', entityType: 'owner', entityId: actor.id, before: { status: profile.kycStatus }, after: { status: 'PENDING' } }, tx);
      await notifyAdmins({ type: 'SYSTEM', title: 'KYC awaiting review', body: `${profile.businessName} submitted verification documents.`, data: { ownerId: actor.id } }, tx);
    });
    return kycService.get(actor);
  },

  // ── admin ──
  async adminList(actor: Actor, q: { status: KycStatus; limit: number; cursor?: string }) {
    requireRole(actor, 'ADMIN');
    const rows = await prisma.ownerProfile.findMany({
      where: { kycStatus: q.status }, orderBy: [{ updatedAt: 'asc' }, { userId: 'asc' }],
      include: { user: { select: { email: true, profile: { select: { fullName: true } } } }, _count: { select: { documents: { where: { deletedAt: null } } } } },
      ...(q.cursor ? { cursor: { userId: Buffer.from(q.cursor, 'base64url').toString() }, skip: 1 } : {}), take: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const items = (hasMore ? rows.slice(0, q.limit) : rows).map((r) => ({ ownerId: r.userId, email: r.user.email, fullName: r.user.profile?.fullName ?? null, businessName: r.businessName, kycStatus: r.kycStatus, documentCount: r._count.documents, updatedAt: r.updatedAt.toISOString() }));
    return { items, nextCursor: hasMore ? Buffer.from(items[items.length - 1]!.ownerId).toString('base64url') : null };
  },

  async adminGet(actor: Actor, ownerId: string) {
    requireRole(actor, 'ADMIN');
    const p = await prisma.ownerProfile.findUnique({
      where: { userId: ownerId },
      include: { documents: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }, user: { select: { email: true, createdAt: true, profile: { select: { fullName: true, phone: true } } } } },
    });
    if (!p) throw Errors.notFound('Owner');
    await recordAudit({ action: 'kyc.documents.view', entityType: 'owner', entityId: ownerId, metadata: { documents: p.documents.length } }); // viewing private documents is itself audited
    const storage = mediaStorage();
    return {
      ownerId, email: p.user.email, fullName: p.user.profile?.fullName ?? null, phone: p.user.profile?.phone ?? null,
      businessName: p.businessName, gstin: p.gstin, panLast4: p.panLast4, kycStatus: p.kycStatus, rejectionReason: p.kycRejectionReason,
      documents: p.documents.map((d) => ({ ...toDocDto(d), downloadUrl: storage.privateDownloadUrl(d.publicId, d.format ?? 'jpg', DOWNLOAD_URL_TTL_SECONDS), downloadUrlExpiresInSeconds: DOWNLOAD_URL_TTL_SECONDS })),
    };
  },

  async adminDecide(actor: Actor, ownerId: string, decision: { approve: true } | { approve: false; reason: string }) {
    requireRole(actor, 'ADMIN');
    const profile = await prisma.ownerProfile.findUnique({ where: { userId: ownerId } });
    if (!profile) throw Errors.notFound('Owner');
    if (profile.kycStatus !== 'PENDING') throw Errors.invalidTransition(profile.kycStatus, decision.approve ? 'APPROVED' : 'REJECTED');
    const status: KycStatus = decision.approve ? 'APPROVED' : 'REJECTED';
    await prisma.$transaction(async (tx) => {
      await tx.ownerProfile.update({ where: { userId: ownerId }, data: { kycStatus: status, kycReviewedById: actor.id, kycReviewedAt: new Date(), kycRejectionReason: decision.approve ? null : decision.reason } });
      await recordAudit({ action: decision.approve ? 'kyc.approve' : 'kyc.reject', entityType: 'owner', entityId: ownerId, before: { status: profile.kycStatus }, after: { status }, metadata: decision.approve ? undefined : { reason: decision.reason } }, tx);
      await notify({ userId: ownerId, type: decision.approve ? 'KYC_APPROVED' : 'KYC_REJECTED', title: decision.approve ? 'Verification approved' : 'Verification needs attention', body: decision.approve ? 'You can now submit your listings for review.' : `Your documents were not accepted. Reason: ${decision.reason}` }, tx);
    });
    return { ownerId, kycStatus: status };
  },
};

