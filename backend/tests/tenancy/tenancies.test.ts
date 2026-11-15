import { describe, expect, it } from 'vitest';
import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { sweepTenancies } from '@/modules/tenancies/tenancy-sweep.service';
import { TODAY, publish } from '../helpers/publish';
import { makeUser } from '../helpers/users';
import { api, applyBody, approvedTenant, inviteTokenFrom, lastMailTo, makeStay, student } from '../helpers/tenancy';

const invite = (stay: Awaited<ReturnType<typeof makeStay>>, email: string, over: Record<string, unknown> = {}) =>
  api.createTenancy(stay.owner.token, { roomTypeId: stay.room.id, tenantEmail: email, startDate: addDays(TODAY, 3), ...over });

describe('owner adds a tenant who already has an account', () => {
  it('creates an INVITED stay the tenant can accept', async () => {
    const stay = await makeStay();
    const s = await student();
    const created = await invite(stay, s.email, { depositReceived: { method: 'UPI', reference: 'UTR123' } });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'INVITED', tenant: { id: s.id }, deposit: { status: 'RECEIVED', method: 'UPI' } });
    expect(await prisma.notification.count({ where: { userId: s.id, type: 'TENANCY_INVITED' } })).toBe(1);
    expect((await api.myTenancy(s.token, created.body.data.id)).body.data.actions).toEqual(['accept', 'decline']);

    const accepted = await api.accept(s.token, created.body.data.id);
    expect(accepted.body.data.status).toBe('PENDING_MOVE_IN');
    expect(await prisma.notification.count({ where: { userId: stay.owner.id, type: 'TENANCY_APPROVED' } })).toBe(1);
    expect((await api.accept(s.token, created.body.data.id)).status).toBe(409); // already accepted
  });

  it('refuses hotels, yourself, someone who already has a stay, and a full room', async () => {
    const stay = await makeStay({ units: 1 });
    const hotel = await publish({ propertyType: 'HOTEL', ownerId: stay.owner.id });
    expect((await api.createTenancy(stay.owner.token, { roomTypeId: hotel.rooms[0]!.id, tenantEmail: 'a@b.dev', startDate: TODAY })).status).toBe(409);
    expect((await invite(stay, stay.owner.email)).status).toBe(409);
    const s = await student();
    expect((await invite(stay, s.email)).status).toBe(201);
    expect((await invite(stay, (await student()).email)).body.error.message).toMatch(/No beds are free/);
    const more = await makeStay();
    expect((await api.createTenancy(more.owner.token, { roomTypeId: more.room.id, tenantEmail: s.email, startDate: TODAY })).body.error.message).toMatch(/already has a stay/);
    expect((await invite(more, 'x@y.dev', { startDate: addDays(TODAY, -2000) })).status).toBe(422);
  });

  it('keeps other owners out', async () => {
    const stay = await makeStay();
    const other = await makeStay();
    expect((await api.createTenancy(other.owner.token, { roomTypeId: stay.room.id, tenantEmail: 'a@b.dev', startDate: TODAY })).status).toBe(404);
  });
});

describe('owner invites someone without an account', () => {
  it('emails a token; only the matching verified address can use it', async () => {
    const stay = await makeStay();
    const email = `newbie-${Date.now()}@test.dev`;
    const created = await invite(stay, email);
    expect(created.body.data).toMatchObject({ status: 'INVITED', tenant: null, inviteEmail: email });
    const mail = lastMailTo(email)!;
    expect(mail.subject).toBe('You were added to a stay');
    const token = inviteTokenFrom(mail.html);
    expect(token.length).toBeGreaterThan(20);

    const stranger = await student();
    expect((await api.acceptToken(stranger.token, token)).status).toBe(404); // wrong person looks like a missing invite
    expect((await api.acceptToken(stranger.token, 'x'.repeat(30))).status).toBe(404);

    const user = await prisma.user.create({ data: { email, status: 'ACTIVE', emailVerifiedAt: new Date(), profile: { create: { fullName: 'Newbie' } }, roles: { create: [{ role: 'GUEST' }] } } });
    const { signAccessToken } = await import('@/core/auth/tokens');
    const { token: jwt } = await signAccessToken({ id: user.id, roles: ['GUEST'], emailVerified: true });
    const ok = await api.acceptToken(jwt, token);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'PENDING_MOVE_IN', tenant: { id: user.id } });
    expect((await api.acceptToken(jwt, token)).status).toBe(404); // single use
  });

  it('expires', async () => {
    const stay = await makeStay();
    const email = `late-${Date.now()}@test.dev`;
    const created = await invite(stay, email);
    const token = inviteTokenFrom(lastMailTo(email)!.html);
    await prisma.tenancy.update({ where: { id: created.body.data.id }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    const user = await prisma.user.create({ data: { email, status: 'ACTIVE', emailVerifiedAt: new Date(), profile: { create: { fullName: 'Late' } }, roles: { create: [{ role: 'GUEST' }] } } });
    const { signAccessToken } = await import('@/core/auth/tokens');
    const { token: jwt } = await signAccessToken({ id: user.id, roles: ['GUEST'], emailVerified: true });
    expect((await api.acceptToken(jwt, token)).status).toBe(409);
  });
});

