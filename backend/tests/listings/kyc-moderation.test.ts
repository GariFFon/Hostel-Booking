import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloudinaryStorage, setMediaStorage } from '@/infra/cloudinary/storage';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { POST as signature } from '@/app/api/v1/uploads/signature/route';
import { GET as getProfile, PATCH as patchProfile } from '@/app/api/v1/owner/profile/route';
import { POST as addKycDoc } from '@/app/api/v1/owner/kyc/documents/route';
import { DELETE as removeKycDoc } from '@/app/api/v1/owner/kyc/documents/[id]/route';
import { POST as submitKyc } from '@/app/api/v1/owner/kyc/submit/route';
import { GET as adminKycList } from '@/app/api/v1/admin/kyc/route';
import { GET as adminKycGet } from '@/app/api/v1/admin/kyc/[ownerId]/route';
import { POST as kycApprove } from '@/app/api/v1/admin/kyc/[ownerId]/approve/route';
import { POST as kycReject } from '@/app/api/v1/admin/kyc/[ownerId]/reject/route';
import { PATCH as patchHostel } from '@/app/api/v1/owner/hostels/[id]/route';
import { POST as submitHostel } from '@/app/api/v1/owner/hostels/[id]/submit/route';
import { POST as withdrawHostel } from '@/app/api/v1/owner/hostels/[id]/withdraw/route';
import { GET as adminHostels } from '@/app/api/v1/admin/hostels/route';
import { GET as adminHostel } from '@/app/api/v1/admin/hostels/[id]/route';
import { POST as hostelApprove } from '@/app/api/v1/admin/hostels/[id]/approve/route';
import { POST as hostelReject } from '@/app/api/v1/admin/hostels/[id]/reject/route';
import { POST as hostelSuspend } from '@/app/api/v1/admin/hostels/[id]/suspend/route';
import { POST as hostelReinstate } from '@/app/api/v1/admin/hostels/[id]/reinstate/route';
import { GET as listAmenities } from '@/app/api/v1/amenities/route';
import { POST as createAmenity } from '@/app/api/v1/admin/amenities/route';
import { PATCH as patchAmenity, DELETE as deleteAmenity } from '@/app/api/v1/admin/amenities/[id]/route';
import { PUT as setAvatar } from '@/app/api/v1/me/avatar/route';
import { call } from '../helpers/http';
import { FakeStorage } from '../helpers/fake-storage';
import { attachPhoto, hostelPayload, makeHostel, makeRoom } from '../helpers/listings';
import { makeUser } from '../helpers/users';

const storage = new FakeStorage();
beforeAll(async () => {
  setMediaStorage(storage);
  await redis.flushdb();
});
afterAll(() => setMediaStorage(cloudinaryStorage));

const newOwner = () => makeUser({ roles: ['OWNER', 'GUEST'] });
const admin = () => makeUser({ roles: ['ADMIN'] });
const notifications = (userId: string) => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

async function uploadKycDoc(token: string, type = 'GOVERNMENT_ID') {
  const sig = await call(signature, { token, body: { purpose: 'KYC_DOCUMENT' } });
  const publicId = sig.body.data.publicId as string;
  storage.put(publicId, { type: 'authenticated', format: 'pdf' });
  return call(addKycDoc, { token, body: { type, publicId } });
}

