import type { ComplaintStatus, Prisma } from '@/generated/prisma/client';
import { Errors } from '@/core/errors/app-error';
import { recordAudit } from '@/modules/audit/audit.service';
import { complaintInclude, type ComplaintFull } from './complaints.mapper';
import { canTransition, type ComplaintActor } from './complaints.status';

type Tx = Prisma.TransactionClient;

/** Row lock: two people acting on the same complaint can never interleave. */
export const lockComplaint = (tx: Tx, id: string) => tx.$queryRawUnsafe(`SELECT id FROM complaints WHERE id = $1::uuid FOR UPDATE`, id);

export const loadComplaint = (tx: Tx, id: string) => tx.complaint.findUnique({ where: { id }, include: complaintInclude });

export interface Mover { id: string | null; role: ComplaintActor }

/**
 * The only place a complaint's status changes. It checks the move is legal for this actor, stamps the matching timestamp,
 * bumps the version, appends the history row, and audits against the property: all in the caller's transaction.
 */
export async function moveComplaint(
  tx: Tx, c: Pick<ComplaintFull, 'id' | 'status' | 'hostelId' | 'code'>, to: ComplaintStatus,
  opts: { actor: Mover; action: string; note?: string | null; data?: Prisma.ComplaintUncheckedUpdateInput; now?: Date },
): Promise<ComplaintFull> {
  if (!canTransition(c.status, to, opts.actor.role)) throw Errors.invalidTransition(c.status, to);
  const now = opts.now ?? new Date();
  const stamp: Prisma.ComplaintUncheckedUpdateInput = to === 'ACKNOWLEDGED' ? { acknowledgedAt: now } : to === 'RESOLVED' ? { resolvedAt: now } : to === 'CLOSED' ? { closedAt: now } : {};
  const after = await tx.complaint.update({ where: { id: c.id }, data: { ...stamp, ...opts.data, status: to, version: { increment: 1 } }, include: complaintInclude });
  await tx.complaintStatusHistory.create({ data: { complaintId: c.id, fromStatus: c.status, toStatus: to, actorId: opts.actor.id, actorRole: opts.actor.role, note: opts.note ?? null } });
  await recordAudit({
    action: `complaint.${opts.action}`, entityType: 'complaint', entityId: c.id, before: { status: c.status }, after: { status: to, note: opts.note ?? undefined },
    metadata: { hostelId: c.hostelId, code: c.code }, ...(opts.actor.role === 'SYSTEM' ? { actorId: null, actorRole: 'SYSTEM' } : {}),
  }, tx);
  return (await loadComplaint(tx, c.id)) ?? after; // re-read so the new history row is in the result
}
