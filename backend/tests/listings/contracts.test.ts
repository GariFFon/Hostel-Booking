import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { cloudinaryStorage, setMediaStorage } from '@/infra/cloudinary/storage';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { GET as getHostel } from '@/app/api/v1/owner/hostels/[id]/route';
import { GET as listHostels } from '@/app/api/v1/owner/hostels/route';
import { GET as getRoom } from '@/app/api/v1/owner/room-types/[id]/route';
import { GET as calendar } from '@/app/api/v1/owner/room-types/[id]/calendar/route';
import { POST as createRule } from '@/app/api/v1/owner/room-types/[id]/price-rules/route';
import { POST as signature } from '@/app/api/v1/uploads/signature/route';
import { GET as getProfile } from '@/app/api/v1/owner/profile/route';
import { GET as adminHostels } from '@/app/api/v1/admin/hostels/route';
import { GET as adminHostel } from '@/app/api/v1/admin/hostels/[id]/route';
import { GET as adminKycGet } from '@/app/api/v1/admin/kyc/[ownerId]/route';
import { GET as adminKycList } from '@/app/api/v1/admin/kyc/route';
import { POST as submitKyc } from '@/app/api/v1/owner/kyc/submit/route';
import { POST as addKycDoc } from '@/app/api/v1/owner/kyc/documents/route';
import { PATCH as patchProfile } from '@/app/api/v1/owner/profile/route';
import { buildOpenApiDocument } from '@/core/openapi/registry';
import { todayIn, addDays } from '@/core/dates';
import { call } from '../helpers/http';
import { FakeStorage } from '../helpers/fake-storage';
import { attachPhoto, makeHostel, makeRoom } from '../helpers/listings';
import { makeUser } from '../helpers/users';
import {
  adminHostelDetailSchema, adminHostelListItemSchema, adminKycListItemSchema, adminKycSchema, calendarNightSchema, hostelDtoSchema,
  hostelSummarySchema, mediaDtoSchema, ownerKycSchema, priceRuleDtoSchema, roomTypeDtoSchema,
} from '@/modules/listings.dto';
import { signatureResponseSchema } from '@/modules/uploads/uploads.schema';

const storage = new FakeStorage();
beforeAll(async () => {
  setMediaStorage(storage);
  await redis.flushdb();
});
afterAll(() => setMediaStorage(cloudinaryStorage));

/** Fails with the exact zod issues (path + message) so contract drift is easy to read. */
const valid = (schema: { safeParse: (v: unknown) => { error?: { issues: unknown[] } } }, value: unknown) => expect(schema.safeParse(value).error?.issues ?? []).toEqual([]);

describe('API responses match the published OpenAPI response schemas', () => {
  it('owner and admin listing endpoints', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'] });
    const admin = await makeUser({ roles: ['ADMIN'] });
    const hostel = await makeHostel(owner.token);
    const room = await makeRoom(owner.token, hostel.id);
    const photo = await attachPhoto(owner.token, hostel.id, storage);
    const rule = await call(createRule, { token: owner.token, params: { id: room.id }, body: { type: 'WEEKEND', weekdays: [6], adjustmentBps: 1000 } });
    const today = todayIn('Asia/Kolkata');

    valid(mediaDtoSchema, photo);
    valid(priceRuleDtoSchema, rule.body.data);
    valid(hostelDtoSchema, (await call(getHostel, { method: 'GET', token: owner.token, params: { id: hostel.id } })).body.data);
    valid(roomTypeDtoSchema, (await call(getRoom, { method: 'GET', token: owner.token, params: { id: room.id } })).body.data);
    for (const h of (await call(listHostels, { method: 'GET', token: owner.token })).body.data) valid(hostelSummarySchema, h);
    for (const n of (await call(calendar, { method: 'GET', token: owner.token, params: { id: room.id }, query: `?from=${today}&to=${addDays(today, 3)}` })).body.data) valid(calendarNightSchema, n);
    valid(signatureResponseSchema, (await call(signature, { token: owner.token, body: { purpose: 'AVATAR' } })).body.data);

    await call(patchProfile, { method: 'PATCH', token: owner.token, body: { businessName: 'Contract Stays' } });
    const kycId = (await call(signature, { token: owner.token, body: { purpose: 'KYC_DOCUMENT' } })).body.data.publicId;
    storage.put(kycId, { type: 'authenticated', format: 'pdf' });
    await call(addKycDoc, { token: owner.token, body: { type: 'GOVERNMENT_ID', publicId: kycId } });
    valid(ownerKycSchema, (await call(getProfile, { method: 'GET', token: owner.token })).body.data);
    await call(submitKyc, { token: owner.token });
    for (const k of (await call(adminKycList, { method: 'GET', token: admin.token, query: '?limit=50' })).body.data) valid(adminKycListItemSchema, k);
    valid(adminKycSchema, (await call(adminKycGet, { method: 'GET', token: admin.token, params: { ownerId: owner.id } })).body.data);

    await prisma.hostel.update({ where: { id: hostel.id }, data: { status: 'PENDING_REVIEW' } });
    for (const h of (await call(adminHostels, { method: 'GET', token: admin.token, query: '?limit=50' })).body.data) valid(adminHostelListItemSchema, h);
    valid(adminHostelDetailSchema, (await call(adminHostel, { method: 'GET', token: admin.token, params: { id: hostel.id } })).body.data);
  });

  it('the generated OpenAPI document covers every route group and resolves all refs', async () => {
    const doc = await buildOpenApiDocument();
    const paths = Object.keys(doc.paths ?? {});
    expect(paths.length).toBeGreaterThanOrEqual(78);
    expect(paths).toEqual(expect.arrayContaining(['/owner/hostels/{id}/room-types', '/admin/kyc/{ownerId}/approve', '/uploads/signature', '/auth/refresh', '/hostels', '/hostels/{idOrSlug}/availability', '/quotes', '/geo/search', '/bookings', '/bookings/{id}/payments', '/payments/webhooks/demo', '/owner/earnings', '/admin/audit-logs/verify']));
    const text = JSON.stringify(doc);
    const refs = [...text.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]!);
    const defined = new Set(Object.keys(doc.components?.schemas ?? {}));
    expect(refs.filter((r) => !defined.has(r))).toEqual([]);
  });
});