describe('owner KYC', () => {
  it('walks NOT_SUBMITTED -> PENDING -> REJECTED -> edit -> PENDING -> APPROVED with notifications and audit', async () => {
    const o = await newOwner();
    const a = await admin();

    const initial = (await call(getProfile, { method: 'GET', token: o.token })).body.data;
    expect(initial).toMatchObject({ kycStatus: 'NOT_SUBMITTED', documents: [] });

    // incomplete submissions list what is missing
    const early = await call(submitKyc, { token: o.token });
    expect(early.status).toBe(422);
    expect(early.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['businessName', 'documents']);

    expect((await call(patchProfile, { method: 'PATCH', token: o.token, body: { gstin: 'NOT-A-GSTIN' } })).status).toBe(422);
    const prof = await call(patchProfile, { method: 'PATCH', token: o.token, body: { businessName: 'Blue Door Stays', gstin: '29abcde1234f1z5', panLast4: 'a1b2' } });
    expect(prof.body.data).toMatchObject({ businessName: 'Blue Door Stays', gstin: '29ABCDE1234F1Z5', panLast4: 'A1B2' }); // normalised

    // a public image is not a valid KYC document; only private (authenticated) uploads are
    const pub = await call(signature, { token: o.token, body: { purpose: 'KYC_DOCUMENT' } });
    storage.put(pub.body.data.publicId, { type: 'upload' });
    expect((await call(addKycDoc, { token: o.token, body: { type: 'GOVERNMENT_ID', publicId: pub.body.data.publicId } })).status).toBe(422);

    const added = await uploadKycDoc(o.token);
    expect(added.status).toBe(201);
    expect(added.body.data.documents).toHaveLength(1);
    expect(JSON.stringify(added.body.data)).not.toContain('publicId'); // storage ids never leave the server

    const sub = await call(submitKyc, { token: o.token });
    expect(sub.body.data.kycStatus).toBe('PENDING');
    expect((await call(patchProfile, { method: 'PATCH', token: o.token, body: { businessName: 'Changed while pending' } })).status).toBe(409);
    expect((await call(submitKyc, { token: o.token })).status).toBe(409);
    expect((await notifications(a.id)).some((n) => n.body.includes('Blue Door Stays'))).toBe(true);

    // reviewer sees it, with short-lived private links, and the view itself is audited
    const queue = await call(adminKycList, { method: 'GET', token: a.token });
    expect(queue.body.data.map((x: { ownerId: string }) => x.ownerId)).toContain(o.id);
    const detail = await call(adminKycGet, { method: 'GET', token: a.token, params: { ownerId: o.id } });
    expect(detail.body.data.documents[0].downloadUrl).toMatch(/ttl=600/);
    expect(detail.body.data).toMatchObject({ businessName: 'Blue Door Stays', email: o.email });
    expect(await prisma.auditLog.count({ where: { action: 'kyc.documents.view', entityId: o.id, actorId: a.id } })).toBe(1);

    expect((await call(kycReject, { token: a.token, params: { ownerId: o.id }, body: { reason: 'too short' } })).status).toBe(422);
    const rej = await call(kycReject, { token: a.token, params: { ownerId: o.id }, body: { reason: 'ID photo is blurry, please re-upload.' } });
    expect(rej.body.data.kycStatus).toBe('REJECTED');
    expect((await call(kycReject, { token: a.token, params: { ownerId: o.id }, body: { reason: 'Rejecting twice should fail' } })).status).toBe(409);
    const afterReject = (await call(getProfile, { method: 'GET', token: o.token })).body.data;
    expect(afterReject.rejectionReason).toMatch(/blurry/);
    expect((await notifications(o.id)).map((n) => n.type)).toContain('KYC_REJECTED');

    // owner fixes and resubmits
    const docId = afterReject.documents[0].id;
    expect((await call(removeKycDoc, { method: 'DELETE', token: o.token, params: { id: docId } })).status).toBe(200);
    expect(storage.destroyed.length).toBeGreaterThan(0);
    await uploadKycDoc(o.token);
    expect((await call(submitKyc, { token: o.token })).body.data.kycStatus).toBe('PENDING');

    const ok = await call(kycApprove, { token: a.token, params: { ownerId: o.id } });
    expect(ok.body.data.kycStatus).toBe('APPROVED');
    expect((await notifications(o.id)).map((n) => n.type)).toContain('KYC_APPROVED');
    expect((await call(patchProfile, { method: 'PATCH', token: o.token, body: { businessName: 'Post-approval edit' } })).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { entityId: o.id, action: { in: ['kyc.submit', 'kyc.reject', 'kyc.approve'] } } })).toBe(4);
  });

  it('is admin-only, and owners cannot see each other', async () => {
    const o = await newOwner();
    const guest = await makeUser();
    const a = await admin();
    expect((await call(adminKycList, { method: 'GET', token: o.token })).status).toBe(403);
    expect((await call(adminKycGet, { method: 'GET', token: o.token, params: { ownerId: o.id } })).status).toBe(403);
    expect((await call(kycApprove, { token: o.token, params: { ownerId: o.id } })).status).toBe(403);
    expect((await call(getProfile, { method: 'GET', token: guest.token })).status).toBe(403);
    expect((await call(adminKycGet, { method: 'GET', token: a.token, params: { ownerId: guest.id } })).status).toBe(404);
  });
});

