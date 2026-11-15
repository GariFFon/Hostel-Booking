import { randomInt } from 'node:crypto';
import type { ComplaintCategory, ComplaintPriority, StaffTrade } from '@/generated/prisma/client';

/** How quickly each priority must be dealt with, in hours from the moment it was filed. */
export const SLA_HOURS: Record<ComplaintPriority, number> = { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 168 };
export const slaDueAt = (createdAt: Date, priority: ComplaintPriority) => new Date(createdAt.getTime() + SLA_HOURS[priority] * 3_600_000);

/** A resolved complaint can be reopened for this long, then it closes by itself. */
export const REOPEN_WINDOW_DAYS = 7;
export const AUTO_CLOSE_DAYS = REOPEN_WINDOW_DAYS;
export const MAX_REOPENS = 3;
export const MAX_UNRESOLVED_PER_TENANT = 10;
export const MAX_PHOTOS_PER_COMPLAINT = 6;

/** The tenant's availability window: how long, and how far ahead, it may be. */
export const MIN_WINDOW_MINUTES = 60;
export const MAX_WINDOW_DAYS = 7;
export const MAX_WINDOW_LEAD_DAYS = 30;
/** A booked visit slot: no longer than this. */
export const MAX_VISIT_HOURS = 8;
/** Small allowance for a clock a few minutes off, so "starting now" is accepted. */
export const CLOCK_SLACK_MS = 5 * 60_000;

export type RangeIssue = { path: string; message: string };

/** Checks the window a tenant says they are free in. Returns what is wrong, in words, or nothing. */
export function windowIssue(from: Date, to: Date, now: Date): RangeIssue | null {
  if (to.getTime() <= from.getTime()) return { path: 'availableTo', message: 'The end of your free time must be after the start' };
  if (to.getTime() - from.getTime() < MIN_WINDOW_MINUTES * 60_000) return { path: 'availableTo', message: `Give at least ${MIN_WINDOW_MINUTES / 60} hour so staff can reach you` };
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 86_400_000) return { path: 'availableTo', message: `Your free time can span at most ${MAX_WINDOW_DAYS} days` };
  if (to.getTime() <= now.getTime()) return { path: 'availableTo', message: 'Your free time must end in the future' };
  if (from.getTime() > now.getTime() + MAX_WINDOW_LEAD_DAYS * 86_400_000) return { path: 'availableFrom', message: `Choose a time within the next ${MAX_WINDOW_LEAD_DAYS} days` };
  return null;
}

/** Checks a visit slot staff want to book: sensible, in the future, and inside the tenant's window. */
export function visitIssue(start: Date, end: Date, now: Date, window: { from: Date | null; to: Date | null }): RangeIssue | null {
  if (end.getTime() <= start.getTime()) return { path: 'visitEnd', message: 'The visit must end after it starts' };
  if (end.getTime() - start.getTime() > MAX_VISIT_HOURS * 3_600_000) return { path: 'visitEnd', message: `A visit can be at most ${MAX_VISIT_HOURS} hours` };
  if (start.getTime() < now.getTime() - CLOCK_SLACK_MS) return { path: 'visitStart', message: 'The visit must be in the future' };
  if (window.from && window.to && (start < window.from || end > window.to)) return { path: 'visitStart', message: 'Pick a time inside the tenant\'s free time' };
  return null;
}

/** Which trade fixes what. A category with no trade (OTHER) is always assigned by hand. */
export const TRADE_FOR_CATEGORY: Record<ComplaintCategory, StaffTrade | null> = {
  ELECTRICAL: 'ELECTRICIAN', PLUMBING: 'PLUMBER', CARPENTRY: 'CARPENTER', CLEANING: 'CLEANER', FOOD: 'COOK', WIFI: 'NETWORK', SECURITY: 'SECURITY', BEHAVIOUR: 'WARDEN', OTHER: null,
};

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newComplaintCode = () => `CMP-${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;

export const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

/** The complaint is past its SLA and still waiting on someone. */
export const isSlaBreached = (c: { status: string; slaDueAt: Date }, now: Date) => ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED'].includes(c.status) && c.slaDueAt < now;
