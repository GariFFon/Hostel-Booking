import type { Prisma } from '@/generated/prisma/client';
import type { UserDto } from './auth.schema';

export const userInclude = {
  profile: true,
  roles: true,
  ownerProfile: { select: { kycStatus: true } },
} satisfies Prisma.UserInclude;

export type UserWithRelations = Prisma.UserGetPayload<{ include: typeof userInclude }>;

/** Never expose hashes, lockout counters or internal ids beyond what clients need. */
export function toUserDto(u: UserWithRelations): UserDto {
  return {
    id: u.id,
    email: u.email,
    fullName: u.profile?.fullName ?? null,
    phone: u.profile?.phone ?? null,
    avatarUrl: u.profile?.avatarUrl ?? null,
    roles: u.roles.map((r) => r.role),
    emailVerified: u.emailVerifiedAt !== null,
    hasPassword: u.passwordHash !== null,
    googleLinked: u.googleSub !== null,
    kycStatus: u.ownerProfile?.kycStatus ?? null,
  };
}
