import { signAccessToken } from '@/core/auth/tokens';
import { prisma } from '@/infra/db/prisma';
import type { KycStatus } from '@/generated/prisma/client';

type RoleName = 'GUEST' | 'OWNER' | 'ADMIN';
let n = 0;

/** Creates a user straight in the DB (no argon2 cost) and mints a valid access token for it. */
export async function makeUser(opts: { roles?: RoleName[]; verified?: boolean; kyc?: KycStatus; name?: string } = {}) {
  const roles = opts.roles ?? ['GUEST'];
  const email = `u${++n}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.dev`;
  const user = await prisma.user.create({
    data: {
      email, status: 'ACTIVE', emailVerifiedAt: opts.verified === false ? null : new Date(),
      profile: { create: { fullName: opts.name ?? 'Test Person' } },
      roles: { create: roles.map((role) => ({ role })) },
      ownerProfile: roles.includes('OWNER') ? { create: { kycStatus: opts.kyc ?? 'NOT_SUBMITTED', businessName: opts.kyc === 'APPROVED' ? 'Test Stays' : null } } : undefined,
    },
  });
  const { token } = await signAccessToken({ id: user.id, roles, emailVerified: opts.verified !== false });
  return { id: user.id, email, token };
}
