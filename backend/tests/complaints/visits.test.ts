import { describe, expect, it } from 'vitest';
import { prisma } from '@/infra/db/prisma';
import { sweepComplaints } from '@/modules/complaints/complaints-sweep.service';
import { makeUser } from '../helpers/users';
import { cApi, complaintBody, freeWindow, livingTenant, makeStaff } from '../helpers/complaints';

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const slot = (fromHours: number, lengthHours = 1) => ({ visitStart: iso(Date.now() + fromHours * HOUR), visitEnd: iso(Date.now() + (fromHours + lengthHours) * HOUR) });

async function assigned() {
  const t = await livingTenant();
  const staffer = await makeStaff(t.stay);
  const c = (await cApi.create(t.tenant.token, complaintBody({ ...freeWindow(1, 5), allowEntryIfAway: true }))).body.data;
  return { ...t, staffer, id: c.id as string, c };
}

describe('the tenant\'s free time is mandatory', () => {
  it('is required, and must be a sensible window', async () => {
    const t = await livingTenant();
    const { availableFrom, availableTo, ...noWindow } = complaintBody();
    expect(availableFrom && availableTo).toBeTruthy();
    expect((await cApi.create(t.tenant.token, noWindow)).status).toBe(422);
    expect((await cApi.create(t.tenant.token, { ...noWindow, availableFrom })).status).toBe(422);
    const bad = (w: Record<string, string>) => cApi.create(t.tenant.token, complaintBody(w));
    const now = Date.now();
    expect((await bad({ availableFrom: iso(now + 3 * HOUR), availableTo: iso(now + 2 * HOUR) })).status).toBe(422); // ends before it starts
    expect((await bad({ availableFrom: iso(now + HOUR), availableTo: iso(now + HOUR + 20 * 60_000) })).status).toBe(422); // under an hour
    expect((await bad({ availableFrom: iso(now + HOUR), availableTo: iso(now + 9 * 24 * HOUR) })).status).toBe(422); // over 7 days
    expect((await bad({ availableFrom: iso(now - 5 * HOUR), availableTo: iso(now - 2 * HOUR) })).status).toBe(422); // already over
    expect((await bad({ availableFrom: iso(now + 40 * 24 * HOUR), availableTo: iso(now + 40 * 24 * HOUR + 3 * HOUR) })).status).toBe(422); // too far ahead
    expect((await bad({ availableFrom: 'tomorrow', availableTo: 'later' })).status).toBe(422);
    const ok = await cApi.create(t.tenant.token, complaintBody({ ...freeWindow(0, 3), allowEntryIfAway: true }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.availability).toMatchObject({ allowEntryIfAway: true });
    expect(ok.body.data.visit).toBeNull();
  });

  it('is shown to the owner and the assigned staff member, who are told it', async () => {
    const t = await livingTenant();
    const staffer = await makeStaff(t.stay);
    const filed = (await cApi.create(t.tenant.token, complaintBody(freeWindow(2, 3)))).body.data;
    for (const who of [t.stay.owner, staffer]) expect((await cApi.get(who.token, filed.id)).body.data.availability).toEqual(filed.availability);
    const job = await prisma.notification.findFirstOrThrow({ where: { userId: staffer.id, type: 'COMPLAINT_ASSIGNED' } });
    expect(job.body).toMatch(/Tenant is free/);
    const ownerNote = await prisma.notification.findFirstOrThrow({ where: { userId: t.stay.owner.id, type: 'COMPLAINT_CREATED' } });
    expect(ownerNote.body).toMatch(/Tenant is free/);
  });

  it('is stored consistently by the database (both ends or neither, positive length)', async () => {
    const a = await assigned();
    await expect(prisma.complaint.update({ where: { id: a.id }, data: { availableFrom: null } })).rejects.toThrow();
    await expect(prisma.complaint.update({ where: { id: a.id }, data: { availableTo: new Date(Date.now() - 10 * HOUR) } })).rejects.toThrow();
    await expect(prisma.complaint.update({ where: { id: a.id }, data: { visitStart: new Date() } })).rejects.toThrow();
  });
});

describe('booking a visit', () => {
  it('staff book a slot inside the free time; the tenant and owner are told; status does not change', async () => {
    const a = await assigned();
    const slotBody = { action: 'schedule', ...slot(2, 1) };
    expect(a.c.actions).not.toContain('schedule'); // tenants do not book visits
    const res = await cApi.staff(a.staffer.token, a.id, slotBody);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ASSIGNED');
    expect(res.body.data.visit).toEqual({ start: slotBody.visitStart, end: slotBody.visitEnd });
    expect(res.body.data.actions).toContain('schedule'); // can be moved
    const told = await prisma.notification.findFirstOrThrow({ where: { userId: a.tenant.id, title: 'Visit booked' } });
    expect(told.body).toMatch(a.c.code);
    expect(told.body).not.toMatch(/Please be home/); // they allowed entry when away
    expect(await prisma.notification.count({ where: { userId: a.stay.owner.id, title: `Visit booked for ${a.c.code}` } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'complaint.schedule', entityId: a.id } });
    expect(audit.metadata).toMatchObject({ hostelId: a.stay.hostel.id });
    expect((await cApi.get(a.tenant.token, a.id)).body.data.visit).toEqual(res.body.data.visit);
  });

  it('asks the tenant to be home when they did not allow entry while away', async () => {
    const t = await livingTenant();
    const staffer = await makeStaff(t.stay);
    const id = (await cApi.create(t.tenant.token, complaintBody(freeWindow(1, 5)))).body.data.id;
    await cApi.staff(staffer.token, id, { action: 'schedule', ...slot(2) });
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: t.tenant.id, title: 'Visit booked' } })).body).toMatch(/Please be home/);
  });

  it('refuses a slot outside the free time, in the past, backwards, or too long', async () => {
    const a = await assigned(); // free from +1h to +6h
    const book = (s: { visitStart: string; visitEnd: string }) => cApi.staff(a.staffer.token, a.id, { action: 'schedule', ...s });
    expect((await book(slot(0.2, 0.5))).status).toBe(422); // before the free time
    expect((await book(slot(5.5, 2))).status).toBe(422); // runs past it
    expect((await book(slot(8, 1))).status).toBe(422); // after it
    expect((await book({ visitStart: iso(Date.now() + 3 * HOUR), visitEnd: iso(Date.now() + 2 * HOUR) })).status).toBe(422);
    expect((await book({ visitStart: 'soon', visitEnd: 'later' })).status).toBe(422);
    expect((await book(slot(1.2, 1))).status).toBe(200);
    expect((await cApi.get(a.tenant.token, a.id)).body.data.visit).not.toBeNull();
  });

  it('can be moved by booking again, and the owner can book one too', async () => {
    const a = await assigned();
    await cApi.staff(a.staffer.token, a.id, { action: 'schedule', ...slot(2) });
    const second = slot(4);
    const moved = await cApi.owner(a.stay.owner.token, a.id, { action: 'schedule', ...second });
    expect(moved.status).toBe(200);
    expect(moved.body.data.visit).toEqual({ start: second.visitStart, end: second.visitEnd });
    expect(await prisma.notification.count({ where: { userId: a.staffer.id, title: `Visit set for ${a.c.code}` } })).toBe(1);
  });

  it('needs a job that is with staff, and only the right people can book', async () => {
    const t = await livingTenant();
    const filed = (await cApi.create(t.tenant.token, complaintBody(freeWindow(1, 5)))).body.data; // nobody to assign: OPEN
    expect((await cApi.owner(t.stay.owner.token, filed.id, { action: 'schedule', ...slot(2) })).status).toBe(409);
    const a = await assigned();
    const other = await makeStaff(a.stay, { trade: 'COOK' });
    expect((await cApi.staff(other.token, a.id, { action: 'schedule', ...slot(2) })).status).toBe(404); // not their job
    expect((await cApi.tenant(a.tenant.token, a.id, { action: 'schedule', ...slot(2) })).status).toBe(422); // not a tenant action
    expect((await cApi.owner((await makeStay2()).owner.token, a.id, { action: 'schedule', ...slot(2) })).status).toBe(404); // another owner
    await cApi.staff(a.staffer.token, a.id, { action: 'resolve', note: 'Done' });
    expect((await cApi.staff(a.staffer.token, a.id, { action: 'schedule', ...slot(2) })).status).toBe(409); // resolved: nothing left to visit
  });

  it('is cleared when the job goes back to the owner or to someone else', async () => {
    const a = await assigned();
    await cApi.staff(a.staffer.token, a.id, { action: 'schedule', ...slot(2) });
    expect((await cApi.owner(a.stay.owner.token, a.id, { action: 'unassign' })).body.data.visit).toBeNull();

    const b = await assigned();
    const second = await makeStaff(b.stay, { trade: 'PLUMBER', name: 'Second Plumber' });
    await cApi.staff(b.staffer.token, b.id, { action: 'schedule', ...slot(2) });
    const swapped = await cApi.owner(b.stay.owner.token, b.id, { action: 'assign', staffUserId: second.id });
    expect(swapped.body.data.visit).toBeNull();

    const c = await assigned();
    await cApi.staff(c.staffer.token, c.id, { action: 'schedule', ...slot(2) });
    await cApi.setStatus(c.stay.owner.token, c.staffer.id, 'INACTIVE'); // handing the job back
    expect((await cApi.get(c.stay.owner.token, c.id)).body.data).toMatchObject({ status: 'OPEN', visit: null });
  });
});

