import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloudinaryStorage, setMediaStorage } from '@/infra/cloudinary/storage';
import { prisma } from '@/infra/db/prisma';
import { sweepComplaints } from '@/modules/complaints/complaints-sweep.service';
import { FakeStorage } from '../helpers/fake-storage';
import { makeUser } from '../helpers/users';
import { cApi, complaintBody, livingTenant, makeStaff, uploadPhoto } from '../helpers/complaints';
import { makeStay } from '../helpers/tenancy';

const storage = new FakeStorage();
beforeAll(() => setMediaStorage(storage));
afterAll(() => setMediaStorage(cloudinaryStorage));
const DAY = 86_400_000;

describe('filing a complaint', () => {
  it('needs a stay, a verified email, and valid input', async () => {
    const outsider = await makeUser();
    expect((await cApi.create(outsider.token, complaintBody())).status).toBe(409); // no tenancy
    const t = await livingTenant();
    const unverified = await makeUser({ verified: false });
    expect((await cApi.create(unverified.token, complaintBody())).status).toBe(403);
    for (const bad of [{ title: 'ab' }, { description: '' }, { category: 'MAGIC' }, { priority: 'URGENT' }, { extra: 1 }]) {
      expect((await cApi.create(t.tenant.token, complaintBody(bad))).status).toBe(422);
    }
    expect((await cApi.create(t.stay.owner.token, complaintBody())).status).toBe(409); // owner has no tenancy
  });

  it('creates an OPEN complaint with a code, SLA deadline, location, history and audit', async () => {
    const t = await livingTenant();
    const before = Date.now();
    const res = await cApi.create(t.tenant.token, complaintBody({ priority: 'HIGH' }));
    expect(res.status).toBe(201);
    const c = res.body.data;
    expect(c).toMatchObject({ status: 'OPEN', category: 'PLUMBING', priority: 'HIGH', viewer: 'TENANT', assignedStaff: null, slaBreached: false, rating: null, reopenCount: 0 });
    expect(c.code).toMatch(/^CMP-[A-Z0-9]{6}$/);
    expect(c.location).toMatch(/^Bed /);
    expect(new Date(c.slaDueAt).getTime() - before).toBeGreaterThan(23 * 3600_000);
    expect(new Date(c.slaDueAt).getTime() - before).toBeLessThan(25 * 3600_000);
    expect(c.history).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'OPEN', actorRole: 'TENANT' })]);
    expect(c.actions.sort()).toEqual(['add_photo', 'close', 'comment', 'set_availability']);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'complaint.create', entityId: c.id } });
    expect(audit.metadata).toMatchObject({ hostelId: t.stay.hostel.id });
    expect(await prisma.notification.count({ where: { userId: t.stay.owner.id, type: 'COMPLAINT_CREATED' } })).toBe(1);
  });

  it('allows at most 10 unresolved complaints at once', async () => {
    const t = await livingTenant();
    for (let i = 0; i < 10; i++) expect((await cApi.create(t.tenant.token, complaintBody({ title: `Issue number ${i}` }))).status).toBe(201);
    expect((await cApi.create(t.tenant.token, complaintBody({ title: 'One too many' }))).status).toBe(409);
  });

  it('can still be filed while serving notice', async () => {
    const t = await livingTenant();
    await prisma.tenancy.update({ where: { id: t.tenancyId }, data: { status: 'NOTICE' } });
    expect((await cApi.create(t.tenant.token, complaintBody())).status).toBe(201);
  });
});