describe('deposit and move-in', () => {
  it('needs the deposit before move-in, then starts the stay and tells both sides', async () => {
    const stay = await makeStay();
    const { tenant, tenancyId } = await approvedTenant(stay);
    const early = await api.activate(stay.owner.token, tenancyId);
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/Record the deposit/);

    const dep = await api.deposit(stay.owner.token, tenancyId, { method: 'BANK', reference: 'NEFT-9' });
    expect(dep.body.data.deposit).toMatchObject({ status: 'RECEIVED', method: 'BANK', reference: 'NEFT-9' });
    expect((await api.deposit(stay.owner.token, tenancyId)).status).toBe(409); // once only

    const started = await api.activate(stay.owner.token, tenancyId);
    expect(started.body.data).toMatchObject({ status: 'ACTIVE' });
    expect(started.body.data.actions.sort()).toEqual(['move_out', 'serve_notice']); // the owner can now serve notice or record a move-out
    expect(started.body.data.startDate).toBe(TODAY); // early move-in pulls the start date forward
    expect(await prisma.notification.count({ where: { userId: tenant.id, type: 'TENANCY_STARTED' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: stay.owner.id, type: 'TENANCY_STARTED' } })).toBe(1);
    const ownerNote = await prisma.notification.findFirstOrThrow({ where: { userId: stay.owner.id, type: 'TENANCY_STARTED' } });
    expect(ownerNote.data).toMatchObject({ audience: 'OWNER', tenancyId });
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: tenant.id, type: 'TENANCY_STARTED' } })).data).toMatchObject({ audience: 'TENANT' });
    expect((await api.activate(stay.owner.token, tenancyId)).status).toBe(409);
  });

  it('a stay with no deposit can start straight away, and has no deposit to record', async () => {
    const stay = await makeStay();
    const { tenancyId } = await approvedTenant(stay, { depositPaise: 0 });
    expect((await api.deposit(stay.owner.token, tenancyId)).status).toBe(409);
    expect((await api.activate(stay.owner.token, tenancyId)).body.data.status).toBe('ACTIVE');
  });

  it('cannot start before the tenant accepts an invitation', async () => {
    const stay = await makeStay();
    const s = await student();
    const created = await invite(stay, s.email, { depositPaise: 0 });
    expect((await api.activate(stay.owner.token, created.body.data.id)).body.error.message).toMatch(/not accepted/);
  });

  it('the tenant cannot do owner things', async () => {
    const stay = await makeStay();
    const { tenant, tenancyId } = await approvedTenant(stay);
    expect((await api.deposit(tenant.token, tenancyId)).status).toBe(403);
    expect((await api.activate(tenant.token, tenancyId)).status).toBe(403);
    expect((await api.cancel(tenant.token, tenancyId)).status).toBe(403);
  });
});

describe('cancelling and declining', () => {
  it('cancels before move-in, frees the bed and the tenant, and tells the tenant', async () => {
    const stay = await makeStay({ units: 1 });
    const { tenant, tenancyId } = await approvedTenant(stay);
    expect((await api.cancel(stay.owner.token, tenancyId, { reason: 'x' })).status).toBe(422);
    const res = await api.cancel(stay.owner.token, tenancyId, { reason: 'Double booked' });
    expect(res.body.data).toMatchObject({ status: 'CANCELLED', cancelReason: 'Double booked' });
    expect(await prisma.notification.count({ where: { userId: tenant.id, type: 'TENANCY_ENDED' } })).toBe(1);
    expect((await api.terms(stay.hostel.id)).body.data.rooms[0].freeUnits).toBe(1);
    expect((await api.apply(tenant.token, stay.hostel.id, applyBody(stay.room.id))).status).toBe(201); // free to apply again
    expect((await api.cancel(stay.owner.token, tenancyId)).status).toBe(409);
  });

  it('a running stay cannot be cancelled (that is a move-out)', async () => {
    const stay = await makeStay();
    const { tenancyId } = await approvedTenant(stay, { depositPaise: 0 });
    await api.activate(stay.owner.token, tenancyId);
    const res = await api.cancel(stay.owner.token, tenancyId);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/move-out/);
  });

  it('the tenant can decline before move-in, and the owner is told', async () => {
    const stay = await makeStay();
    const { tenant, tenancyId } = await approvedTenant(stay);
    const res = await api.decline(tenant.token, tenancyId);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(await prisma.notification.count({ where: { userId: stay.owner.id, type: 'TENANCY_ENDED' } })).toBe(1);
    expect((await api.decline(tenant.token, tenancyId)).status).toBe(409);
  });
});

