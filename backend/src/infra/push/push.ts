import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { env } from '@/core/config/env';
import { logger } from '@/core/logger/logger';

/** One push to one phone. `data` values are strings (an FCM rule); the phone uses them to open the right screen. */
export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

/** `sent`: delivered to Google. `dead`: the token is no longer valid, forget it. `failed`: a temporary problem. */
export type PushResult = 'sent' | 'dead' | 'failed';

/** In-memory record used by the `log` driver (tests). */
export const pushOutbox: PushMessage[] = [];
/** Tests can make the `log` driver report a result for given tokens. */
export const pushResults = new Map<string, PushResult>();

type Driver = 'off' | 'log' | 'fcm';
let override: Driver | null = null;
const driver = (): Driver => override ?? env().PUSH_DRIVER;
/** Test seam. */
export function setPushDriver(d: Driver | null) {
  override = d;
}
export const pushEnabled = () => driver() !== 'off';

export interface ServiceAccount { project_id: string; client_email: string; private_key: string }
let account: ServiceAccount | undefined;
let cached: { token: string; expiresAt: number } | undefined;
function serviceAccount(): ServiceAccount {
  if (account) return account;
  const e = env();
  const raw = e.FCM_SERVICE_ACCOUNT_JSON.trim() || (e.FCM_SERVICE_ACCOUNT_FILE ? readFileSync(e.FCM_SERVICE_ACCOUNT_FILE, 'utf8') : '');
  if (!raw) throw new Error('PUSH_DRIVER=fcm needs FCM_SERVICE_ACCOUNT_JSON or FCM_SERVICE_ACCOUNT_FILE');
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) throw new Error('the Firebase service-account key is missing project_id, client_email or private_key');
  account = { project_id: parsed.project_id, client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, '\n') };
  return account;
}

/** Test seam: use this key (or forget it) instead of reading the environment. */
export function setServiceAccount(a: ServiceAccount | null) {
  account = a ?? undefined;
  cached = undefined;
}

const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** A Google access token for the Firebase messaging scope, signed with the service-account key (no extra library needed). */
async function accessToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt - 60_000 > now) return cached.token;
  const a = serviceAccount();
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(a.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`google token ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, expiresAt: now + j.expires_in * 1000 };
  return j.access_token;
}

/** Sends one push. Never throws: a push outage must not break anything else. */
export async function sendPush(m: PushMessage): Promise<PushResult> {
  try {
    const d = driver();
    if (d === 'off') return 'failed';
    if (d === 'log') {
      pushOutbox.push(m);
      return pushResults.get(m.token) ?? 'sent';
    }
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount().project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { token: m.token, notification: { title: m.title, body: m.body }, data: m.data, android: { priority: 'HIGH', notification: { sound: 'default' } } },
      }),
    });
    if (res.ok) return 'sent';
    const text = await res.text();
    // 404 UNREGISTERED (app uninstalled / token rotated) and 400 INVALID_ARGUMENT (a malformed token) will never work again.
    if (res.status === 404 || (res.status === 400 && /INVALID_ARGUMENT/.test(text) && /token/i.test(text))) return 'dead';
    if (res.status === 401) cached = undefined; // refresh the access token next time
    logger.error({ status: res.status, body: text.slice(0, 300) }, 'push send failed');
    return 'failed';
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'push send failed');
    return 'failed';
  }
}
