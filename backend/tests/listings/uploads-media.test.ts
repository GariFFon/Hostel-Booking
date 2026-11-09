import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloudinaryStorage, setMediaStorage, transformUrl } from '@/infra/cloudinary/storage';
import { redis } from '@/infra/redis/redis';
import { POST as signature } from '@/app/api/v1/uploads/signature/route';
import { POST as addMedia, GET as listMedia } from '@/app/api/v1/owner/hostels/[id]/media/route';
import { PUT as reorder } from '@/app/api/v1/owner/hostels/[id]/media/order/route';
import { PATCH as patchMedia, DELETE as deleteMedia } from '@/app/api/v1/owner/media/[id]/route';
import { call } from '../helpers/http';
import { FakeStorage } from '../helpers/fake-storage';
import { attachPhoto, makeHostel } from '../helpers/listings';
import { makeUser } from '../helpers/users';

const storage = new FakeStorage();
beforeAll(async () => {
  setMediaStorage(storage);
  await redis.flushdb();
});
afterAll(() => setMediaStorage(cloudinaryStorage));

describe('upload signatures', () => {
  it('signs exactly the way Cloudinary verifies (sha1 over sorted params + secret) and never leaks the secret', () => {
    const s = cloudinaryStorage.signUpload({ publicId: 'folder/abc', type: 'upload', allowedFormats: ['jpg', 'png'] });
    const { signature: sig, api_key, ...params } = s.fields;
    const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
    expect(createHash('sha1').update(toSign + 'test_cloudinary_secret_value').digest('hex')).toBe(sig);
    expect(api_key).toBe('123456789012345');
    expect(params).toMatchObject({ public_id: 'folder/abc', type: 'upload', overwrite: 'false', allowed_formats: 'jpg,png' });
    expect(s.uploadUrl).toBe('https://api.cloudinary.com/v1_1/testcloud/image/upload');
    expect(JSON.stringify(s)).not.toContain('test_cloudinary_secret_value');
  });

  it('pins the public_id to the owner\'s hostel folder and reports limits', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'] });
    const hostel = await makeHostel(owner.token);
    const res = await call(signature, { token: owner.token, body: { purpose: 'HOSTEL_IMAGE', hostelId: hostel.id } });
    expect(res.status).toBe(200);
    expect(res.body.data.publicId).toMatch(new RegExp(`^hostel-booking/test/hostels/${hostel.id}/[0-9a-f-]{36}$`));
    expect(res.body.data).toMatchObject({ maxBytes: 10 * 1024 * 1024, allowedFormats: ['jpg', 'jpeg', 'png', 'webp'] });
  });

  it('refuses other people\'s hostels (404), guests for KYC (403), and missing hostelId (422)', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'] });
    const other = await makeUser({ roles: ['OWNER', 'GUEST'] });
    const guest = await makeUser();
    const hostel = await makeHostel(owner.token);
    expect((await call(signature, { token: other.token, body: { purpose: 'HOSTEL_IMAGE', hostelId: hostel.id } })).status).toBe(404);
    expect((await call(signature, { token: guest.token, body: { purpose: 'KYC_DOCUMENT' } })).status).toBe(403);
    expect((await call(signature, { token: owner.token, body: { purpose: 'HOSTEL_IMAGE' } })).status).toBe(422);
    expect((await call(signature, { body: { purpose: 'AVATAR' } })).status).toBe(401);
  });

  it('KYC documents are signed as private ("authenticated") uploads', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'] });
    const res = await call(signature, { token: owner.token, body: { purpose: 'KYC_DOCUMENT' } });
    expect(res.body.data.fields.type).toBe('authenticated');
    expect(res.body.data.allowedFormats).toContain('pdf');
  });
});