describe('changing the free time', () => {
  it('the tenant can change it; the booked visit stays if it still fits, otherwise it is dropped and staff are told', async () => {
    const a = await assigned(); // free +1h..+6h
    await cApi.staff(a.staffer.token, a.id, { action: 'schedule', ...slot(2, 1) });
    const fits = await cApi.tenant(a.tenant.token, a.id, { action: 'set_availability', ...freeWindow(1.5, 4), allowEntryIfAway: false });
    expect(fits.status).toBe(200);
    expect(fits.body.data.visit).not.toBeNull();
    expect(fits.body.data.availability.allowEntryIfAway).toBe(false);
    const away = await cApi.tenant(a.tenant.token, a.id, { action: 'set_availability', ...freeWindow(20, 3), allowEntryIfAway: true });
    expect(away.body.data.visit).toBeNull();
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: a.staffer.id, title: 'Tenant changed their free time' }, orderBy: { createdAt: 'desc' } });
    expect(note.body).toMatch(/book a new time/);
    expect(await prisma.auditLog.count({ where: { action: 'complaint.availability', entityId: a.id } })).toBe(2);
  });

  it('is validated like the first time, limited to the tenant, and closed once the complaint is resolved', async () => {
    const a = await assigned();
    const bad = await cApi.tenant(a.tenant.token, a.id, { action: 'set_availability', availableFrom: iso(Date.now() + 3 * HOUR), availableTo: iso(Date.now() + 2 * HOUR) });
    expect(bad.status).toBe(422);
    expect((await cApi.staff(a.staffer.token, a.id, { action: 'set_availability', ...freeWindow() })).status).toBe(422);
    expect((await cApi.tenant((await livingTenant()).tenant.token, a.id, { action: 'set_availability', ...freeWindow() })).status).toBe(404);
    await cApi.staff(a.staffer.token, a.id, { action: 'resolve', note: 'Done' });
    expect((await cApi.tenant(a.tenant.token, a.id, { action: 'set_availability', ...freeWindow() })).status).toBe(409);
  });

  it('a reopened complaint needs a fresh free time once the old one has passed, and loses the old visit', async () => {
    const a = await assigned();
    await cApi.staff(a.staffer.token, a.id, { action: 'schedule', ...slot(2) });
    await cApi.staff(a.staffer.token, a.id, { action: 'resolve', note: 'Done' });
    await prisma.complaint.update({ where: { id: a.id }, data: { availableFrom: new Date(Date.now() - 10 * HOUR), availableTo: new Date(Date.now() - 5 * HOUR) } }); // the old window has passed
    const without = await cApi.tenant(a.tenant.token, a.id, { action: 'reopen', reason: 'Still dripping' });
    expect(without.status).toBe(422);
    expect(JSON.stringify(without.body)).toMatch(/free for the second visit/);
    const re = await cApi.tenant(a.tenant.token, a.id, { action: 'reopen', reason: 'Still dripping', ...freeWindow(3, 3), allowEntryIfAway: true });
    expect(re.status).toBe(200);
    expect(re.body.data).toMatchObject({ status: 'REOPENED', visit: null });
    expect(re.body.data.availability.allowEntryIfAway).toBe(true);
  });

  it('a reopened complaint keeps a window that is still in the future', async () => {
    const a = await assigned();
    await cApi.staff(a.staffer.token, a.id, { action: 'resolve', note: 'Done' });
    const re = await cApi.tenant(a.tenant.token, a.id, { action: 'reopen', reason: 'Still dripping' });
    expect(re.status).toBe(200);
    expect(re.body.data.availability).toEqual(a.c.availability);
  });
});

