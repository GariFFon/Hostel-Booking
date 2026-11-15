import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiDebugEnabled, logApiRequest, logApiResponse, maskDeep, readRequestForLog } from '@/core/http/debug-log';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('api debug log', () => {
  it('is on only in development and can be switched off', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(apiDebugEnabled()).toBe(true);
    vi.stubEnv('API_DEBUG_LOG', 'false');
    expect(apiDebugEnabled()).toBe(false);
    vi.stubEnv('API_DEBUG_LOG', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(apiDebugEnabled()).toBe(false);
    vi.stubEnv('NODE_ENV', 'test');
    expect(apiDebugEnabled()).toBe(false);
  });

  it('masks secrets at any depth', () => {
    expect(maskDeep({ a: { password: 'x', list: [{ refreshToken: 'y', code: 'OK' }] } })).toEqual({ a: { password: '[MASKED]', list: [{ refreshToken: '[MASKED]', code: 'OK' }] } });
  });

  it('logs the real request and response under one id without leaking secrets, and leaves the body readable', async () => {
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => { out += String(c); return true; });
    const req = new Request('http://api.test/api/v1/auth/login?x=1', {
      method: 'POST', headers: { authorization: 'Bearer abc', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', password: 'hunter2' }),
    });
    const url = new URL(req.url);
    const body = await readRequestForLog(req);
    logApiRequest({ id: 'rid-1', req, url, body });
    expect(await req.json()).toEqual({ email: 'a@b.c', password: 'hunter2' }); // the handler can still read it
    const res = new Response(JSON.stringify({ error: { code: 'VALIDATION_FAILED' }, data: { accessToken: 'secret-at' } }), { status: 422, headers: { 'content-type': 'application/json' } });
    await logApiResponse({ id: 'rid-1', req, url, res, ms: 12 });
    expect(await res.json()).toBeTruthy(); // and so can the caller
    expect(out).toContain('POST /api/v1/auth/login');
    expect(out).toContain('VALIDATION_FAILED');
    expect(out).toContain('a@b.c');
    for (const secret of ['hunter2', 'secret-at', 'Bearer abc']) expect(out).not.toContain(secret);
    expect(out.split('#rid-1').length).toBe(3);
  });
});
