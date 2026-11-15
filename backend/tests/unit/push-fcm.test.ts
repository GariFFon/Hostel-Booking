import { generateKeyPairSync, createVerify } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPush, setPushDriver, setServiceAccount } from '@/infra/push/push';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const msg = { token: 'tok-123456789012345678', title: 'Rent due', body: 'INV-1', data: { type: 'RENT_DUE_SOON', invoiceId: 'i1' } };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let calls: { url: string; init: RequestInit }[] = [];
function fakeGoogle(sendResponse: () => Response) {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes('oauth2.googleapis.com')) return json(200, { access_token: 'ya29.fake', expires_in: 3600 });
    return sendResponse();
  });
}

beforeEach(() => {
  setPushDriver('fcm');
  setServiceAccount({ project_id: 'demo-project', client_email: 'push@demo-project.iam.gserviceaccount.com', private_key: privateKey });
});
afterEach(() => {
  setPushDriver(null);
  setServiceAccount(null);
  vi.unstubAllGlobals();
});

describe('sending through Firebase Cloud Messaging', () => {
  it('signs a valid Google token request, then posts the message to the project', async () => {
    fakeGoogle(() => json(200, { name: 'projects/demo-project/messages/1' }));
    expect(await sendPush(msg)).toBe('sent');
    const tokenCall = calls[0]!;
    const assertion = new URLSearchParams(tokenCall.init.body as string).get('assertion')!;
    const [h, c, sig] = assertion.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString());
    expect(claims).toMatchObject({ iss: 'push@demo-project.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token' });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, sig!, 'base64url')).toBe(true); // really signed by the key

    const send = calls[1]!;
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/demo-project/messages:send');
    expect((send.init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.fake');
    expect(JSON.parse(send.init.body as string).message).toMatchObject({ token: msg.token, notification: { title: 'Rent due', body: 'INV-1' }, data: msg.data });
  });

  it('reuses the Google access token between pushes', async () => {
    fakeGoogle(() => json(200, {}));
    await sendPush(msg);
    await sendPush(msg);
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
  });

  it.each([
    ['an unregistered token', 404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }, 'dead'],
    ['a malformed token', 400, { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } }, 'dead'],
    ['a bad message (not the token\'s fault)', 400, { error: { status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload' } }, 'failed'],
    ['Google being down', 503, { error: { status: 'UNAVAILABLE' } }, 'failed'],
  ])('classifies %s', async (_n, status, body, expected) => {
    fakeGoogle(() => json(status, body));
    expect(await sendPush(msg)).toBe(expected);
  });

  it('never throws: a network failure, or a missing key, is a plain "failed"', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    expect(await sendPush(msg)).toBe('failed');
    setServiceAccount(null); // no key configured and none in the environment
    expect(await sendPush(msg)).toBe('failed');
  });

  it('the off driver sends nothing and reports a failure', async () => {
    setPushDriver('off');
    fakeGoogle(() => json(200, {}));
    expect(await sendPush(msg)).toBe('failed');
    expect(calls).toHaveLength(0);
  });
});
