/* eslint-disable no-console */
// Live integration check against the real Cloudinary account in .env. Uploads a 1x1 PNG (public and private),
// verifies it the way the API does, then deletes everything it created.   Run: pnpm check:cloudinary
import { randomUUID } from 'node:crypto';
import { cloudinaryStorage, transformUrl, type DeliveryType } from '../src/infra/cloudinary/storage';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push([name, ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function upload(type: DeliveryType) {
  const publicId = `hostel-booking/_livecheck/${type}-${randomUUID()}`;
  const signed = cloudinaryStorage.signUpload({ publicId, type, allowedFormats: ['png', 'jpg'] });
  const form = new FormData();
  for (const [k, v] of Object.entries(signed.fields)) form.append(k, v);
  form.append('file', PNG);
  const res = await fetch(signed.uploadUrl, { method: 'POST', body: form });
  return { publicId, status: res.status, json: (await res.json()) as { error?: { message: string } } };
}

async function main() {
  const created: [string, DeliveryType][] = [];
  try {
    // 1. public image: signed upload, server-side verification, CDN variant
    const pub = await upload('upload');
    check('signed public upload accepted', pub.status === 200, pub.json.error?.message);
    created.push([pub.publicId, 'upload']);
    const found = await cloudinaryStorage.getResource(pub.publicId, 'upload');
    check('getResource reports format/bytes/size', found?.format === 'png' && (found.bytes ?? 0) > 0 && found.width === 1, JSON.stringify({ format: found?.format, bytes: found?.bytes }));
    const variant = found ? await fetch(transformUrl(found.secureUrl, 'c_fill,w_100,h_100,f_auto,q_auto')) : null;
    check('CDN transformation variant is served', variant?.status === 200, `HTTP ${variant?.status}`);
    check('missing asset reads as null (not an error)', (await cloudinaryStorage.getResource(`${pub.publicId}-nope`, 'upload')) === null);

    // 2. tampering: a client that alters a signed field must be refused
    const signed = cloudinaryStorage.signUpload({ publicId: `hostel-booking/_livecheck/tamper-${randomUUID()}`, type: 'upload', allowedFormats: ['png'] });
    const form = new FormData();
    for (const [k, v] of Object.entries({ ...signed.fields, public_id: `hostel-booking/_livecheck/other-${randomUUID()}` })) form.append(k, v);
    form.append('file', PNG);
    const tampered = await fetch(signed.uploadUrl, { method: 'POST', body: form });
    check('altered public_id fails signature check', tampered.status === 401 || tampered.status === 400, `HTTP ${tampered.status}`);

    // 3. private (KYC-style) upload: not publicly reachable, reachable via short-lived signed link
    const priv = await upload('authenticated');
    check('signed private upload accepted', priv.status === 200, priv.json.error?.message);
    created.push([priv.publicId, 'authenticated']);
    const privRes = await cloudinaryStorage.getResource(priv.publicId, 'authenticated');
    check('private asset verifiable by the server', privRes?.type === 'authenticated');
    const publicAttempt = await fetch(`https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${priv.publicId}.png`);
    check('private asset is NOT served from the public URL', publicAttempt.status !== 200, `HTTP ${publicAttempt.status}`);
    const dl = await fetch(cloudinaryStorage.privateDownloadUrl(priv.publicId, 'png', 60));
    check('private asset downloads via 60-second signed link', dl.status === 200, `HTTP ${dl.status}`);
  } finally {
    for (const [id, type] of created) await cloudinaryStorage.destroy(id, type).catch((e) => console.error('cleanup failed', id, e));
    const left = await Promise.all(created.map(([id, type]) => cloudinaryStorage.getResource(id, type)));
    check('test assets deleted', left.every((r) => r === null));
  }
  const failed = results.filter(([, ok]) => !ok);
  console.log(failed.length ? `\n${failed.length} check(s) FAILED` : `\nAll ${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main();
