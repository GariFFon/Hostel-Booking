import { describe, expect, it } from 'vitest';
import { signAccessToken } from '@/core/auth/tokens';
import { prisma } from '@/infra/db/prisma';
import { outbox } from '@/infra/mail/mailer';
import { publish } from '../helpers/publish';
import { makeStay, student } from '../helpers/tenancy';
import { makeUser } from '../helpers/users';
import { cApi, complaintBody, livingTenant, makeStaff } from '../helpers/complaints';

const tokenFrom = (email: string) => decodeURIComponent(/invite=([^"&\s<]+)/.exec([...outbox].reverse().find((m) => m.to === email)?.html ?? '')?.[1] ?? '');
const registered = async (email: string, over: { verified?: boolean } = {}) => {
  const user = await prisma.user.create({ data: { email, status: 'ACTIVE', emailVerifiedAt: over.verified === false ? null : new Date(), profile: { create: { fullName: 'New Hire' } }, roles: { create: [{ role: 'GUEST' }] } } });
  const { token } = await signAccessToken({ id: user.id, roles: ['GUEST'], emailVerified: over.verified !== false });
  return { id: user.id, token };
};
const mail = () => `hire-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.dev`;

describe('an owner invites their own staff', () => {
  it('emails a link, and only the matching verified address can accept it', async () => {
    const stay = await makeStay();
    const email = mail();
    const sent = await cApi.invite(stay.owner.token, { email, trade: 'ELECTRICIAN', hostelIds: [stay.hostel.id] });
    expect(sent.status).toBe(201);
    expect(sent.body.data).toMatchObject({ email, trade: 'ELECTRICIAN', kind: 'OWN', hostels: [{ id: stay.hostel.id }] });
    expect(JSON.stringify(sent.body)).not.toMatch(/token/i); // the secret only goes by email
    const token = tokenFrom(email);
    expect(token.length).toBeGreaterThan(20);

    const stranger = await student();
    expect((await cApi.accept(stranger.token, token)).status).toBe(404); // someone else's invitation looks missing
    const hire = await registered(email);
    expect((await cApi.accept((await registered(mail(), { verified: false })).token, token)).status).toBe(403);

    const ok = await cApi.accept(hire.token, token);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ trade: 'ELECTRICIAN', kind: 'OWN', status: 'ACTIVE', openJobs: 0, hostels: [{ id: stay.hostel.id }] });
    expect((await prisma.userRoleAssignment.findMany({ where: { userId: hire.id } })).map((r) => r.role).sort()).toEqual(['GUEST', 'STAFF']);
    expect((await cApi.accept(hire.token, token)).status).toBe(401); // accepting revokes the old token, so it must sign in again
    const { token: refreshed } = await signAccessToken({ id: hire.id, roles: ['GUEST', 'STAFF'], emailVerified: true });
    expect((await cApi.accept(refreshed, token)).status).toBe(404); // single use
    expect(await prisma.auditLog.count({ where: { action: 'staff.invite.accept' } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { userId: stay.owner.id, type: 'STAFF_INVITED' } })).toBe(1);
  });

  it('a signed-in person with an account is told about it in the app too', async () => {
    const stay = await makeStay();
    const hire = await registered(mail());
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: hire.id } })).email;
    await cApi.invite(stay.owner.token, { email, trade: 'PLUMBER', hostelIds: [stay.hostel.id] });
    expect(await prisma.notification.count({ where: { userId: hire.id, type: 'STAFF_INVITED' } })).toBe(1);
  });

  it('only for the owner\'s own live hostels and PGs', async () => {
    const stay = await makeStay();
    const hotel = await publish({ propertyType: 'HOTEL', ownerId: stay.owner.id });
    const rival = await makeStay();
    const send = (hostelIds: string[]) => cApi.invite(stay.owner.token, { email: mail(), trade: 'COOK', hostelIds });
    expect((await send([])).status).toBe(422);
    expect((await send([hotel.hostel.id])).status).toBe(422); // hotels have no tenants to complain
    expect((await send([rival.hostel.id])).status).toBe(422); // someone else's property
    expect((await send([stay.hostel.id, stay.hostel.id])).status).toBe(201); // duplicates collapse
    expect((await cApi.invite(stay.owner.token, { email: mail(), trade: 'KING', hostelIds: [stay.hostel.id] })).status).toBe(422); // unknown trade
    expect((await cApi.invite(stay.owner.token, { email: mail(), trade: 'COOK', hostelIds: [stay.hostel.id], role: 'ADMIN' })).status).toBe(422);
  });

  it('refuses a second pending invitation to the same address, and people who are already staff', async () => {
    const stay = await makeStay();
    const email = mail();
    expect((await cApi.invite(stay.owner.token, { email, trade: 'CLEANER', hostelIds: [stay.hostel.id] })).status).toBe(201);
    expect((await cApi.invite(stay.owner.token, { email: email.toUpperCase(), trade: 'CLEANER', hostelIds: [stay.hostel.id] })).status).toBe(409);
    const staffer = await makeStaff(stay);
    const existing = (await prisma.user.findUniqueOrThrow({ where: { id: staffer.id } })).email;
    expect((await cApi.invite(stay.owner.token, { email: existing, trade: 'CLEANER', hostelIds: [stay.hostel.id] })).status).toBe(409);
  });

  it('can be cancelled by its owner only, and a cancelled or expired invitation cannot be used', async () => {
    const stay = await makeStay();
    const email = mail();
    const sent = await cApi.invite(stay.owner.token, { email, trade: 'SECURITY', hostelIds: [stay.hostel.id] });
    const token = tokenFrom(email);
    const rival = await makeStay();
    expect((await cApi.cancelInvite(rival.owner.token, sent.body.data.id)).status).toBe(404);
    expect((await cApi.cancelInvite(stay.owner.token, sent.body.data.id)).status).toBe(200);
    const hire = await registered(email);
    expect((await cApi.accept(hire.token, token)).status).toBe(404);
    expect((await cApi.team(stay.owner.token)).body.data.invites).toEqual([]);

    const email2 = mail();
    const second = await cApi.invite(stay.owner.token, { email: email2, trade: 'SECURITY', hostelIds: [stay.hostel.id] });
    await prisma.staffInvite.update({ where: { id: second.body.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await cApi.accept((await registered(email2)).token, tokenFrom(email2))).status).toBe(409);
  });

  it('someone who is already staff cannot accept a second invitation', async () => {
    const stay = await makeStay();
    const email = mail();
    const hire = await registered(email);
    await cApi.invite(stay.owner.token, { email, trade: 'COOK', hostelIds: [stay.hostel.id] });
    const first = tokenFrom(email);
    await prisma.staffProfile.create({ data: { userId: hire.id, trade: 'COOK', ownerId: stay.owner.id } }); // became staff another way in the meantime
    expect((await cApi.accept(hire.token, first)).status).toBe(409);
  });
});