describe('listing moderation', () => {
  async function readyOwner() {
    const o = await newOwner();
    const a = await admin();
    await uploadKycDoc(o.token);
    await call(patchProfile, { method: 'PATCH', token: o.token, body: { businessName: 'Ready Stays' } });
    await call(submitKyc, { token: o.token });
    await call(kycApprove, { token: a.token, params: { ownerId: o.id } });
    return { o, a };
  }
  async function readyHostel(token: string) {
    const h = await makeHostel(token, { name: `Mod Hostel ${Math.random().toString(36).slice(2, 7)}` });
    await makeRoom(token, h.id);
    for (let i = 0; i < 3; i++) await attachPhoto(token, h.id, storage);
    return h;
  }

  it('submit -> review -> approve, with the owner notified and the history visible to admins', async () => {
    const { o, a } = await readyOwner();
    const h = await readyHostel(o.token);

    const sub = await call(submitHostel, { token: o.token, params: { id: h.id } });
    expect(sub.body.data.status).toBe('PENDING_REVIEW');
    expect((await call(patchHostel, { method: 'PATCH', token: o.token, params: { id: h.id }, body: { name: 'Edit while pending' } })).status).toBe(409);
    expect((await notifications(a.id)).some((n) => n.title === 'Listing awaiting review' && JSON.stringify(n.data).includes(h.id))).toBe(true);

    const queue = await call(adminHostels, { method: 'GET', token: a.token });
    const entry = queue.body.data.find((x: { id: string }) => x.id === h.id);
    expect(entry).toMatchObject({ status: 'PENDING_REVIEW', mediaCount: 3, roomTypeCount: 1, owner: expect.objectContaining({ id: o.id }) });
    expect(entry.coverUrl).toContain('c_fill');

    const detail = (await call(adminHostel, { method: 'GET', token: a.token, params: { id: h.id } })).body.data;
    expect(detail.owner.ownerProfile.kycStatus).toBe('APPROVED');
    expect(detail.history.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(['hostel.submit', 'hostel.create']));

    const approved = await call(hostelApprove, { token: a.token, params: { id: h.id } });
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', rejectionReason: null });
    expect(approved.body.data.approvedAt).toBeTruthy();
    expect((await notifications(o.id)).map((n) => n.type)).toContain('HOSTEL_APPROVED');
    expect((await call(hostelApprove, { token: a.token, params: { id: h.id } })).status).toBe(409); // already approved
    expect((await call(hostelReject, { token: a.token, params: { id: h.id }, body: { reason: 'Rejecting an approved listing' } })).status).toBe(409);
    // approved listings stay editable by their owner (audited), and stay approved
    expect((await call(patchHostel, { method: 'PATCH', token: o.token, params: { id: h.id }, body: { description: 'Updated description for the approved listing.' } })).body.data.status).toBe('APPROVED');
  });

  it('reject (reason required) -> owner fixes -> resubmit; withdraw returns to draft', async () => {
    const { o, a } = await readyOwner();
    const h = await readyHostel(o.token);
    await call(submitHostel, { token: o.token, params: { id: h.id } });
    expect((await call(hostelReject, { token: a.token, params: { id: h.id }, body: {} })).status).toBe(422);
    const rej = await call(hostelReject, { token: a.token, params: { id: h.id }, body: { reason: 'Photos do not show the dorm rooms.' } });
    expect(rej.body.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'Photos do not show the dorm rooms.' });
    const note = (await notifications(o.id)).find((n) => n.type === 'HOSTEL_REJECTED');
    expect(note?.body).toContain('Photos do not show the dorm rooms.');

    expect((await call(patchHostel, { method: 'PATCH', token: o.token, params: { id: h.id }, body: { description: 'Now with better photos of the dorms.' } })).status).toBe(200);
    const again = await call(submitHostel, { token: o.token, params: { id: h.id } });
    expect(again.body.data).toMatchObject({ status: 'PENDING_REVIEW', rejectionReason: null });
    expect((await call(withdrawHostel, { token: o.token, params: { id: h.id } })).body.data.status).toBe('DRAFT');
    expect((await call(withdrawHostel, { token: o.token, params: { id: h.id } })).status).toBe(409); // draft cannot be withdrawn
  });

  it('suspend and reinstate; suspended listings cannot be edited by owners', async () => {
    const { o, a } = await readyOwner();
    const h = await readyHostel(o.token);
    await call(submitHostel, { token: o.token, params: { id: h.id } });
    await call(hostelApprove, { token: a.token, params: { id: h.id } });
    expect((await call(hostelSuspend, { token: a.token, params: { id: h.id }, body: { reason: 'Guest safety complaint under investigation' } })).body.data.status).toBe('SUSPENDED');
    const edit = await call(patchHostel, { method: 'PATCH', token: o.token, params: { id: h.id }, body: { name: 'Trying to edit' } });
    expect(edit.status).toBe(409);
    expect(edit.body.error.message).toMatch(/suspended/i);
    expect((await call(withdrawHostel, { token: o.token, params: { id: h.id } })).status).toBe(409);
    expect((await call(hostelReinstate, { token: a.token, params: { id: h.id } })).body.data.status).toBe('APPROVED');
    expect(await prisma.auditLog.count({ where: { entityId: h.id, action: { in: ['hostel.approve', 'hostel.suspend', 'hostel.reinstate'] } } })).toBe(3);
  });

  it('will not approve when the owner\'s KYC is not approved, and non-admins cannot moderate', async () => {
    const { o, a } = await readyOwner();
    const h = await readyHostel(o.token);
    await call(submitHostel, { token: o.token, params: { id: h.id } });
    await prisma.ownerProfile.update({ where: { userId: o.id }, data: { kycStatus: 'REJECTED' } });
    const res = await call(hostelApprove, { token: a.token, params: { id: h.id } });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/KYC/);
    expect((await call(hostelApprove, { token: o.token, params: { id: h.id } })).status).toBe(403);
    expect((await call(adminHostels, { method: 'GET', token: o.token })).status).toBe(403);
    expect((await call(hostelApprove, { token: a.token, params: { id: '00000000-0000-4000-8000-000000000000' } })).status).toBe(404);
  });

  it('submission is blocked until KYC is approved, even with a complete listing', async () => {
    const o = await newOwner();
    const h = await readyHostel(o.token);
    const res = await call(submitHostel, { token: o.token, params: { id: h.id } });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'kyc' })]);
  });
});

