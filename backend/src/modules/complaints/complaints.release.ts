import type { Prisma } from '@/generated/prisma/client';
import { lockComplaint, moveComplaint } from './complaints.core';
import { complaintInclude } from './complaints.mapper';
import { WITH_STAFF } from './complaints.status';
import { notifyComplaint, type Effect } from './complaints-notify';

type Tx = Prisma.TransactionClient;

/**
 * Hands a staff member's open complaints back to the owner's queue (status OPEN, nobody assigned), when they leave a property or
 * are deactivated. Nothing a tenant reported is ever left waiting on someone who can no longer do it.
 */
export async function releaseComplaints(tx: Tx, scope: { staffUserId: string; hostelIds?: string[] }, why: string): Promise<{ count: number; effects: Effect[] }> {
  const rows = await tx.complaint.findMany({
    where: { assignedStaffId: scope.staffUserId, status: { in: [...WITH_STAFF] }, ...(scope.hostelIds ? { hostelId: { in: scope.hostelIds } } : {}) },
    select: { id: true },
  });
  const effects: Effect[] = [];
  for (const { id } of rows) {
    await lockComplaint(tx, id);
    const c = await tx.complaint.findUniqueOrThrow({ where: { id }, include: complaintInclude });
    if (c.assignedStaffId !== scope.staffUserId || !(WITH_STAFF as readonly string[]).includes(c.status)) continue;
    const after = await moveComplaint(tx, c, 'OPEN', { actor: { id: null, role: 'SYSTEM' }, action: 'release', note: why, data: { assignedStaffId: null, visitStart: null, visitEnd: null, visitMissedNotifiedAt: null } });
    effects.push(...(await notifyComplaint(tx, after, [{ to: 'OWNER', type: 'COMPLAINT_UPDATED', title: `${c.code} needs a new owner`, body: `${c.title} was handed back: ${why}. Please assign it to someone.` }])));
  }
  return { count: rows.length, effects };
}
