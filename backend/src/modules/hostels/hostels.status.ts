import type { HostelStatus } from '@/generated/prisma/client';
import { Errors } from '@/core/errors/app-error';

export type HostelActor = 'OWNER' | 'ADMIN';

/** The only legal listing transitions. Everything else throws. */
const TRANSITIONS: Record<HostelStatus, Partial<Record<HostelStatus, HostelActor[]>>> = {
  DRAFT: { PENDING_REVIEW: ['OWNER'] },
  PENDING_REVIEW: { DRAFT: ['OWNER'], APPROVED: ['ADMIN'], REJECTED: ['ADMIN'] },
  REJECTED: { PENDING_REVIEW: ['OWNER'], DRAFT: ['OWNER'] },
  APPROVED: { DRAFT: ['OWNER'], SUSPENDED: ['ADMIN'] },
  SUSPENDED: { APPROVED: ['ADMIN'] },
};

export function assertHostelTransition(from: HostelStatus, to: HostelStatus, actor: HostelActor) {
  const allowed = TRANSITIONS[from][to];
  if (!allowed) throw Errors.invalidTransition(from, to);
  if (!allowed.includes(actor)) throw Errors.forbidden(`Only ${allowed.join('/').toLowerCase()} can move a listing from ${from} to ${to}`);
}

/** Owners may edit content in these states; a pending listing must be withdrawn first. */
export const OWNER_EDITABLE: HostelStatus[] = ['DRAFT', 'REJECTED', 'APPROVED'];
