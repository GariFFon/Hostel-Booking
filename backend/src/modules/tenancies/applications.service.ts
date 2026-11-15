import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/infra/db/prisma';
import { Errors } from '@/core/errors/app-error';
import type { Actor } from '@/core/context/request-context';
import { requireRole, requireVerifiedEmail } from '@/core/auth/rbac';
import { addDays, parseDate, todayIn, toDateString } from '@/core/dates';
import { cursorArgs, toPage } from '@/core/http/pagination';
import { recordAudit } from '@/modules/audit/audit.service';
import { newTenancyCode, LIVE_TENANCY, MAX_MOVE_IN_DAYS_AHEAD, MAX_OPEN_APPLICATIONS, freeUnits, genderProblems, isUniqueViolation, loadLongTermHostel, lockRow } from './tenancy.rules';
import { applicationInclude, tenancyInclude, toApplicationDto } from './tenancy.mapper';
import { bedsChangedEffect, notifyTenancy, runEffects, type Effect } from './tenancy-notify';
import type { ApproveApplicationInput, CreateApplicationInput } from './tenancy.schema';

type Q = { limit: number; cursor?: string; status?: Prisma.TenancyApplicationWhereInput['status']; hostelId?: string };

async function loadFor(tx: Prisma.TransactionClient, actor: Actor, id: string, viewer: 'TENANT' | 'OWNER') {
  if (viewer === 'OWNER') requireRole(actor, 'OWNER');
  const where: Prisma.TenancyApplicationWhereInput = viewer === 'TENANT' ? { id, applicantId: actor.id } : { id, hostel: { ownerId: actor.id } };
  const a = await tx.tenancyApplication.findFirst({ where, include: applicationInclude });
  if (!a) throw Errors.notFound('Request'); // someone else's request looks exactly like a missing one
  return a;
}

