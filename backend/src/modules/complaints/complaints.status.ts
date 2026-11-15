import type { ComplaintStatus } from '@/generated/prisma/client';

export type ComplaintActor = 'TENANT' | 'OWNER' | 'STAFF' | 'ADMIN' | 'SYSTEM';

/**
 * The only legal moves and who may make each one. A move to the same status is allowed where it means something (the owner
 * re-assigning a complaint that is already ASSIGNED). Everything else is refused, whatever the caller sends.
 */
export const TRANSITIONS: Record<ComplaintStatus, Partial<Record<ComplaintStatus, ComplaintActor[]>>> = {
  OPEN: { ACKNOWLEDGED: ['OWNER', 'ADMIN'], ASSIGNED: ['OWNER', 'ADMIN', 'SYSTEM'], REJECTED: ['OWNER', 'ADMIN'], RESOLVED: ['OWNER'], CLOSED: ['TENANT'] },
  ACKNOWLEDGED: { ASSIGNED: ['OWNER', 'ADMIN'], REJECTED: ['OWNER', 'ADMIN'], RESOLVED: ['OWNER'], CLOSED: ['TENANT'] },
  ASSIGNED: { ASSIGNED: ['OWNER'], IN_PROGRESS: ['STAFF', 'OWNER'], ON_HOLD: ['STAFF', 'OWNER'], RESOLVED: ['STAFF', 'OWNER'], REJECTED: ['OWNER'], OPEN: ['OWNER', 'SYSTEM'], CLOSED: ['TENANT'] },
  IN_PROGRESS: { ASSIGNED: ['OWNER'], ON_HOLD: ['STAFF', 'OWNER'], RESOLVED: ['STAFF', 'OWNER'], OPEN: ['OWNER', 'SYSTEM'], CLOSED: ['TENANT'] },
  ON_HOLD: { ASSIGNED: ['OWNER'], IN_PROGRESS: ['STAFF', 'OWNER'], RESOLVED: ['STAFF', 'OWNER'], OPEN: ['OWNER', 'SYSTEM'], CLOSED: ['TENANT'] },
  RESOLVED: { CLOSED: ['TENANT', 'SYSTEM'], REOPENED: ['TENANT'] },
  REOPENED: { ASSIGNED: ['OWNER', 'ADMIN'], IN_PROGRESS: ['STAFF', 'OWNER'], ON_HOLD: ['STAFF', 'OWNER'], RESOLVED: ['STAFF', 'OWNER'], OPEN: ['OWNER', 'SYSTEM'], CLOSED: ['TENANT'] },
  REJECTED: {},
  CLOSED: {},
};

export const canTransition = (from: ComplaintStatus, to: ComplaintStatus, actor: ComplaintActor) => TRANSITIONS[from][to]?.includes(actor) ?? false;

/** Nothing more will happen to these. */
export const TERMINAL: readonly ComplaintStatus[] = ['CLOSED', 'REJECTED'];
/** Still needs someone to act: the SLA clock runs (ON_HOLD stops it: the owner chose to wait). */
export const SLA_RUNNING: readonly ComplaintStatus[] = ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED'];
/** Counts toward a tenant's "open complaints" limit and a staff member's workload. */
export const UNRESOLVED: readonly ComplaintStatus[] = ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'];
/** Currently on a staff member's plate. */
export const WITH_STAFF: readonly ComplaintStatus[] = ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'];