describe('the visit reminder', () => {
  it('flags a visit that passed with the job still open, once, and a new booking starts the clock again', async () => {
    const a = await assigned();
    await cApi.staff(a.staffer.token, a.id, { action: 'schedule', ...slot(2) });
    const later = new Date(Date.now() + 6 * HOUR);
    expect((await sweepComplaints(later)).missedVisits).toBeGreaterThanOrEqual(1);
    expect((await sweepComplaints(later)).missedVisits).toBe(0); // once
    const title = `${a.c.code}: the booked visit has passed`;
    expect(await prisma.notification.count({ where: { userId: a.stay.owner.id, title } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: a.staffer.id, title: `${a.c.code}: your visit time has passed` } })).toBe(1);
    expect((await prisma.complaint.findUniqueOrThrow({ where: { id: a.id } })).visitMissedNotifiedAt).not.toBeNull();
  });

  it('does not nag when the job is resolved or the visit is still ahead', async () => {
    const a = await assigned();
    await cApi.staff(a.staffer.token, a.id, { action: 'schedule', ...slot(4) });
    await sweepComplaints(new Date(Date.now() + 2 * HOUR)); // visit not over yet
    expect(await prisma.notification.count({ where: { userId: a.stay.owner.id, title: `${a.c.code}: the booked visit has passed` } })).toBe(0);
    await cApi.staff(a.staffer.token, a.id, { action: 'resolve', note: 'Fixed on the visit' });
    await sweepComplaints(new Date(Date.now() + 9 * HOUR));
    expect(await prisma.notification.count({ where: { userId: a.stay.owner.id, title: `${a.c.code}: the booked visit has passed` } })).toBe(0);
  });
});

async function makeStay2() {
  const o = await makeUser({ roles: ['GUEST', 'OWNER'], kyc: 'APPROVED' });
  return { owner: o };
}
