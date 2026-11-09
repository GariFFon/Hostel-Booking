import { describe, expect, it } from 'vitest';
import { call } from '../helpers/http';

/**
 * Safety net for new routes: every route file under /api/v1 must refuse an anonymous caller (401) unless it is on the explicit
 * public list below. Adding a public route means adding it here on purpose; forgetting to guard one fails this test.
 */
const PUBLIC: Record<string, string[] | '*'> = {
  'auth/register': ['POST'],
  'auth/login': ['POST'],
  'auth/refresh': ['POST'],
  'auth/logout': ['POST'], // authorised by possession of the refresh token itself
  'auth/forgot-password': ['POST'],
  'auth/reset-password': ['POST'],
  'auth/verify-email': ['POST'],
  'auth/resend-verification': ['POST'],
  'auth/google': ['POST'],
  amenities: ['GET'],
  cities: ['GET'],
  'geo/search': ['GET'],
  'geo/reverse': ['GET'],
  health: ['GET'],
  'health/ready': ['GET'],
  'openapi.json': '*',
  hostels: ['GET'],
  'hostels/map': ['GET'],
  'hostels/[idOrSlug]': ['GET'],
  'hostels/[idOrSlug]/availability': ['GET'],
  'hostels/[idOrSlug]/calendar': ['GET'],
  'hostels/[idOrSlug]/offers': ['GET'],
  'hostels/[idOrSlug]/reviews': ['GET'],
  'hostels/[idOrSlug]/reviews/summary': ['GET'],
  'payments/webhooks/demo': ['POST'], // authorised by the HMAC signature
  quotes: ['POST'], // optional auth
  'search/suggest': ['GET'],
};

const modules = import.meta.glob('/src/app/api/v1/**/route.ts');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const UUID = '00000000-0000-4000-8000-000000000000';

const routes = Object.keys(modules)
  .map((file) => ({ file, route: file.replace('/src/app/api/v1/', '').replace(/\/route\.ts$/, '') }))
  .sort((a, b) => a.route.localeCompare(b.route));

describe('route inventory', () => {
  it('finds the API surface (guards against the glob silently matching nothing)', () => {
    expect(routes.length).toBeGreaterThan(90);
  });

  it('every public route on the allowlist still exists (no stale entries)', () => {
    const existing = new Set(routes.map((r) => r.route));
    expect(Object.keys(PUBLIC).filter((p) => !existing.has(p))).toEqual([]);
  });
});

describe('anonymous callers are refused everywhere except the public allowlist', () => {
  for (const { file, route } of routes) {
    it(route, async () => {
      const mod = (await modules[file]!()) as Record<string, unknown>;
      const params = Object.fromEntries([...route.matchAll(/\[(\w+)\]/g)].map((m) => [m[1]!, UUID]));
      const allowed = PUBLIC[route];
      for (const method of METHODS) {
        const handler = mod[method];
        if (typeof handler !== 'function') continue;
        if (allowed === '*' || allowed?.includes(method)) continue;
        const res = await call(handler, { method, params, ...(method === 'GET' || method === 'DELETE' ? {} : { body: {} }) });
        expect(res.status, `${method} /${route} must require authentication`).toBe(401);
      }
    });
  }
});