describe('photos', () => {
  it('first listing photo becomes the cover; variants come from the CDN transformation', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'] });
    const hostel = await makeHostel(owner.token);
    const first = await attachPhoto(owner.token, hostel.id, storage);
    const second = await attachPhoto(owner.token, hostel.id, storage);
    expect(first).toMatchObject({ isCover: true, sortOrder: 0 });
    expect(second).toMatchObject({ isCover: false, sortOrder: 1 });
    expect(first.cardUrl).toBe(transformUrl(first.url, 'c_fill,w_640,h_480,f_auto,q_auto'));
    expect(first.cardUrl).toContain('/upload/c_fill,w_640');
  });

  it('verifies the asset with the storage provider instead of trusting the client', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'] });
    const other = await makeUser({ roles: ['OWNER', 'GUEST'] });
    const hostel = await makeHostel(owner.token);
    const otherHostel = await makeHostel(other.token);

    const sig = (await call(signature, { token: owner.token, body: { purpose: 'HOSTEL_IMAGE', hostelId: hostel.id } })).body.data.publicId as string;
    // never uploaded
    expect((await call(addMedia, { token: owner.token, params: { id: hostel.id }, body: { publicId: sig } })).status).toBe(422);
    // an asset that lives in somebody else's folder
    const foreign = (await call(signature, { token: other.token, body: { purpose: 'HOSTEL_IMAGE', hostelId: otherHostel.id } })).body.data.publicId as string;
    storage.put(foreign);
    const stolen = await call(addMedia, { token: owner.token, params: { id: hostel.id }, body: { publicId: foreign } });
    expect(stolen.status).toBe(422);
    expect(stolen.body.error.details[0].message).toMatch(/does not belong/);
  });

  it('rejects and deletes disallowed formats and oversized files', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'] });
    const hostel = await makeHostel(owner.token);
    const gif = (await call(signature, { token: owner.token, body: { purpose: 'HOSTEL_IMAGE', hostelId: hostel.id } })).body.data.publicId as string;
    storage.put(gif, { format: 'gif' });
    expect((await call(addMedia, { token: owner.token, params: { id: hostel.id }, body: { publicId: gif } })).status).toBe(422);
    const big = (await call(signature, { token: owner.token, body: { purpose: 'HOSTEL_IMAGE', hostelId: hostel.id } })).body.data.publicId as string;
    storage.put(big, { bytes: 11 * 1024 * 1024 });
    expect((await call(addMedia, { token: owner.token, params: { id: hostel.id }, body: { publicId: big } })).status).toBe(422);
    expect(storage.destroyed).toEqual(expect.arrayContaining([gif, big]));
  });

  it('same photo cannot be attached twice; other owners cannot touch it', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'] });
    const other = await makeUser({ roles: ['OWNER', 'GUEST'] });
    const hostel = await makeHostel(owner.token);
    const photo = await attachPhoto(owner.token, hostel.id, storage);
    const stored = [...storage.assets.values()].find((a) => a.secureUrl === photo.url)!;
    const again = await call(addMedia, { token: owner.token, params: { id: hostel.id }, body: { publicId: stored.publicId } });
    expect(again.status).toBe(409);
    expect((await call(patchMedia, { method: 'PATCH', token: other.token, params: { id: photo.id }, body: { altText: 'x' } })).status).toBe(404);
    expect((await call(deleteMedia, { method: 'DELETE', token: other.token, params: { id: photo.id } })).status).toBe(404);
    expect((await call(patchMedia, { method: 'PATCH', token: owner.token, params: { id: photo.id }, body: { altText: 'Rooftop at dusk' } })).body.data.altText).toBe('Rooftop at dusk');
  });

  it('reorders, changes the cover, and promotes the next photo when the cover is deleted', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'] });
    const hostel = await makeHostel(owner.token);
    const a = await attachPhoto(owner.token, hostel.id, storage);
    const b = await attachPhoto(owner.token, hostel.id, storage);
    const c = await attachPhoto(owner.token, hostel.id, storage);

    expect((await call(reorder, { method: 'PUT', token: owner.token, params: { id: hostel.id }, body: { ids: [a.id, b.id] } })).status).toBe(422); // must list all
    const re = await call(reorder, { method: 'PUT', token: owner.token, params: { id: hostel.id }, body: { ids: [c.id, a.id, b.id] } });
    expect(re.body.data.map((m: { id: string }) => m.id)).toEqual([c.id, a.id, b.id]);

    await call(patchMedia, { method: 'PATCH', token: owner.token, params: { id: b.id }, body: { isCover: true } });
    let list = (await call(listMedia, { method: 'GET', token: owner.token, params: { id: hostel.id } })).body.data;
    expect(list.filter((m: { isCover: boolean }) => m.isCover).map((m: { id: string }) => m.id)).toEqual([b.id]);

    expect((await call(deleteMedia, { method: 'DELETE', token: owner.token, params: { id: b.id } })).status).toBe(200);
    list = (await call(listMedia, { method: 'GET', token: owner.token, params: { id: hostel.id } })).body.data;
    expect(list).toHaveLength(2);
    expect(list.filter((m: { isCover: boolean }) => m.isCover)).toHaveLength(1); // someone was promoted
  });

  it('caps a listing at 20 photos', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'] });
    const hostel = await makeHostel(owner.token);
    for (let i = 0; i < 20; i++) await attachPhoto(owner.token, hostel.id, storage);
    const res = await call(signature, { token: owner.token, body: { purpose: 'HOSTEL_IMAGE', hostelId: hostel.id } });
    expect(res.status).toBe(409);
  });
});