describe('auto-assignment', () => {
  it('picks an active staff member of the right trade at that property, with the fewest open jobs', async () => {
    const t = await livingTenant();
    const busy = await makeStaff(t.stay, { trade: 'PLUMBER', name: 'Busy Plumber' });
    const free = await makeStaff(t.stay, { trade: 'PLUMBER', name: 'Free Plumber' });
    const first = await cApi.create(t.tenant.token, complaintBody({ title: 'First leak' }));
    const firstWho = first.body.data.assignedStaff.id;
    expect([busy.id, free.id]).toContain(firstWho);
    expect(first.body.data.status).toBe('ASSIGNED');
    const second = await cApi.create(t.tenant.token, complaintBody({ title: 'Second leak' }));
    expect(second.body.data.assignedStaff.id).not.toBe(firstWho); // the other one has fewer jobs
    expect(first.body.data.history.at(-1)).toMatchObject({ actorRole: 'SYSTEM', toStatus: 'ASSIGNED' });
    expect(await prisma.notification.count({ where: { userId: firstWho, type: 'COMPLAINT_ASSIGNED' } })).toBe(1);
  });

  it('ignores the wrong trade, inactive staff and staff at other properties', async () => {
    const t = await livingTenant();
    const other = await makeStay();
    await makeStaff(t.stay, { trade: 'ELECTRICIAN' });
    await makeStaff(t.stay, { trade: 'PLUMBER', status: 'INACTIVE' });
    await makeStaff(other, { trade: 'PLUMBER' });
    expect((await cApi.create(t.tenant.token, complaintBody())).body.data).toMatchObject({ status: 'OPEN', assignedStaff: null });
  });

  it('leaves categories with no trade (and OTHER) for the owner', async () => {
    const t = await livingTenant();
    await makeStaff(t.stay, { trade: 'OTHER' });
    await makeStaff(t.stay, { trade: 'PLUMBER' });
    expect((await cApi.create(t.tenant.token, complaintBody({ category: 'BEHAVIOUR', title: 'Noisy neighbour' }))).body.data.status).toBe('OPEN');
  });

  it('a platform vendor engaged at the property gets the job', async () => {
    const t = await livingTenant();
    const vendor = await makeStaff(t.stay, { trade: 'ELECTRICIAN', vendor: true });
    expect((await cApi.create(t.tenant.token, complaintBody({ category: 'ELECTRICAL', title: 'No power' }))).body.data.assignedStaff.id).toBe(vendor.id);
  });
});

describe('who can see what', () => {
  it('the tenant, the owner, the assigned staff and admins see it; everyone else gets 404', async () => {
    const t = await livingTenant();
    const staffer = await makeStaff(t.stay);
    const id = (await cApi.create(t.tenant.token, complaintBody())).body.data.id;
    const stranger = await livingTenant(); // another tenant, another owner
    const rivalOwner = await makeStay();
    const unassigned = await makeStaff(t.stay, { trade: 'CARPENTER' });
    const admin = await makeUser({ roles: ['ADMIN'] });
    for (const [who, viewer] of [[t.tenant, 'TENANT'], [t.stay.owner, 'OWNER'], [staffer, 'STAFF'], [admin, 'ADMIN']] as const) {
      expect((await cApi.get(who.token, id)).body.data.viewer).toBe(viewer);
    }
    for (const who of [stranger.tenant, rivalOwner.owner, unassigned, await makeUser()]) expect((await cApi.get(who.token, id)).status).toBe(404);
    expect((await cApi.get(t.tenant.token, '01a1df4d-2583-7141-9882-3b725fcea871')).status).toBe(404);
  });

  it('staff see no tenant contact details; the owner does', async () => {
    const t = await livingTenant();
    const staffer = await makeStaff(t.stay);
    const id = (await cApi.create(t.tenant.token, complaintBody())).body.data.id;
    const asStaff = JSON.stringify((await cApi.get(staffer.token, id)).body.data.raisedBy);
    expect(asStaff).not.toContain('@');
    expect(JSON.stringify((await cApi.get(t.stay.owner.token, id)).body.data.raisedBy)).toContain('@');
  });

  it('lists are scoped to the caller and filterable', async () => {
    const a = await livingTenant();
    const b = await livingTenant();
    const staffer = await makeStaff(a.stay);
    const mineA = (await cApi.create(a.tenant.token, complaintBody())).body.data;
    await cApi.create(b.tenant.token, complaintBody({ title: 'Other tenant issue' }));
    expect((await cApi.mine(a.tenant.token)).body.data.map((c: { id: string }) => c.id)).toEqual([mineA.id]);
    expect((await cApi.ownerList(a.stay.owner.token)).body.data.map((c: { id: string }) => c.id)).toEqual([mineA.id]);
    expect((await cApi.ownerList(a.stay.owner.token, '?status=CLOSED')).body.data).toEqual([]);
    expect((await cApi.ownerList(a.stay.owner.token, '?unassigned=true')).body.data).toEqual([]); // it was auto-assigned
    expect((await cApi.staffList(staffer.token, '?open=true')).body.data.map((c: { id: string }) => c.id)).toEqual([mineA.id]);
    expect((await cApi.staffList((await makeStaff(a.stay, { trade: 'COOK' })).token)).body.data).toEqual([]);
    expect((await cApi.adminList((await makeUser({ roles: ['ADMIN'] })).token)).body.data.length).toBeGreaterThanOrEqual(2);
    expect((await cApi.adminList(a.tenant.token)).status).toBe(403);
    expect((await cApi.ownerList(a.tenant.token)).status).toBe(403);
    expect((await cApi.staffList(a.stay.owner.token)).status).toBe(403);
  });
});