describe('amenities', () => {
  it('lists publicly; only admins manage; deletion is blocked while in use', async () => {
    const a = await admin();
    const o = await newOwner();
    const code = `AM_${Date.now()}`;
    expect((await call(createAmenity, { token: o.token, body: { code, label: 'Nope', category: 'FOOD' } })).status).toBe(403);
    expect((await call(createAmenity, { token: a.token, body: { code: 'bad code!', label: 'Bad', category: 'FOOD' } })).status).toBe(422);
    const created = await call(createAmenity, { token: a.token, body: { code: code.toLowerCase(), label: 'Hammocks', category: 'WELLNESS' } });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe(code); // normalised to upper case
    expect((await call(createAmenity, { token: a.token, body: { code, label: 'Dup', category: 'FOOD' } })).status).toBe(409);

    const pub = await call(listAmenities, { method: 'GET' }); // no token needed
    expect(pub.body.data.some((x: { code: string }) => x.code === code)).toBe(true);
    expect((await call(patchAmenity, { method: 'PATCH', token: a.token, params: { id: created.body.data.id }, body: { label: 'Hammock garden' } })).body.data.label).toBe('Hammock garden');

    await call((await import('@/app/api/v1/owner/hostels/route')).POST, { token: o.token, body: hostelPayload({ amenityCodes: [code] }) });
    const inUse = await call(deleteAmenity, { method: 'DELETE', token: a.token, params: { id: created.body.data.id } });
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.message).toMatch(/used by 1/);

    const spare = await call(createAmenity, { token: a.token, body: { code: `${code}_B`, label: 'Spare', category: 'FOOD' } });
    expect((await call(deleteAmenity, { method: 'DELETE', token: a.token, params: { id: spare.body.data.id } })).status).toBe(200);
  });
});

describe('avatar', () => {
  it('attaches a verified upload, removes the previous one, and refuses foreign assets', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const upload = async (token: string) => {
      const publicId = (await call(signature, { token, body: { purpose: 'AVATAR' } })).body.data.publicId as string;
      storage.put(publicId);
      return publicId;
    };
    const first = await upload(u.token);
    expect((await call(setAvatar, { method: 'PUT', token: u.token, body: { publicId: first } })).body.data.avatarUrl).toContain(first);
    const second = await upload(u.token);
    expect((await call(setAvatar, { method: 'PUT', token: u.token, body: { publicId: second } })).status).toBe(200);
    expect(storage.destroyed).toContain(first);

    const theirs = await upload(other.token);
    expect((await call(setAvatar, { method: 'PUT', token: u.token, body: { publicId: theirs } })).status).toBe(422);
    expect((await call(setAvatar, { method: 'PUT', token: u.token, body: { publicId: `${second}-missing` } })).status).toBe(422);
  });
});

describe('audit integrity after all listing activity', () => {
  it('hash chain is intact', async () => {
    expect(await prisma.$queryRaw<unknown[]>`SELECT * FROM audit_verify_chain(0)`).toHaveLength(0);
  });
});