describe('platform vendors', () => {
  it('an admin invites one, owners can see and engage them, and they work only where engaged', async () => {
    const admin = await makeUser({ roles: ['ADMIN'] });
    const email = mail();
    const sent = await cApi.adminInvite(admin.token, { email, trade: 'ELECTRICIAN' });
    expect(sent.body.data).toMatchObject({ kind: 'VENDOR', hostels: [] });
    const vendor = await registered(email);
    const accepted = await cApi.accept(vendor.token, tokenFrom(email));
    expect(accepted.body.data).toMatchObject({ kind: 'VENDOR', employer: null, hostels: [] });

    const a = await makeStay();
    const b = await makeStay();
    expect((await cApi.vendors(a.owner.token)).body.data.map((v: { userId: string }) => v.userId)).toContain(vendor.id);
    const engaged = await cApi.setHostels(a.owner.token, vendor.id, [a.hostel.id]);
    expect(engaged.status).toBe(200);
    expect(engaged.body.data.staff).toEqual([expect.objectContaining({ userId: vendor.id, kind: 'VENDOR', hostels: [{ id: a.hostel.id, name: a.hostel.name }] })]);
    expect((await cApi.team(b.owner.token)).body.data.staff).toEqual([]); // not engaged by b
    expect((await cApi.team(a.owner.token)).body.data.staff.map((s: { userId: string }) => s.userId)).toEqual([vendor.id]);

    // the same vendor can serve a second owner at the same time
    expect((await cApi.setHostels(b.owner.token, vendor.id, [b.hostel.id])).status).toBe(200);
    expect((await cApi.staffMe(vendor.token)).status).toBe(401); // the old token was revoked when the role was granted
    const { token: fresh } = await signAccessToken({ id: vendor.id, roles: ['GUEST', 'STAFF'], emailVerified: true });
    expect((await cApi.staffMe(fresh)).body.data.hostels.map((h: { id: string }) => h.id).sort()).toEqual([a.hostel.id, b.hostel.id].sort());
  });

  it('an owner cannot engage a vendor who is inactive, or another owner\'s own staff', async () => {
    const a = await makeStay();
    const b = await makeStay();
    const vendor = await makeStaff(a, { vendor: true, status: 'INACTIVE' });
    expect((await cApi.setHostels(a.owner.token, vendor.id, [a.hostel.id])).status).toBe(404);
    const theirs = await makeStaff(b);
    expect((await cApi.setHostels(a.owner.token, theirs.id, [a.hostel.id])).status).toBe(404);
    expect((await cApi.vendors(a.owner.token)).body.data.map((v: { userId: string }) => v.userId)).not.toContain(vendor.id);
  });

  it('admins and owners only: a tenant and staff are refused', async () => {
    const t = await livingTenant();
    const staffer = await makeStaff(t.stay);
    for (const token of [t.tenant.token, staffer.token]) {
      expect((await cApi.adminInvite(token, { email: mail(), trade: 'COOK' })).status).toBe(403);
      expect((await cApi.team(token)).status).toBe(403);
      expect((await cApi.adminStaff(token)).status).toBe(403);
    }
    expect((await cApi.invite(t.stay.owner.token, { email: mail(), trade: 'COOK', hostelIds: [t.stay.hostel.id] })).status).toBe(201);
  });
});