describe('the lifecycle', () => {
  it('owner acknowledges, assigns; staff starts, holds, resumes and resolves; tenant rates and it auto-closes', async () => {
    const t = await livingTenant();
    const staffer = await makeStaff(t.stay, { trade: 'OTHER' });
    const id = (await cApi.create(t.tenant.token, complaintBody({ category: 'OTHER', title: 'Window stuck' }))).body.data.id;
    expect((await cApi.owner(t.stay.owner.token, id, { action: 'acknowledge' })).body.data.status).toBe('ACKNOWLEDGED');
    const assigned = await cApi.owner(t.stay.owner.token, id, { action: 'assign', staffUserId: staffer.id });
    expect(assigned.body.data).toMatchObject({ status: 'ASSIGNED', assignedStaff: { id: staffer.id } });
    expect((await cApi.staff(staffer.token, id, { action: 'start' })).body.data.status).toBe('IN_PROGRESS');
    expect((await cApi.staff(staffer.token, id, { action: 'hold', reason: 'Waiting for a part' })).body.data.status).toBe('ON_HOLD');
    expect((await cApi.staff(staffer.token, id, { action: 'start' })).body.data.status).toBe('IN_PROGRESS');
    const done = await cApi.staff(staffer.token, id, { action: 'resolve', note: 'Replaced the latch' });
    expect(done.body.data).toMatchObject({ status: 'RESOLVED', resolutionNote: 'Replaced the latch' });
    expect(done.body.data.resolvedAt).toBeTruthy();
    expect(done.body.data.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'IN_PROGRESS', 'RESOLVED']);
    expect(await prisma.notification.count({ where: { userId: t.tenant.id, type: 'COMPLAINT_RESOLVED' } })).toBe(1);

    const rated = await cApi.tenant(t.tenant.token, id, { action: 'rate', rating: 5, feedback: 'Quick work' });
    expect(rated.body.data).toMatchObject({ rating: 5, feedback: 'Quick work' });
    expect((await cApi.tenant(t.tenant.token, id, { action: 'rate', rating: 4 })).status).toBe(409); // once only
    expect((await cApi.tenant(t.tenant.token, id, { action: 'close' })).body.data.status).toBe('CLOSED');
    expect(await prisma.auditLog.count({ where: { entityId: id, action: { startsWith: 'complaint.' } } })).toBeGreaterThanOrEqual(7);
  });

  it('refuses illegal moves and out-of-range input', async () => {
    const t = await livingTenant();
    const staffer = await makeStaff(t.stay);
    const id = (await cApi.create(t.tenant.token, complaintBody())).body.data.id; // ASSIGNED to staffer
    expect((await cApi.tenant(t.tenant.token, id, { action: 'reopen', reason: 'not resolved yet' })).status).toBe(409);
    expect((await cApi.tenant(t.tenant.token, id, { action: 'rate', rating: 5 })).status).toBe(409);
    expect((await cApi.tenant(t.tenant.token, id, { action: 'rate', rating: 6 })).status).toBe(422);
    expect((await cApi.tenant(t.tenant.token, id, { action: 'resolve', note: 'x' })).status).toBe(422);
    expect((await cApi.staff(staffer.token, id, { action: 'hold' })).status).toBe(422); // reason required
    expect((await cApi.staff(staffer.token, id, { action: 'resolve', note: 'fixed' })).body.data.status).toBe('RESOLVED');
    expect((await cApi.staff(staffer.token, id, { action: 'start' })).status).toBe(409); // resolved: cannot restart
    expect((await cApi.owner(t.stay.owner.token, id, { action: 'acknowledge' })).status).toBe(409);
    expect((await cApi.owner(t.stay.owner.token, id, { action: 'reject', reason: 'late' })).status).toBe(409);
  });

  it('keeps each role to its own complaints: wrong person is 404, wrong role is 403', async () => {
    const t = await livingTenant();
    const staffer = await makeStaff(t.stay);
    const id = (await cApi.create(t.tenant.token, complaintBody())).body.data.id;
    const other = await livingTenant();
    const rivalOwner = await makeStay();
    const otherStaff = await makeStaff(t.stay, { trade: 'COOK' });
    expect((await cApi.tenant(other.tenant.token, id, { action: 'close' })).status).toBe(404);
    expect((await cApi.owner(rivalOwner.owner.token, id, { action: 'acknowledge' })).status).toBe(404);
    expect((await cApi.staff(otherStaff.token, id, { action: 'start' })).status).toBe(404);
    expect((await cApi.owner(t.tenant.token, id, { action: 'acknowledge' })).status).toBe(403);
    expect((await cApi.staff(t.stay.owner.token, id, { action: 'start' })).status).toBe(403);
    expect((await cApi.tenant(staffer.token, id, { action: 'close' })).status).toBe(404);
  });

  it('the owner can reassign, unassign, reprioritise, resolve and reject', async () => {
    const t = await livingTenant();
    const p1 = await makeStaff(t.stay, { name: 'One' });
    const p2 = await makeStaff(t.stay, { name: 'Two' });
    const rival = await makeStay();
    const outsider = await makeStaff(rival);
    const id = (await cApi.create(t.tenant.token, complaintBody())).body.data.id;
    const now = await cApi.get(t.stay.owner.token, id);
    const current = now.body.data.assignedStaff.id as string;
    const next = current === p1.id ? p2.id : p1.id;
    expect((await cApi.owner(t.stay.owner.token, id, { action: 'assign', staffUserId: next })).body.data.assignedStaff.id).toBe(next);
    expect((await cApi.owner(t.stay.owner.token, id, { action: 'assign', staffUserId: outsider.id })).status).toBe(422); // not at this property
    const up = await cApi.owner(t.stay.owner.token, id, { action: 'priority', priority: 'URGENT' });
    expect(up.body.data.priority).toBe('URGENT');
    expect(new Date(up.body.data.slaDueAt).getTime() - Date.now()).toBeLessThan(5 * 3600_000);
    expect((await cApi.owner(t.stay.owner.token, id, { action: 'priority', priority: 'URGENT' })).status).toBe(409);
    expect((await cApi.owner(t.stay.owner.token, id, { action: 'unassign' })).body.data).toMatchObject({ status: 'OPEN', assignedStaff: null });
    expect((await cApi.owner(t.stay.owner.token, id, { action: 'resolve', note: 'Fixed it myself' })).body.data.status).toBe('RESOLVED');

    const second = (await cApi.create(t.tenant.token, complaintBody({ title: 'Not a real issue' }))).body.data.id;
    const rej = await cApi.owner(t.stay.owner.token, second, { action: 'reject', reason: 'Not covered' });
    expect(rej.body.data.status).toBe('REJECTED');
    expect((await cApi.comment(t.tenant.token, second, { body: 'but why' })).status).toBe(409); // terminal
  });

  it('a tenant can close their own open complaint', async () => {
    const t = await livingTenant();
    const id = (await cApi.create(t.tenant.token, complaintBody())).body.data.id;
    expect((await cApi.tenant(t.tenant.token, id, { action: 'close' })).body.data.status).toBe('CLOSED');
  });
});

