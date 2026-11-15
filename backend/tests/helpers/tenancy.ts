import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { outbox } from '@/infra/mail/mailer';
import { POST as applyRoute } from '@/app/api/v1/hostels/[idOrSlug]/tenancy-applications/route';
import { GET as termsRoute } from '@/app/api/v1/hostels/[idOrSlug]/tenancy-terms/route';
import { GET as myApps } from '@/app/api/v1/me/tenancy-applications/route';
import { POST as withdrawRoute } from '@/app/api/v1/me/tenancy-applications/[id]/withdraw/route';
import { GET as myTenancies } from '@/app/api/v1/me/tenancies/route';
import { GET as myTenancy } from '@/app/api/v1/me/tenancies/[id]/route';
import { POST as acceptRoute } from '@/app/api/v1/me/tenancies/[id]/accept/route';
import { POST as declineRoute } from '@/app/api/v1/me/tenancies/[id]/decline/route';
import { POST as acceptTokenRoute } from '@/app/api/v1/me/tenancy-invites/accept/route';
import { GET as ownerApps } from '@/app/api/v1/owner/tenancy-applications/route';
import { GET as ownerApp } from '@/app/api/v1/owner/tenancy-applications/[id]/route';
import { POST as approveRoute } from '@/app/api/v1/owner/tenancy-applications/[id]/approve/route';
import { POST as rejectRoute } from '@/app/api/v1/owner/tenancy-applications/[id]/reject/route';
import { GET as ownerTenancies, POST as createTenancyRoute } from '@/app/api/v1/owner/tenancies/route';
import { GET as ownerTenancy, PATCH as patchTenancyRoute } from '@/app/api/v1/owner/tenancies/[id]/route';
import { POST as depositRoute } from '@/app/api/v1/owner/tenancies/[id]/deposit/route';
import { POST as activateRoute } from '@/app/api/v1/owner/tenancies/[id]/activate/route';
import { POST as cancelRoute } from '@/app/api/v1/owner/tenancies/[id]/cancel/route';
import { GET as ownerTerms, PATCH as patchTerms } from '@/app/api/v1/owner/hostels/[id]/tenancy-terms/route';
import { GET as adminTenancies } from '@/app/api/v1/admin/tenancies/route';
import { call } from './http';
import { TODAY, publish, type RoomSpec } from './publish';
import { makeUser } from './users';

/** A live long-term property with physical units, owned by a KYC-approved owner. */
export async function makeStay(over: { city?: string; propertyType?: 'PG' | 'HOSTEL'; units?: number; genderPolicy?: 'MIXED' | 'MALE_ONLY' | 'FEMALE_ONLY'; room?: RoomSpec } = {}) {
  const owner = await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' });
  const units = over.units ?? 3;
  const pub = await publish({ ownerId: owner.id, city: over.city, propertyType: over.propertyType ?? 'PG', genderPolicy: over.genderPolicy, rooms: [{ price: 600000, units, priceUnit: 'MONTH', maxStay: 365, ...over.room }] });
  const room = pub.rooms[0]!;
  await prisma.roomUnit.createMany({ data: Array.from({ length: units }, (_, i) => ({ roomTypeId: room.id, label: `B-${i + 1}`, floor: 1 })) });
  return { owner, hostel: pub.hostel, room };
}

export const student = (over: { verified?: boolean; name?: string } = {}) => makeUser({ roles: ['GUEST'], ...over });

export const applyBody = (roomTypeId: string, over: Record<string, unknown> = {}) => ({
  roomTypeId, moveInDate: addDays(TODAY, 10), tenureMonths: 11, gender: 'FEMALE', occupation: 'Student', message: 'Hi, I study nearby.',
  emergencyContactName: 'Asha Rao', emergencyContactPhone: '+919876543210', ...over,
});

export const api = {
  terms: (idOrSlug: string) => call(termsRoute, { method: 'GET', params: { idOrSlug } }),
  apply: (token: string, hostelId: string, body: unknown) => call(applyRoute, { token, params: { idOrSlug: hostelId }, body }),
  myApps: (token: string, query = '') => call(myApps, { method: 'GET', token, query }),
  withdraw: (token: string, id: string) => call(withdrawRoute, { token, params: { id } }),
  myTenancies: (token: string, query = '') => call(myTenancies, { method: 'GET', token, query }),
  myTenancy: (token: string, id: string) => call(myTenancy, { method: 'GET', token, params: { id } }),
  accept: (token: string, id: string) => call(acceptRoute, { token, params: { id } }),
  decline: (token: string, id: string) => call(declineRoute, { token, params: { id } }),
  acceptToken: (token: string, inviteToken: string) => call(acceptTokenRoute, { token, body: { token: inviteToken } }),
  ownerApps: (token: string, query = '') => call(ownerApps, { method: 'GET', token, query }),
  ownerApp: (token: string, id: string) => call(ownerApp, { method: 'GET', token, params: { id } }),
  approve: (token: string, id: string, body: unknown = {}) => call(approveRoute, { token, params: { id }, body }),
  reject: (token: string, id: string, body: unknown = { reason: 'No room for you' }) => call(rejectRoute, { token, params: { id }, body }),
  ownerTenancies: (token: string, query = '') => call(ownerTenancies, { method: 'GET', token, query }),
  createTenancy: (token: string, body: unknown) => call(createTenancyRoute, { token, body }),
  ownerTenancy: (token: string, id: string) => call(ownerTenancy, { method: 'GET', token, params: { id } }),
  patchTenancy: (token: string, id: string, body: unknown) => call(patchTenancyRoute, { method: 'PATCH', token, params: { id }, body }),
  deposit: (token: string, id: string, body: unknown = { method: 'CASH' }) => call(depositRoute, { token, params: { id }, body }),
  activate: (token: string, id: string) => call(activateRoute, { token, params: { id }, body: undefined }),
  cancel: (token: string, id: string, body: unknown = { reason: 'Changed plans' }) => call(cancelRoute, { token, params: { id }, body }),
  ownerTerms: (token: string, hostelId: string) => call(ownerTerms, { method: 'GET', token, params: { id: hostelId } }),
  patchTerms: (token: string, hostelId: string, body: unknown) => call(patchTerms, { method: 'PATCH', token, params: { id: hostelId }, body }),
  adminTenancies: (token: string, query = '') => call(adminTenancies, { method: 'GET', token, query }),
};

/** Applies and gets approved; returns the new tenancy (PENDING_MOVE_IN). */
export async function approvedTenant(stay: Awaited<ReturnType<typeof makeStay>>, body: Record<string, unknown> = {}) {
  const tenant = await student();
  const app = await api.apply(tenant.token, stay.hostel.id, applyBody(stay.room.id));
  if (app.status !== 201) throw new Error(`apply failed: ${JSON.stringify(app.body)}`);
  const approved = await api.approve(stay.owner.token, app.body.data.id, body);
  if (approved.status !== 200) throw new Error(`approve failed: ${JSON.stringify(approved.body)}`);
  const tenancy = (await api.myTenancies(tenant.token)).body.data[0] as { id: string };
  return { tenant, tenancyId: tenancy.id, applicationId: app.body.data.id as string };
}

/** The most recent mail to an address (the `log` mail driver keeps an outbox). */
export const lastMailTo = (email: string) => [...outbox].reverse().find((m) => m.to === email);
export const inviteTokenFrom = (html: string) => decodeURIComponent(/invite=([^"&\s<]+)/.exec(html)?.[1] ?? '');
