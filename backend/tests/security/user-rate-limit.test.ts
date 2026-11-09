import { beforeAll, describe, expect, it } from 'vitest';
import { redis } from '@/infra/redis/redis';
import { USER_LIMITS } from '@/core/auth/authenticate';
import { GET as me, PATCH as patchMe } from '@/app/api/v1/me/route';
import { GET as health } from '@/app/api/v1/health/route';
import { call } from '../helpers/http';
import { makeGuest } from '../helpers/booking';

beforeAll(async () => {
  await redis.flushdb();
});

describe('default per-user ceiling', () => {
  it('stops a user who hammers writes, with a Retry-After, without affecting anyone else', async () => {
    const [a, b] = await Promise.all([makeGuest(), makeGuest()]);
    const results = await Promise.all(Array.from({ length: USER_LIMITS.write.limit + 15 }, () => call(patchMe, { token: a.token, method: 'PATCH', body: { fullName: 'Asha Rao' } })));
    const limited = results.filter((r) => r.status === 429);
    expect(limited.length).toBe(15);
    expect(limited[0]!.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited[0]!.headers.get('retry-after') ?? limited[0]!.body.error.details?.retryAfterSeconds)).toBeGreaterThan(0);
    // another user is unaffected, and so are reads by the throttled user (separate bucket)
    expect((await call(patchMe, { token: b.token, method: 'PATCH', body: { fullName: 'Ben' } })).status).toBe(200);
    expect((await call(me, { token: a.token, method: 'GET' })).status).toBe(200);
  });

  it('public, anonymous endpoints are not counted against any user', async () => {
    expect((await call(health, { method: 'GET' })).status).toBe(200);
  });
});

describe('request id header', () => {
  it('echoes a plain correlation id and replaces anything odd', async () => {
    const g = await makeGuest();
    const good = await call(me, { token: g.token, method: 'GET', headers: { 'x-request-id': 'trace-abc_123.9' } });
    expect(good.headers.get('x-request-id')).toBe('trace-abc_123.9');
    const odd = await call(me, { token: g.token, method: 'GET', headers: { 'x-request-id': 'bad id with spaces "quotes"' } });
    expect(odd.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