describe('reopening and rating', () => {
  const resolved = async () => {
    const t = await livingTenant();
    const staffer = await makeStaff(t.stay);
    const id = (await cApi.create(t.tenant.token, complaintBody())).body.data.id;
    await cApi.staff(staffer.token, id, { action: 'resolve', note: 'Done' });
    return { ...t, staffer, id };
  };

  it('can be reopened within the window, goes back to the owner, and is capped at 3 times', async () => {
    const r = await resolved();
    for (let i = 1; i <= 3; i++) {
      const re = await cApi.tenant(r.tenant.token, r.id, { action: 'reopen', reason: `Still broken ${i}` });
      expect(re.body.data).toMatchObject({ status: 'REOPENED', reopenCount: i });
      await cApi.staff(r.staffer.token, r.id, { action: 'resolve', note: 'Again' });
    }
    expect((await cApi.tenant(r.tenant.token, r.id, { action: 'reopen', reason: 'Fourth time' })).status).toBe(409);
  });

  it('cannot be reopened after the window, or once closed', async () => {
    const r = await resolved();
    await prisma.complaint.update({ where: { id: r.id }, data: { resolvedAt: new Date(Date.now() - 8 * DAY) } });
    expect((await cApi.tenant(r.tenant.token, r.id, { action: 'reopen', reason: 'Too late now' })).status).toBe(409);
    const r2 = await resolved();
    await cApi.tenant(r2.tenant.token, r2.id, { action: 'close' });
    expect((await cApi.tenant(r2.tenant.token, r2.id, { action: 'reopen', reason: 'closed already' })).status).toBe(409);
  });

  it('can be rated after closing but not twice', async () => {
    const r = await resolved();
    await cApi.tenant(r.tenant.token, r.id, { action: 'close' });
    expect((await cApi.tenant(r.tenant.token, r.id, { action: 'rate', rating: 3 })).body.data.rating).toBe(3);
    expect((await cApi.tenant(r.tenant.token, r.id, { action: 'rate', rating: 3 })).status).toBe(409);
  });
});

