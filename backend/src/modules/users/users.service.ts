import { revokeAccessTokens } from '@/core/auth/revocation';
import { Errors } from '@/core/errors/app-error';
import { prisma } from '@/infra/db/prisma';
import { toUserDto } from '@/modules/auth/auth.mapper';
import { authRepository } from '@/modules/auth/auth.repository';
import { recordAudit } from '@/modules/audit/audit.service';
import { verifyUploadedAsset } from '@/modules/media/asset-verifier';
import { prefixFor } from '@/modules/uploads/upload-policy';
import { mediaStorage } from '@/infra/cloudinary/storage';
import { logger } from '@/core/logger/logger';
import type { UpdateProfileInput } from './users.schema';

export const usersService = {
  async updateProfile(userId: string, input: UpdateProfileInput) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.profile.findUnique({ where: { userId } });
      if (!before) throw Errors.notFound('Profile');
      const after = await tx.profile.update({
        where: { userId },
        data: { ...input, dateOfBirth: input.dateOfBirth === undefined ? undefined : input.dateOfBirth === null ? null : new Date(`${input.dateOfBirth}T00:00:00.000Z`) },
      });
      await recordAudit({ action: 'user.profile.update', entityType: 'user', entityId: userId, before, after }, tx);
      return toUserDto((await authRepository.findUserById(userId, tx))!);
    });
  },

  /** A guest becomes an owner; KYC and admin approval gate actual publishing later. */
  async becomeOwner(userId: string) {
    const dto = await prisma.$transaction(async (tx) => {
      const user = await authRepository.findUserById(userId, tx);
      if (!user) throw Errors.notFound('User');
      if (user.roles.some((r) => r.role === 'OWNER')) throw Errors.conflict('You are already registered as an owner');
      await tx.userRoleAssignment.create({ data: { userId, role: 'OWNER' } });
      await tx.ownerProfile.upsert({ where: { userId }, update: {}, create: { userId } });
      await recordAudit({ action: 'user.role.grant', entityType: 'user', entityId: userId, after: { role: 'OWNER' } }, tx);
      return toUserDto((await authRepository.findUserById(userId, tx))!);
    });
    await revokeAccessTokens(userId); // the old token lacks the OWNER role; the client refreshes to get a new one
    return dto;
  },

  /** Attaches a previously signed-and-uploaded image as the user's avatar; the old asset is deleted. */
  async setAvatar(userId: string, publicId: string) {
    const resource = await verifyUploadedAsset('AVATAR', publicId, prefixFor.avatar(userId));
    const old = await prisma.profile.findUnique({ where: { userId }, select: { avatarPublicId: true } });
    const dto = await prisma.$transaction(async (tx) => {
      await tx.profile.update({ where: { userId }, data: { avatarUrl: resource.secureUrl, avatarPublicId: resource.publicId } });
      await recordAudit({ action: 'user.avatar.update', entityType: 'user', entityId: userId, after: { publicId } }, tx);
      return toUserDto((await authRepository.findUserById(userId, tx))!);
    });
    if (old?.avatarPublicId && old.avatarPublicId !== publicId) {
      await mediaStorage().destroy(old.avatarPublicId, 'upload').catch((e) => logger.warn({ err: (e as Error).message }, 'could not delete old avatar'));
    }
    return dto;
  },
};