describe('editing terms before move-in', () => {
  it('changes rent, deposit and dates until move-in, with version checks and a deposit lock', async () => {
    const stay = await makeStay();
    const { tenancyId } = await approvedTenant(stay);
    const t = (await api.ownerTenancy(stay.owner.token, tenancyId)).body.data;
    expect((await api.patchTenancy(stay.owner.token, tenancyId, {})).status).toBe(422);
    expect((await api.patchTenancy(stay.owner.token, tenancyId, { rentPaise: 650000, dueDay: 5, expectedVersion: 99 })).status).toBe(409);
    const ok = await api.patchTenancy(stay.owner.token, tenancyId, { rentPaise: 650000, dueDay: 5, graceDays: 3, expectedVersion: t.version });
    expect(ok.body.data).toMatchObject({ rentPaise: 650000, dueDay: 5, graceDays: 3, version: t.version + 1 });
    expect((await api.patchTenancy(stay.owner.token, tenancyId, { startDate: addDays(TODAY, -1) })).status).toBe(422);
    expect((await api.patchTenancy(stay.owner.token, tenancyId, { dueDay: 31 })).status).toBe(422);

    await api.deposit(stay.owner.token, tenancyId);
    expect((await api.patchTenancy(stay.owner.token, tenancyId, { depositPaise: 100 })).status).toBe(409);
    await api.activate(stay.owner.token, tenancyId);
    expect((await api.patchTenancy(stay.owner.token, tenancyId, { rentPaise: 1 + 100 })).status).toBe(409);
  });

  it('warns the owner (not the tenant) about a deposit above two months', async () => {
    const stay = await makeStay();
    const { tenant, tenancyId } = await approvedTenant(stay, { depositPaise: 600000 * 3 });
    expect((await api.ownerTenancy(stay.owner.token, tenancyId)).body.data.depositWarning).toMatch(/above 2 months/);
    expect((await api.myTenancy(tenant.token, tenancyId)).body.data.depositWarning).toBeNull();
    await api.patchTenancy(stay.owner.token, tenancyId, { depositPaise: 1200000 });
    expect((await api.ownerTenancy(stay.owner.token, tenancyId)).body.data.depositWarning).toBeNull();
  });
});

describe('property terms', () => {
  it('are defaults for future stays; existing stays keep their snapshot', async () => {
    const stay = await makeStay();
    const { tenancyId } = await approvedTenant(stay);
    expect((await api.patchTerms(stay.owner.token, stay.hostel.id, {})).status).toBe(422);
    expect((await api.patchTerms(stay.owner.token, stay.hostel.id, { rentDueDay: 29 })).status).toBe(422);
    const res = await api.patchTerms(stay.owner.token, stay.hostel.id, { depositMonths: 1, noticeDays: 60, rentDueDay: 10 });
    expect(res.body.data).toEqual({ depositMonths: 1, noticeDays: 60, rentDueDay: 10, rentGraceDays: 5, rentGstBps: 0, rentLateFeePaise: 0 });
    expect((await api.ownerTerms(stay.owner.token, stay.hostel.id)).body.data.noticeDays).toBe(60);
    expect((await api.ownerTenancy(stay.owner.token, tenancyId)).body.data).toMatchObject({ noticeDays: 30, dueDay: 1, depositPaise: 1200000 });
    const next = await approvedTenant(stay);
    expect((await api.ownerTenancy(stay.owner.token, next.tenancyId)).body.data).toMatchObject({ noticeDays: 60, dueDay: 10, depositPaise: 600000 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'hostel.tenancy_terms.update', entityId: stay.hostel.id } });
    expect(audit.metadata).toMatchObject({ hostelId: stay.hostel.id });
  });

  it('only exist for long-term properties and their own owner', async () => {
    const stay = await makeStay();
    const hotel = await publish({ propertyType: 'HOTEL', ownerId: stay.owner.id });
    expect((await api.ownerTerms(stay.owner.token, hotel.hostel.id)).status).toBe(409);
    const other = await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' });
    expect((await api.ownerTerms(other.token, stay.hostel.id)).status).toBe(404);
  });
});

