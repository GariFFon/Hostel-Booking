import type { Prisma } from '@/generated/prisma/client';
import type { Actor } from '@/core/context/request-context';
import { Errors } from '@/core/errors/app-error';
import { loadComplaint } from './complaints.core';
import type { ComplaintFull, Viewer } from './complaints.mapper';

type Tx = Prisma.TransactionClient;

/**
 * Who is this person in relation to this complaint? The tenant who filed it, the owner of the property, the staff member it is
 * assigned to, or an admin. Anyone else gets nothing, and a complaint they cannot see looks exactly like one that does not exist.
 */
export function viewerOf(actor: Actor, c: Pick<ComplaintFull, 'raisedById' | 'assignedStaffId' | 'hostel'>): Viewer | null {
  if (c.raisedById === actor.id) return 'TENANT';
  if (c.hostel.ownerId === actor.id && actor.roles.includes('OWNER')) return 'OWNER';
  if (c.assignedStaffId === actor.id && actor.roles.includes('STAFF')) return 'STAFF';
  if (actor.roles.includes('ADMIN')) return 'ADMIN';
  return null;
}

export async function loadViewable(db: Tx, actor: Actor, id: string) {
  const c = await loadComplaint(db, id);
  const viewer = c ? viewerOf(actor, c) : null;
  if (!c || !viewer) throw Errors.notFound('Complaint');
  return { c, viewer };
}