describe('comments', () => {
  it('everyone involved can comment; internal notes are hidden from the tenant', async () => {
    const t = await livingTenant();
    const staffer = await makeStaff(t.stay);
    const id = (await cApi.create(t.tenant.token, complaintBody())).body.data.id;
    expect((await cApi.comment(t.tenant.token, id, { body: 'It is getting worse' })).status).toBe(201);
    expect((await cApi.comment(staffer.token, id, { body: 'On my way' })).status).toBe(201);
    expect((await cApi.comment(t.stay.owner.token, id, { body: 'Tenant is a bit rude', internal: true })).status).toBe(201);
    expect((await cApi.comment(t.tenant.token, id, { body: 'sneaky', internal: true })).status).toBe(422);
    const tenantView = (await cApi.get(t.tenant.token, id)).body.data;
    expect(tenantView.comments.map((c: { body: string }) => c.body)).toEqual(['It is getting worse', 'On my way']);
    expect(tenantView.commentCount).toBe(2);
    const ownerView = (await cApi.get(t.stay.owner.token, id)).body.data;
    expect(ownerView.comments).toHaveLength(3);
    expect(ownerView.comments.find((c: { internal: boolean }) => c.internal)).toMatchObject({ authorRole: 'OWNER' });
  });

  it('refuses empty, oversized, admin and stranger comments', async () => {
    const t = await livingTenant();
    const id = (await cApi.create(t.tenant.token, complaintBody())).body.data.id;
    expect((await cApi.comment(t.tenant.token, id, { body: '   ' })).status).toBe(422);
    expect((await cApi.comment(t.tenant.token, id, { body: 'x'.repeat(1001) })).status).toBe(422);
    expect((await cApi.comment((await makeUser({ roles: ['ADMIN'] })).token, id, { body: 'hi' })).status).toBe(403);
    expect((await cApi.comment((await livingTenant()).tenant.token, id, { body: 'hi' })).status).toBe(404);
  });
});

