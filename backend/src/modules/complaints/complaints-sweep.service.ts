import { prisma } from '@/infra/db/prisma';
import { lockComplaint, moveComplaint } from './complaints.core';
import { complaintInclude } from './complaints.mapper';
import { AUTO_CLOSE_DAYS } from './complaints.rules';
import { SLA_RUNNING, WITH_STAFF } from './complaints.status';
import { notifyComplaint, runEffects, type Effect } from './complaints-notify';

const BATCH = 200;

/**
 * Hourly housekeeping, safe to run any number of times:
 *  1. tell the owner (and the assigned staff member) once when a complaint goes past its deadline,
 *  2. flag a booked visit whose time has passed with the job still open (once),
 *  3. close complaints that were resolved and not reopened within the window.
 */
export async function sweepComplaints(now = new Date()) {
  const result = { breached: 0, closed: 0, missedVisits: 0 };

  const late = await prisma.complaint.findMany({ where: { status: { in: [...SLA_RUNNING] }, slaDueAt: { lt: now }, slaBreachNotifiedAt: null }, select: { id: true }, take: BATCH, orderBy: { slaDueAt: 'asc' } });
  for (const { id } of late) {
    const effects: Effect[] = [];
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.complaint.updateMany({ where: { id, status: { in: [...SLA_RUNNING] }, slaBreachNotifiedAt: null }, data: { slaBreachNotifiedAt: now } }); // claim it: a parallel run cannot double-send
      if (claimed.count === 0) return;
      const c = await tx.complaint.findUniqueOrThrow({ where: { id }, include: complaintInclude });
      effects.push(...(await notifyComplaint(tx, c, [
        { to: 'OWNER', type: 'COMPLAINT_UPDATED', title: `${c.code} is overdue`, body: `${c.title} (${c.priority.toLowerCase()} priority) has not been dealt with in time.` },
        { to: 'STAFF', type: 'COMPLAINT_UPDATED', title: `${c.code} is overdue`, body: `${c.title} is past its deadline.` },
      ])));
      result.breached++;
    });
    await runEffects(effects);
  }

  const missed = await prisma.complaint.findMany({ where: { status: { in: [...WITH_STAFF] }, visitEnd: { lt: now }, visitMissedNotifiedAt: null }, select: { id: true }, take: BATCH, orderBy: { visitEnd: 'asc' } });
  for (const { id } of missed) {
    const effects: Effect[] = [];
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.complaint.updateMany({ where: { id, status: { in: [...WITH_STAFF] }, visitEnd: { lt: now }, visitMissedNotifiedAt: null }, data: { visitMissedNotifiedAt: now } });
      if (claimed.count === 0) return;
      const c = await tx.complaint.findUniqueOrThrow({ where: { id }, include: complaintInclude });
      effects.push(...(await notifyComplaint(tx, c, [
        { to: 'OWNER', type: 'COMPLAINT_UPDATED', title: `${c.code}: the booked visit has passed`, body: `${c.title} is still open. Check whether the visit happened, or ask staff to book another.` },
        { to: 'STAFF', type: 'COMPLAINT_UPDATED', title: `${c.code}: your visit time has passed`, body: `${c.title} is still open. Mark it resolved, put it on hold, or book a new visit.` },
      ])));
      result.missedVisits++;
    });
    await runEffects(effects);
  }

  const cutoff = new Date(now.getTime() - AUTO_CLOSE_DAYS * 86_400_000);
  const stale = await prisma.complaint.findMany({ where: { status: 'RESOLVED', resolvedAt: { lt: cutoff } }, select: { id: true }, take: BATCH, orderBy: { resolvedAt: 'asc' } });
  for (const { id } of stale) {
    await prisma.$transaction(async (tx) => {
      await lockComplaint(tx, id);
      const c = await tx.complaint.findUnique({ where: { id }, include: complaintInclude });
      if (!c || c.status !== 'RESOLVED' || !c.resolvedAt || c.resolvedAt >= cutoff) return;
      await moveComplaint(tx, c, 'CLOSED', { actor: { id: null, role: 'SYSTEM' }, action: 'auto_close', note: `Closed automatically: not reopened within ${AUTO_CLOSE_DAYS} days`, now });
      result.closed++;
    });
  }
  return result;
}
