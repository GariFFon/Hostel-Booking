import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/infra/db/prisma';
import { userInclude } from './auth.mapper';

type Tx = Prisma.TransactionClient;

export const authRepository = {
  findUserByEmail: (email: string, db: Tx | typeof prisma = prisma) =>
    db.user.findFirst({ where: { email, deletedAt: null }, include: userInclude }),

  findUserById: (id: string, db: Tx | typeof prisma = prisma) =>
    db.user.findFirst({ where: { id, deletedAt: null }, include: userInclude }),

  findUserByGoogleSub: (googleSub: string) =>
    prisma.user.findFirst({ where: { googleSub, deletedAt: null }, include: userInclude }),

  createUser: (
    db: Tx,
    data: { email: string; passwordHash: string | null; googleSub?: string; verified: boolean; fullName: string; phone?: string; avatarUrl?: string; roles: ('GUEST' | 'OWNER')[] },
  ) =>
    db.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        googleSub: data.googleSub,
        status: data.verified ? 'ACTIVE' : 'PENDING_VERIFICATION',
        emailVerifiedAt: data.verified ? new Date() : null,
        profile: { create: { fullName: data.fullName, phone: data.phone, avatarUrl: data.avatarUrl } },
        roles: { create: data.roles.map((role) => ({ role })) },
        notificationPrefs: { create: {} },
        ownerProfile: data.roles.includes('OWNER') ? { create: {} } : undefined,
      },
      include: userInclude,
    }),

  recordFailedLogin: (id: string, lockUntil: Date | null, failed: number) =>
    prisma.user.update({ where: { id }, data: { failedLogins: failed, lockedUntil: lockUntil } }),

  recordSuccessfulLogin: (db: Tx, id: string) =>
    db.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } }),

  createRefreshToken: (db: Tx, data: { userId: string; familyId: string; tokenHash: string; expiresAt: Date; userAgent: string | null; ip: string | null }) =>
    db.refreshToken.create({ data }),

  findRefreshToken: (tokenHash: string) => prisma.refreshToken.findUnique({ where: { tokenHash } }),

  revokeFamily: (familyId: string, db: Tx | typeof prisma = prisma) =>
    db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } }),

  revokeAllForUser: (userId: string, db: Tx | typeof prisma = prisma) =>
    db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
};