describe('photos', () => {
  it('signs, verifies and attaches photos for the people involved, up to 6', async () => {
    const t = await livingTenant();
    const id = (await cApi.create(t.tenant.token, complaintBody())).body.data.id;
    const pid = await uploadPhoto(t.tenant.token, id, storage);
    const attached = await cApi.attach(t.tenant.token, id, pid);
    expect(attached.status).toBe(201);
    expect((await cApi.get(t.tenant.token, id)).body.data.media).toEqual([expect.objectContaining({ uploadedByRole: 'TENANT', url: expect.stringContaining('https://') })]);
    expect((await cApi.attach(t.tenant.token, id, pid)).status).toBe(409); // already attached
    expect((await cApi.attach(t.tenant.token, id, 'complaints/never-uploaded-abcdef')).status).toBeGreaterThanOrEqual(400);
    for (let i = 0; i < 5; i++) expect((await cApi.attach(t.tenant.token, id, await uploadPhoto(t.tenant.token, id, storage))).status).toBe(201);
    expect((await cApi.attach(t.tenant.token, id, await uploadPhoto(t.tenant.token, id, storage))).status).toBe(409); // seventh
  });

  it('a stranger cannot sign an upload or attach someone else\'s file; admins cannot add photos', async () => {
    const t = await livingTenant();
    const other = await livingTenant();
    const id = (await cApi.create(t.tenant.token, complaintBody())).body.data.id;
    expect((await cApi.signature(other.tenant.token, { purpose: 'COMPLAINT_IMAGE', complaintId: id })).status).toBe(404);
    expect((await cApi.signature(t.tenant.token, { purpose: 'COMPLAINT_IMAGE' })).status).toBe(422); // needs a complaint
    const admin = await makeUser({ roles: ['ADMIN'] });
    expect((await cApi.signature(admin.token, { purpose: 'COMPLAINT_IMAGE', complaintId: id })).status).toBe(403);
    // a file signed for another complaint cannot be attached here
    const otherId = (await cApi.create(other.tenant.token, complaintBody())).body.data.id;
    const foreign = await uploadPhoto(other.tenant.token, otherId, storage);
    expect((await cApi.attach(t.tenant.token, id, foreign)).status).toBeGreaterThanOrEqual(400);
    expect((await cApi.get(t.tenant.token, id)).body.data.media).toEqual([]);
  });
});

describe('concurrency and the database', () => {
  it('two simultaneous moves on one complaint: exactly one wins', async () => {
    const t = await livingTenant();
    const staffer = await makeStaff(t.stay);
    const id = (await cApi.create(t.tenant.token, complaintBody())).body.data.id;
    const results = await Promise.all([cApi.staff(staffer.token, id, { action: 'resolve', note: 'one' }), cApi.owner(t.stay.owner.token, id, { action: 'resolve', note: 'two' })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.complaintStatusHistory.count({ where: { complaintId: id, toStatus: 'RESOLVED' } })).toBe(1);
  });

  it('history is append-only and ratings/reopen counts are range-checked by the database', async () => {
    const t = await livingTenant();
    const id = (await cApi.create(t.tenant.token, complaintBody())).body.data.id;
    const h = await prisma.complaintStatusHistory.findFirstOrThrow({ where: { complaintId: id } });
    await expect(prisma.complaintStatusHistory.update({ where: { id: h.id }, data: { note: 'edited' } })).rejects.toThrow();
    await expect(prisma.complaintStatusHistory.delete({ where: { id: h.id } })).rejects.toThrow();
    await expect(prisma.complaint.update({ where: { id }, data: { rating: 6 } })).rejects.toThrow();
    await expect(prisma.complaint.update({ where: { id }, data: { reopenCount: -1 } })).rejects.toThrow();
  });
});

describe('the hourly sweep', () => {
  it('flags an overdue complaint once, and auto-closes resolved ones after a week', async () => {
    const t = await livingTenant();
    const staffer = await makeStaff(t.stay);
    const late = (await cApi.create(t.tenant.token, complaintBody({ priority: 'HIGH', title: 'Slow job' }))).body.data;
    const future = new Date(Date.now() + 3 * DAY);
    await sweepComplaints(future);
    await sweepComplaints(future);
    const overdue = (userId: string) => prisma.notification.count({ where: { userId, title: `${late.code} is overdue` } });
    expect(await overdue(t.stay.owner.id)).toBe(1); // twice swept, told once
    expect(await overdue(staffer.id)).toBe(1);
    await sweepComplaints(new Date(future.getTime() + 1000));
    expect(await overdue(t.stay.owner.id)).toBe(1);

    await cApi.staff(staffer.token, late.id, { action: 'resolve', note: 'Done at last' });
    await sweepComplaints(new Date(Date.now() + 3 * DAY));
    expect((await cApi.get(t.tenant.token, late.id)).body.data.status).toBe('RESOLVED'); // not yet
    await sweepComplaints(new Date(Date.now() + 8 * DAY));
    const closed = (await cApi.get(t.tenant.token, late.id)).body.data;
    expect(closed.status).toBe('CLOSED');
    expect(closed.history.at(-1)).toMatchObject({ actorRole: 'SYSTEM', toStatus: 'CLOSED' });
  });
});
