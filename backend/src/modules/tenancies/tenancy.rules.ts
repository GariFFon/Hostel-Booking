import { randomInt } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { Errors } from '@/core/errors/app-error';
import { stayModeOf } from '@/modules/hostels/property-mode';

type Db = Prisma.TransactionClient;

/** Statuses in which a tenancy still holds its unit (and its tenant is "living somewhere"). */
export const LIVE_TENANCY = ['INVITED', 'PENDING_MOVE_IN', 'ACTIVE', 'NOTICE'] as const;

export const APPLICATION_TTL_DAYS = 14;
export const INVITE_TTL_DAYS = 7;
export const MAX_OPEN_APPLICATIONS = 3;
export const MAX_MOVE_IN_DAYS_AHEAD = 180;
export const MAX_BACKDATE_DAYS = 1095; // an owner can add a tenant who has already lived there for up to 3 years

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newTenancyCode = () => `TN-${Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')}`;

/** Postgres unique violation (partial unique indexes are the backstop for every "at most one" rule here). */
export const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

/** Row lock so two decisions on the same tenancy/application can never interleave. */
export const lockRow = (db: Db, table: 'tenancies' | 'tenancy_applications', id: string) =>
  db.$queryRawUnsafe(`SELECT id FROM ${table} WHERE id = $1::uuid FOR UPDATE`, id);

/** Gender rules for long-term stays: a women-only property hosts women, and a gender-specific dorm needs a matching tenant. */
export function genderProblems(hostelPolicy: 'MIXED' | 'MALE_ONLY' | 'FEMALE_ONLY', roomGender: 'MIXED' | 'MALE' | 'FEMALE', gender: string | null | undefined) {
  const need = hostelPolicy === 'MALE_ONLY' ? 'MALE' : hostelPolicy === 'FEMALE_ONLY' ? 'FEMALE' : roomGender !== 'MIXED' ? roomGender : null;
  const problems: { path: string; message: string }[] = [];
  if (need && gender !== need) {
    problems.push({ path: 'gender', message: gender ? `This ${hostelPolicy === 'MIXED' ? 'room is' : 'property is'} ${need === 'MALE' ? 'men' : 'women'}-only` : `Tell us your gender: this ${hostelPolicy === 'MIXED' ? 'room is' : 'property is'} ${need === 'MALE' ? 'men' : 'women'}-only` });
  }
  return problems;
}

/** Units of a room type that nobody holds: active, not deleted, and no live tenancy. */
export function freeUnits(db: Db, roomTypeId: string) {
  return db.roomUnit.findMany({
    where: { roomTypeId, deletedAt: null, status: 'ACTIVE', tenancies: { none: { status: { in: [...LIVE_TENANCY] } } } },
    orderBy: [{ floor: 'asc' }, { label: 'asc' }],
  });
}

/** A long-term (HOSTEL/PG) property that is live. Anything else is "not found" to the caller. */
export async function loadLongTermHostel(db: Db, hostelId: string) {
  const hostel = await db.hostel.findFirst({ where: { id: hostelId, status: 'APPROVED', deletedAt: null } });
  if (!hostel || stayModeOf(hostel.propertyType) !== 'TENANCY') throw Errors.notFound('Property');
  return hostel;
}

/** Warns (never blocks) when a deposit is above the usual two months of rent. */
export const DEPOSIT_WARN_MONTHS = 2;
export function depositWarning(depositPaise: number, rentPaise: number): string | null {
  return depositPaise > rentPaise * DEPOSIT_WARN_MONTHS ? `Deposit is above ${DEPOSIT_WARN_MONTHS} months of rent, which is the usual legal limit in many states. Check your state's rules.` : null;
}
