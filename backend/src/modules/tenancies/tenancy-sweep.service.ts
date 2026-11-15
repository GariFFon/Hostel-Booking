import { prisma } from '@/infra/db/prisma';
import { recordAudit } from '@/modules/audit/audit.service';
import { toDateString } from '@/core/dates';
import { APPLICATION_TTL_DAYS, lockRow } from './tenancy.rules';
import { depositsService } from './deposits.service';
import { tenancyInclude } from './tenancy.mapper';
import { endTenancy } from './tenancies.service';
import { bedsChangedEffect, notifyTenancy, runEffects, type Effect } from './tenancy-notify';

const SYSTEM = { actorId: null, actorRole: 'SYSTEM' } as const;
const BATCH = 100;

/**
 * Housekeeping, safe to run any number of times: open requests nobody answered for two weeks expire, and invitations
 * past their deadline are cancelled so the bed is free again.
 */
export async function sweepTenancies(now = new Date()) {
  const effects: Effect[] = [];
  let expiredApplications = 0;
  let expiredInvites = 0;
  let ended = 0;

  const staleApps = await prisma.tenancyApplication.findMany({
    where: { status: 'REQUESTED', createdAt: { lt: new Date(now.getTime() - APPLICATION_TTL_DAYS * 86_400_000) } },
    select: { id: true }, take: BATCH, orderBy: { createdAt: 'asc' },
  });
  for (const { id } of staleApps) {
    await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancy_applications', id);
      const a = await tx.tenancyApplication.findUnique({ where: { id }, include: { hostel: { select: { id: true, name: true } }, applicant: { select: { id: true, email: true } } } });
      if (!a || a.status !== 'REQUESTED') return;
      await tx.tenancyApplication.update({ where: { id }, data: { status: 'EXPIRED', decidedAt: now } });
      await recordAudit({ action: 'tenancy.application.expire', entityType: 'tenancy_application', entityId: id, before: { status: 'REQUESTED' }, after: { status: 'EXPIRED' }, metadata: { hostelId: a.hostel.id }, ...SYSTEM }, tx);
      effects.push(...(await notifyTenancy(tx, 'application_expired', { property: a.hostel.name, hostelId: a.hostel.id, applicationId: id, to: { userId: a.applicant.id, email: a.applicant.email } })));
      expiredApplications++;
    });
  }

  const staleInvites = await prisma.tenancy.findMany({ where: { status: 'INVITED', inviteExpiresAt: { lt: now } }, select: { id: true }, take: BATCH, orderBy: { createdAt: 'asc' } });
  for (const { id } of staleInvites) {
    await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', id);
      const t = await tx.tenancy.findUnique({ where: { id }, include: { hostel: { select: { id: true, name: true, ownerId: true, owner: { select: { email: true } } } } } });
      if (!t || t.status !== 'INVITED') return;
      await tx.tenancy.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: 'Invitation expired', inviteTokenHash: null, version: { increment: 1 } } });
      await recordAudit({ action: 'tenancy.invite.expire', entityType: 'tenancy', entityId: id, before: { status: 'INVITED' }, after: { status: 'CANCELLED' }, metadata: { hostelId: t.hostel.id, code: t.code }, ...SYSTEM }, tx);
      effects.push(bedsChangedEffect());
      effects.push(...(await notifyTenancy(tx, 'cancelled', { property: t.hostel.name, hostelId: t.hostel.id, tenancyId: id, code: t.code, reason: 'The invitation expired', audience: 'OWNER', to: { userId: t.hostel.ownerId, email: t.hostel.owner.email } })));
      expiredInvites++;
    });
  }

  // A notice period that is over ends the stay by itself the day after the move-out date, so the bed never stays blocked.
  const over = await prisma.tenancy.findMany({ where: { status: 'NOTICE', endDate: { lt: new Date(`${toDateString(now)}T00:00:00.000Z`) } }, select: { id: true }, take: BATCH, orderBy: { endDate: 'asc' } });
  for (const { id } of over) {
    await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancies', id);
      const t = await tx.tenancy.findUnique({ where: { id }, include: tenancyInclude });
      if (!t || t.status !== 'NOTICE' || !t.endDate) return;
      await endTenancy(tx, t, { movedOutOn: toDateString(t.endDate), by: 'SYSTEM', note: 'Notice period over', now }, effects);
      ended++;
    });
  }

  await runEffects(effects);
  const autoAgreed = await depositsService.autoAgree(now); // a deposit settlement the tenant never answered is taken as accepted after 7 days
  return { expiredApplications, expiredInvites, ended, autoAgreed };
}