describe('an owner\'s team and who works where', () => {
  it('lists staff with their properties and open jobs', async () => {
    const t = await livingTenant();
    const plumber = await makeStaff(t.stay, { trade: 'PLUMBER' });
    await cApi.create(t.tenant.token, complaintBody()); // auto-assigned to the plumber
    const team = (await cApi.team(t.stay.owner.token)).body.data;
    expect(team.staff).toEqual([expect.objectContaining({ userId: plumber.id, trade: 'PLUMBER', kind: 'OWN', status: 'ACTIVE', openJobs: 1, hostels: [{ id: t.stay.hostel.id, name: t.stay.hostel.name }] })]);
  });

  it('changing where someone works hands their open jobs at removed properties back to the owner', async () => {
    const t = await livingTenant();
    const other = await publish({ propertyType: 'PG', ownerId: t.stay.owner.id });
    const plumber = await makeStaff(t.stay, { hostelIds: [t.stay.hostel.id, other.hostel.id] });
    const filed = await cApi.create(t.tenant.token, complaintBody());
    expect(filed.body.data).toMatchObject({ status: 'ASSIGNED', assignedStaff: { id: plumber.id } });

    expect((await cApi.setHostels(t.stay.owner.token, plumber.id, [other.hostel.id])).status).toBe(200); // no longer at this property
    const after = (await cApi.get(t.stay.owner.token, filed.body.data.id)).body.data;
    expect(after).toMatchObject({ status: 'OPEN', assignedStaff: null });
    expect(after.history.at(-1)).toMatchObject({ fromStatus: 'ASSIGNED', toStatus: 'OPEN', actorRole: 'SYSTEM' });
    expect(await prisma.notification.count({ where: { userId: t.stay.owner.id, title: `${filed.body.data.code} needs a new owner` } })).toBe(1);
  });

  it('deactivating own staff hands back everything and stops auto-assignment; reactivating restores access only when re-assigned', async () => {
    const t = await livingTenant();
    const plumber = await makeStaff(t.stay);
    const filed = await cApi.create(t.tenant.token, complaintBody());
    expect((await cApi.setStatus(t.stay.owner.token, plumber.id, 'INACTIVE')).status).toBe(200);
    expect((await cApi.get(t.stay.owner.token, filed.body.data.id)).body.data.status).toBe('OPEN');
    const next = await cApi.create(t.tenant.token, complaintBody({ title: 'Another leak' }));
    expect(next.body.data.status).toBe('OPEN'); // nobody active to give it to
    expect((await cApi.setStatus(t.stay.owner.token, plumber.id, 'INACTIVE')).status).toBe(409); // already inactive
    expect((await cApi.setStatus(t.stay.owner.token, plumber.id, 'ACTIVE')).status).toBe(200);
    const again = await cApi.create(t.tenant.token, complaintBody({ title: 'Third leak' }));
    expect(again.body.data.status).toBe('OPEN'); // assignments were switched off: the owner must add them back
    await cApi.setHostels(t.stay.owner.token, plumber.id, [t.stay.hostel.id]);
    expect((await cApi.create(t.tenant.token, complaintBody({ title: 'Fourth leak' }))).body.data.status).toBe('ASSIGNED');
  });

  it('an owner cannot deactivate a vendor or another owner\'s staff; an admin can deactivate anyone', async () => {
    const a = await makeStay();
    const b = await makeStay();
    const vendor = await makeStaff(a, { vendor: true });
    const theirs = await makeStaff(b);
    expect((await cApi.setStatus(a.owner.token, vendor.id, 'INACTIVE')).status).toBe(404);
    expect((await cApi.setStatus(a.owner.token, theirs.id, 'INACTIVE')).status).toBe(404);
    const admin = await makeUser({ roles: ['ADMIN'] });
    expect((await cApi.adminStatus(admin.token, vendor.id, 'INACTIVE')).status).toBe(200);
    expect((await prisma.staffProfile.findUniqueOrThrow({ where: { userId: vendor.id } })).status).toBe('INACTIVE');
    expect((await cApi.adminStaff(admin.token)).body.data.map((s: { userId: string }) => s.userId)).toContain(theirs.id);
  });

  it('is audited against the property', async () => {
    const stay = await makeStay();
    const staffer = await makeStaff(stay, { hostelIds: [] });
    await cApi.setHostels(stay.owner.token, staffer.id, [stay.hostel.id]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'staff.assignments.set', entityId: staffer.id } });
    expect(audit.metadata).toMatchObject({ hostelId: stay.hostel.id });
  });
});