export const applicationsService = {
  async create(actor: Actor, hostelId: string, input: CreateApplicationInput) {
    requireVerifiedEmail(actor);
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      const hostel = await loadLongTermHostel(tx, hostelId);
      if (hostel.ownerId === actor.id) throw Errors.conflict("You can't apply to your own property");
      const room = await tx.roomType.findFirst({ where: { id: input.roomTypeId, hostelId, isActive: true, deletedAt: null } });
      if (!room) throw Errors.validation([{ path: 'roomTypeId', message: 'This room type is not available at this property' }]);

      const today = todayIn(hostel.timezone);
      const problems = [...genderProblems(hostel.genderPolicy, room.gender, input.gender)];
      if (input.moveInDate < today) problems.push({ path: 'moveInDate', message: 'Move-in cannot be in the past' });
      if (input.moveInDate > addDays(today, MAX_MOVE_IN_DAYS_AHEAD)) problems.push({ path: 'moveInDate', message: `Requests open up to ${MAX_MOVE_IN_DAYS_AHEAD} days ahead` });
      if (problems.length) throw Errors.validation(problems);

      if (await tx.tenancy.findFirst({ where: { tenantId: actor.id, status: { in: [...LIVE_TENANCY] } }, select: { id: true } })) throw Errors.conflict('You already have a stay. Move out before requesting another.');
      if ((await tx.tenancyApplication.count({ where: { applicantId: actor.id, status: 'REQUESTED' } })) >= MAX_OPEN_APPLICATIONS) throw Errors.conflict(`You can have at most ${MAX_OPEN_APPLICATIONS} open requests. Withdraw one first.`);
      if ((await freeUnits(tx, room.id)).length === 0) throw Errors.conflict('No beds are free in this room type right now');

      let app;
      try {
        app = await tx.tenancyApplication.create({
          data: {
            hostelId, roomTypeId: room.id, applicantId: actor.id, moveInDate: parseDate(input.moveInDate), tenureMonths: input.tenureMonths, gender: input.gender,
            occupation: input.occupation, message: input.message, emergencyContactName: input.emergencyContactName, emergencyContactPhone: input.emergencyContactPhone,
          },
          include: applicationInclude,
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw Errors.conflict('You already have an open request for this property');
        throw e;
      }
      await recordAudit({ action: 'tenancy.application.create', entityType: 'tenancy_application', entityId: app.id, after: { roomTypeId: room.id, moveInDate: input.moveInDate }, metadata: { hostelId } }, tx);
      const owner = await tx.user.findUniqueOrThrow({ where: { id: hostel.ownerId }, select: { email: true } });
      effects.push(...(await notifyTenancy(tx, 'application_requested', { property: hostel.name, hostelId, applicationId: app.id, to: { userId: hostel.ownerId, email: owner.email } })));
      return toApplicationDto(app, 'TENANT');
    });
    await runEffects(effects);
    return dto;
  },

  async listMine(actor: Actor, q: Q) {
    const rows = await prisma.tenancyApplication.findMany({ where: { applicantId: actor.id, ...(q.status ? { status: q.status } : {}) }, include: applicationInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q) });
    const { items, nextCursor } = toPage(rows, q.limit);
    return { items: items.map((a) => toApplicationDto(a, 'TENANT')), nextCursor };
  },

  async withdraw(actor: Actor, id: string) {
    return prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancy_applications', id);
      const a = await loadFor(tx, actor, id, 'TENANT');
      if (a.status !== 'REQUESTED') throw Errors.conflict('Only an open request can be withdrawn');
      const after = await tx.tenancyApplication.update({ where: { id }, data: { status: 'WITHDRAWN', decidedAt: new Date(), decidedById: actor.id }, include: applicationInclude });
      await recordAudit({ action: 'tenancy.application.withdraw', entityType: 'tenancy_application', entityId: id, before: { status: a.status }, after: { status: 'WITHDRAWN' }, metadata: { hostelId: a.hostelId } }, tx);
      return toApplicationDto(after, 'TENANT');
    });
  },

  async ownerList(actor: Actor, q: Q) {
    requireRole(actor, 'OWNER');
    const rows = await prisma.tenancyApplication.findMany({
      where: { hostel: { ownerId: actor.id }, ...(q.hostelId ? { hostelId: q.hostelId } : {}), ...(q.status ? { status: q.status } : {}) },
      include: applicationInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q),
    });
    const { items, nextCursor } = toPage(rows, q.limit);
    return { items: items.map((a) => toApplicationDto(a, 'OWNER')), nextCursor };
  },

  async ownerGet(actor: Actor, id: string) {
    return toApplicationDto(await loadFor(prisma, actor, id, 'OWNER'), 'OWNER');
  },

  async approve(actor: Actor, id: string, input: ApproveApplicationInput) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancy_applications', id);
      const app = await loadFor(tx, actor, id, 'OWNER');
      if (app.status !== 'REQUESTED') throw Errors.conflict('This request has already been decided');
      const hostel = await loadLongTermHostel(tx, app.hostelId).catch(() => { throw Errors.conflict('This property is no longer accepting tenants'); });
      const room = await tx.roomType.findFirstOrThrow({ where: { id: app.roomTypeId } });

      if (await tx.tenancy.findFirst({ where: { tenantId: app.applicantId, status: { in: [...LIVE_TENANCY] } }, select: { id: true } })) throw Errors.conflict('This person already has a stay');

      const free = await freeUnits(tx, room.id);
      const unit = input.unitId ? free.find((u) => u.id === input.unitId) : free[0];
      if (!unit) throw Errors.conflict(input.unitId ? 'That bed is not free' : 'No beds are free in this room type. Add or free a unit first.');

      const today = todayIn(hostel.timezone);
      const startDate = input.startDate ?? toDateString(app.moveInDate);
      if (startDate < today) throw Errors.validation([{ path: 'startDate', message: 'Start date cannot be in the past' }]);
      const rentPaise = input.rentPaise ?? room.basePricePaise;
      const depositPaise = input.depositPaise ?? hostel.depositMonths * rentPaise;

      let tenancy;
      try {
        tenancy = await tx.tenancy.create({
          data: {
            code: newTenancyCode(), hostelId: hostel.id, roomTypeId: room.id, unitId: unit.id, tenantId: app.applicantId, applicationId: app.id, status: 'PENDING_MOVE_IN',
            startDate: parseDate(startDate), rentPaise, depositPaise, dueDay: hostel.rentDueDay, graceDays: hostel.rentGraceDays, noticeDays: hostel.noticeDays, gstRateBps: hostel.rentGstBps, lateFeePaise: hostel.rentLateFeePaise,
            emergencyContactName: app.emergencyContactName, emergencyContactPhone: app.emergencyContactPhone, createdById: actor.id,
          },
          include: tenancyInclude,
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw Errors.conflict('That bed was just taken, or this person already has a stay');
        throw e;
      }
      const after = await tx.tenancyApplication.update({ where: { id }, data: { status: 'APPROVED', decidedAt: new Date(), decidedById: actor.id }, include: applicationInclude });
      const meta = { hostelId: hostel.id };
      await recordAudit({ action: 'tenancy.application.approve', entityType: 'tenancy_application', entityId: id, before: { status: 'REQUESTED' }, after: { status: 'APPROVED', tenancyId: tenancy.id }, metadata: meta }, tx);
      await recordAudit({ action: 'tenancy.create', entityType: 'tenancy', entityId: tenancy.id, after: { code: tenancy.code, unitId: unit.id, rentPaise, depositPaise, startDate }, metadata: { ...meta, via: 'application' } }, tx);
      effects.push(bedsChangedEffect());
      effects.push(...(await notifyTenancy(tx, 'application_approved', { property: hostel.name, hostelId: hostel.id, tenancyId: tenancy.id, applicationId: id, code: tenancy.code, to: { userId: app.applicantId, email: app.applicant.email } })));
      return toApplicationDto(after, 'OWNER');
    });
    await runEffects(effects);
    return dto;
  },

  async reject(actor: Actor, id: string, reason: string) {
    requireRole(actor, 'OWNER');
    const effects: Effect[] = [];
    const dto = await prisma.$transaction(async (tx) => {
      await lockRow(tx, 'tenancy_applications', id);
      const app = await loadFor(tx, actor, id, 'OWNER');
      if (app.status !== 'REQUESTED') throw Errors.conflict('This request has already been decided');
      const after = await tx.tenancyApplication.update({ where: { id }, data: { status: 'REJECTED', decisionNote: reason, decidedAt: new Date(), decidedById: actor.id }, include: applicationInclude });
      await recordAudit({ action: 'tenancy.application.reject', entityType: 'tenancy_application', entityId: id, before: { status: 'REQUESTED' }, after: { status: 'REJECTED', reason }, metadata: { hostelId: app.hostelId } }, tx);
      effects.push(...(await notifyTenancy(tx, 'application_rejected', { property: app.hostel.name, hostelId: app.hostelId, applicationId: id, reason, to: { userId: app.applicantId, email: app.applicant.email } })));
      return toApplicationDto(after, 'OWNER');
    });
    await runEffects(effects);
    return dto;
  },
};