describe('who can see a stay', () => {
  it("another tenant's stay looks missing; admins can list everything; the owner sees theirs", async () => {
    const stay = await makeStay();
    const { tenant, tenancyId } = await approvedTenant(stay);
    const other = await student();
    expect((await api.myTenancy(other.token, tenancyId)).status).toBe(404);
    expect((await api.myTenancies(other.token)).body.data).toEqual([]);
    expect((await api.ownerTenancy(stay.owner.token, tenancyId)).status).toBe(200);
    const rival = await makeStay();
    expect((await api.ownerTenancy(rival.owner.token, tenancyId)).status).toBe(404);
    expect((await api.ownerTenancies(rival.owner.token)).body.data).toEqual([]);
    const admin = await makeUser({ roles: ['ADMIN'] });
    expect((await api.adminTenancies(admin.token)).body.data.map((t: { id: string }) => t.id)).toContain(tenancyId);
    expect((await api.adminTenancies(tenant.token)).status).toBe(403);
    expect((await api.adminTenancies(stay.owner.token)).status).toBe(403);
  });
});

describe('database guarantees', () => {
  it('a bed holds one live stay and a person lives in one place', async () => {
    const stay = await makeStay({ units: 2 });
    const { tenancyId } = await approvedTenant(stay);
    const t = await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } });
    const base = { hostelId: t.hostelId, roomTypeId: t.roomTypeId, status: 'PENDING_MOVE_IN' as const, startDate: t.startDate, rentPaise: 1000, depositPaise: 0, dueDay: 1, graceDays: 5, noticeDays: 30, createdById: stay.owner.id };
    const someone = await student();
    await expect(prisma.tenancy.create({ data: { ...base, code: 'TN-DUPUNIT', unitId: t.unitId, tenantId: someone.id } })).rejects.toThrow();
    const otherUnit = await prisma.roomUnit.findFirstOrThrow({ where: { roomTypeId: t.roomTypeId, id: { not: t.unitId } } });
    await expect(prisma.tenancy.create({ data: { ...base, code: 'TN-DUPPERS', unitId: otherUnit.id, tenantId: t.tenantId } })).rejects.toThrow();
    await expect(prisma.tenancy.create({ data: { ...base, code: 'TN-NOBODY', unitId: otherUnit.id } })).rejects.toThrow(); // needs a tenant or an invite email
    await expect(prisma.tenancy.create({ data: { ...base, code: 'TN-ZERO', unitId: otherUnit.id, tenantId: someone.id, rentPaise: 0 } })).rejects.toThrow();
  });
});

describe('housekeeping', () => {
  it('expires stale requests and invitations, frees the bed, and is safe to repeat', async () => {
    const stay = await makeStay({ units: 2 });
    const s = await student();
    const req = await api.apply(s.token, stay.hostel.id, applyBody(stay.room.id));
    await prisma.tenancyApplication.update({ where: { id: req.body.data.id }, data: { createdAt: new Date(Date.now() - 15 * 86_400_000) } });
    const fresh = await student();
    const keep = await api.apply(fresh.token, stay.hostel.id, applyBody(stay.room.id));

    const email = `old-${Date.now()}@test.dev`;
    const inv = await invite(stay, email);
    await prisma.tenancy.update({ where: { id: inv.body.data.id }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });

    const first = await sweepTenancies(); // global: it may also clear stale rows left by other tests
    expect(first.expiredApplications).toBeGreaterThanOrEqual(1);
    expect(first.expiredInvites).toBeGreaterThanOrEqual(1);
    expect(await sweepTenancies()).toMatchObject({ expiredApplications: 0, expiredInvites: 0, ended: 0 });
    expect((await api.myApps(s.token)).body.data[0].status).toBe('EXPIRED');
    expect((await api.myApps(fresh.token)).body.data[0].id).toBe(keep.body.data.id);
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: inv.body.data.id } })).status).toBe('CANCELLED');
    expect(await prisma.notification.count({ where: { userId: s.id, type: 'TENANCY_REJECTED' } })).toBe(1);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'tenancy.application.expire', entityId: req.body.data.id } })).actorRole).toBe('SYSTEM');
    expect((await api.terms(stay.hostel.id)).body.data.rooms[0].freeUnits).toBe(2);
  });
});
