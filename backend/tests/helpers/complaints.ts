import { prisma } from '@/infra/db/prisma';
import { POST as createRoute, GET as listMineRoute } from '@/app/api/v1/me/complaints/route';
import { POST as tenantActionRoute } from '@/app/api/v1/me/complaints/[id]/actions/route';
import { GET as detailRoute } from '@/app/api/v1/complaints/[id]/route';
import { POST as commentRoute } from '@/app/api/v1/complaints/[id]/comments/route';
import { POST as mediaRoute } from '@/app/api/v1/complaints/[id]/media/route';
import { GET as ownerListRoute } from '@/app/api/v1/owner/complaints/route';
import { POST as ownerActionRoute } from '@/app/api/v1/owner/complaints/[id]/actions/route';
import { GET as staffListRoute } from '@/app/api/v1/staff/complaints/route';
import { POST as staffActionRoute } from '@/app/api/v1/staff/complaints/[id]/actions/route';
import { GET as adminListRoute } from '@/app/api/v1/admin/complaints/route';
import { GET as staffMeRoute } from '@/app/api/v1/staff/me/route';
import { POST as acceptRoute } from '@/app/api/v1/staff-invites/accept/route';
import { GET as ownerStaffRoute } from '@/app/api/v1/owner/staff/route';
import { GET as vendorsRoute } from '@/app/api/v1/owner/staff/vendors/route';
import { POST as ownerInviteRoute } from '@/app/api/v1/owner/staff/invites/route';
import { DELETE as ownerCancelInviteRoute } from '@/app/api/v1/owner/staff/invites/[id]/route';
import { PUT as setHostelsRoute } from '@/app/api/v1/owner/staff/[id]/hostels/route';
import { POST as ownerStatusRoute } from '@/app/api/v1/owner/staff/[id]/status/route';
import { GET as adminStaffRoute } from '@/app/api/v1/admin/staff/route';
import { POST as adminInviteRoute } from '@/app/api/v1/admin/staff/invites/route';
import { DELETE as adminCancelInviteRoute } from '@/app/api/v1/admin/staff/invites/[id]/route';
import { POST as adminStatusRoute } from '@/app/api/v1/admin/staff/[id]/status/route';
import { POST as signatureRoute } from '@/app/api/v1/uploads/signature/route';
import { call } from './http';
import { makeUser } from './users';
import { api, approvedTenant, makeStay } from './tenancy';
import type { FakeStorage } from './fake-storage';

export const cApi = {
  create: (token: string, body: unknown) => call(createRoute, { token, body }),
  mine: (token: string, query = '') => call(listMineRoute, { method: 'GET', token, query }),
  tenant: (token: string, id: string, body: unknown) => call(tenantActionRoute, { token, params: { id }, body }),
  get: (token: string, id: string) => call(detailRoute, { method: 'GET', token, params: { id } }),
  comment: (token: string, id: string, body: unknown) => call(commentRoute, { token, params: { id }, body }),
  attach: (token: string, id: string, publicId: string) => call(mediaRoute, { token, params: { id }, body: { publicId } }),
  ownerList: (token: string, query = '') => call(ownerListRoute, { method: 'GET', token, query }),
  owner: (token: string, id: string, body: unknown) => call(ownerActionRoute, { token, params: { id }, body }),
  staffList: (token: string, query = '') => call(staffListRoute, { method: 'GET', token, query }),
  staff: (token: string, id: string, body: unknown) => call(staffActionRoute, { token, params: { id }, body }),
  adminList: (token: string, query = '') => call(adminListRoute, { method: 'GET', token, query }),
  staffMe: (token: string) => call(staffMeRoute, { method: 'GET', token }),
  accept: (token: string, inviteToken: string) => call(acceptRoute, { token, body: { token: inviteToken } }),
  team: (token: string) => call(ownerStaffRoute, { method: 'GET', token }),
  vendors: (token: string) => call(vendorsRoute, { method: 'GET', token }),
  invite: (token: string, body: unknown) => call(ownerInviteRoute, { token, body }),
  cancelInvite: (token: string, id: string) => call(ownerCancelInviteRoute, { method: 'DELETE', token, params: { id } }),
  setHostels: (token: string, staffId: string, hostelIds: string[]) => call(setHostelsRoute, { method: 'PUT', token, params: { id: staffId }, body: { hostelIds } }),
  setStatus: (token: string, staffId: string, status: string) => call(ownerStatusRoute, { token, params: { id: staffId }, body: { status } }),
  adminStaff: (token: string) => call(adminStaffRoute, { method: 'GET', token }),
  adminInvite: (token: string, body: unknown) => call(adminInviteRoute, { token, body }),
  adminCancelInvite: (token: string, id: string) => call(adminCancelInviteRoute, { method: 'DELETE', token, params: { id } }),
  adminStatus: (token: string, staffId: string, status: string) => call(adminStatusRoute, { token, params: { id: staffId }, body: { status } }),
  signature: (token: string, body: unknown) => call(signatureRoute, { token, body }),
};

const HOUR = 3_600_000;
/** A free-time window starting `startInHours` from now and lasting `hours`. */
export const freeWindow = (startInHours = 1, hours = 4, now = Date.now()) => ({ availableFrom: new Date(now + startInHours * HOUR).toISOString(), availableTo: new Date(now + (startInHours + hours) * HOUR).toISOString() });

export const complaintBody = (over: Record<string, unknown> = {}) => ({ category: 'PLUMBING', priority: 'MEDIUM', title: 'Tap is leaking', description: 'The tap in the bathroom has been dripping all night.', ...freeWindow(), ...over });

/** A moved-in tenant at a fresh long-term property. */
export async function livingTenant(opts: { stay?: Awaited<ReturnType<typeof makeStay>>; units?: number } = {}) {
  const stay = opts.stay ?? (await makeStay({ units: opts.units ?? 4 }));
  const { tenant, tenancyId } = await approvedTenant(stay, { depositPaise: 0 });
  const started = await api.activate(stay.owner.token, tenancyId);
  if (started.status !== 200) throw new Error(`activate failed: ${JSON.stringify(started.body)}`);
  return { stay, tenant, tenancyId };
}

/** A staff member created directly in the database (fast): the real invitation flow has its own tests. */
export async function makeStaff(stay: Awaited<ReturnType<typeof makeStay>>, opts: { trade?: string; hostelIds?: string[]; vendor?: boolean; status?: 'ACTIVE' | 'INACTIVE'; name?: string } = {}) {
  const user = await makeUser({ roles: ['STAFF', 'GUEST'], name: opts.name ?? 'Ravi Kumar' });
  await prisma.staffProfile.create({ data: { userId: user.id, trade: (opts.trade ?? 'PLUMBER') as never, ownerId: opts.vendor ? null : stay.owner.id, status: opts.status ?? 'ACTIVE' } });
  for (const hostelId of opts.hostelIds ?? [stay.hostel.id]) await prisma.staffAssignment.create({ data: { staffUserId: user.id, hostelId, assignedById: stay.owner.id } });
  return user;
}

/** Signs and "uploads" a complaint photo to the fake storage; returns its public id. */
export async function uploadPhoto(token: string, complaintId: string, storage: FakeStorage) {
  const sig = await cApi.signature(token, { purpose: 'COMPLAINT_IMAGE', complaintId });
  if (sig.status !== 200 && sig.status !== 201) throw new Error(`signature failed: ${JSON.stringify(sig.body)}`);
  const publicId = sig.body.data.publicId as string;
  storage.put(publicId);
  return publicId;
}
