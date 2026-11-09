import { zonedTimeToUtc } from '@/core/dates';

export type CancellationPolicyName = 'FLEXIBLE' | 'MODERATE' | 'STRICT';

interface Tier {
  /** Cancelling at least this many hours before check-in earns `refundPercent` of the amount paid. */
  hoursBefore: number;
  refundPercent: number;
}

/** Ordered from most generous to least; anything after the last tier refunds nothing. */
const TIERS: Record<CancellationPolicyName, Tier[]> = {
  FLEXIBLE: [{ hoursBefore: 24, refundPercent: 100 }],
  MODERATE: [{ hoursBefore: 120, refundPercent: 100 }, { hoursBefore: 24, refundPercent: 50 }],
  STRICT: [{ hoursBefore: 168, refundPercent: 50 }],
};

export const SUMMARY: Record<CancellationPolicyName, string> = {
  FLEXIBLE: 'Free cancellation until 24 hours before check-in.',
  MODERATE: 'Full refund until 5 days before check-in, 50% until 24 hours before.',
  STRICT: '50% refund until 7 days before check-in. No refund after that.',
};

export const checkInInstant = (checkIn: string, checkInTime: string, timezone: string) => zonedTimeToUtc(checkIn, checkInTime, timezone);

export function refundPercentAt(policy: CancellationPolicyName, checkIn: Date, now: Date): number {
  const hoursUntil = (checkIn.getTime() - now.getTime()) / 3_600_000;
  return TIERS[policy].find((t) => hoursUntil >= t.hoursBefore)?.refundPercent ?? 0;
}

export interface PolicyTierDto {
  /** Cancel before this instant to receive `refundPercent` (null: no deadline, i.e. the base case). */
  until: string;
  refundPercent: number;
}

export function policyTiers(policy: CancellationPolicyName, checkIn: Date): PolicyTierDto[] {
  return TIERS[policy].map((t) => ({ until: new Date(checkIn.getTime() - t.hoursBefore * 3_600_000).toISOString(), refundPercent: t.refundPercent }));
}

/** Last instant at which a full refund is available, or null if the policy never fully refunds. */
export function freeCancellationUntil(policy: CancellationPolicyName, checkIn: Date): string | null {
  const full = TIERS[policy].find((t) => t.refundPercent === 100);
  return full ? new Date(checkIn.getTime() - full.hoursBefore * 3_600_000).toISOString() : null;
}
