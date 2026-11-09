import { requireRole } from '@/core/auth/rbac';
import type { Actor } from '@/core/context/request-context';
import { Errors } from '@/core/errors/app-error';
import { mediaStorage } from '@/infra/cloudinary/storage';
import { prisma } from '@/infra/db/prisma';
import { loadOwnedHostel } from '@/modules/hostels/hostels.policy';
import { PURPOSE_POLICY, newPublicId, prefixFor } from './upload-policy';
import type { SignatureRequest } from './uploads.schema';

export const MAX_MEDIA_PER_HOSTEL = 20;

export const uploadsService = {
  /**
   * Issues a one-shot, server-pinned upload signature. The public_id is generated here, so a client can neither
   * overwrite another asset nor write outside the folder this actor is entitled to.
   */
  async createSignature(actor: Actor, req: SignatureRequest) {
    const policy = PURPOSE_POLICY[req.purpose];
    let prefix: string;
    switch (req.purpose) {
      case 'HOSTEL_IMAGE':
      case 'ROOM_IMAGE': {
        const hostel = await loadOwnedHostel(prisma, actor, req.hostelId!);
        const count = await prisma.media.count({ where: { hostelId: hostel.id, deletedAt: null } });
        if (count >= MAX_MEDIA_PER_HOSTEL) throw Errors.conflict(`A listing can have at most ${MAX_MEDIA_PER_HOSTEL} photos`);
        prefix = prefixFor.hostel(hostel.id);
        break;
      }
      case 'AVATAR':
        prefix = prefixFor.avatar(actor.id);
        break;
      case 'KYC_DOCUMENT':
        requireRole(actor, 'OWNER');
        prefix = prefixFor.kyc(actor.id);
        break;
    }
    const signed = mediaStorage().signUpload({ publicId: newPublicId(prefix), type: policy.type, allowedFormats: policy.allowedFormats });
    return { ...signed, maxBytes: policy.maxBytes, allowedFormats: policy.allowedFormats };
  },
};
