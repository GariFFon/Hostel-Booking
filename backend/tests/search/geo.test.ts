import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { key, redis } from '@/infra/redis/redis';
import { GET as geoSearch } from '@/app/api/v1/geo/search/route';
import { GET as geoReverse } from '@/app/api/v1/geo/reverse/route';
import { normalizePlace, setGeoFetch } from '@/modules/geo/geo.service';
import { placeSchema } from '@/modules/geo/geo.schema';
import { call } from '../helpers/http';
import { uniq } from '../helpers/publish';

beforeAll(async () => {
  await redis.flushdb();
});
afterEach(() => setGeoFetch(null));
/** The upstream limiter is global (1/s); tests clear it instead of sleeping. */
const resetLimiter = () => redis.del(key('rl', 'nominatim:global'));

const NOMINATIM_HIT = [{
  display_name: 'Anjuna, Bardez, North Goa, Goa, 403509, India', lat: '15.5736', lon: '73.7414',
  address: { suburb: 'Anjuna', town: 'Anjuna', state: 'Goa', postcode: '403509', country_code: 'in' },
}];

function stub(body: unknown, init: { status?: number; throws?: boolean } = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  setGeoFetch((async (url: string, opts?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(url), headers: opts?.headers ?? {} });
    if (init.throws) throw new Error('network down');
    return new Response(JSON.stringify(body), { status: init.status ?? 200 });
  }) as typeof fetch);
  return calls;
}

describe('place search', () => {
  it('queries Nominatim politely and normalises the answer', async () => {
    await resetLimiter();
    const calls = stub(NOMINATIM_HIT);
    const q = uniq('anjuna ');
    const res = await call(geoSearch, { method: 'GET', query: `?q=${encodeURIComponent(q)}&limit=3` });
    expect(res.status).toBe(200);
    expect(placeSchema.safeParse(res.body.data[0]).error?.issues ?? []).toEqual([]);
    expect(res.body.data[0]).toMatchObject({ latitude: 15.5736, longitude: 73.7414, locality: 'Anjuna', city: 'Anjuna', state: 'Goa', postalCode: '403509', country: 'IN' });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe(q);
    expect(url.searchParams.get('countrycodes')).toBe('in');
    expect(url.searchParams.get('limit')).toBe('3');
    expect(calls[0]!.headers['User-Agent']).toMatch(/HostelBookingApp/); // Nominatim requires an identifying UA
  });

  it('caches results so repeated lookups never reach the upstream again', async () => {
    await resetLimiter();
    const calls = stub(NOMINATIM_HIT);
    const q = encodeURIComponent(uniq('cache me '));
    const a = await call(geoSearch, { method: 'GET', query: `?q=${q}` });
    const b = await call(geoSearch, { method: 'GET', query: `?q=${q}` });
    expect([a.headers.get('x-cache'), b.headers.get('x-cache')]).toEqual(['MISS', 'HIT']);
    expect(calls).toHaveLength(1);
  });

  it('enforces the global 1 request/second upstream limit', async () => {
    await resetLimiter();
    stub(NOMINATIM_HIT);
    const one = await call(geoSearch, { method: 'GET', query: `?q=${encodeURIComponent(uniq('first '))}` });
    const two = await call(geoSearch, { method: 'GET', query: `?q=${encodeURIComponent(uniq('second '))}` });
    expect(one.status).toBe(200);
    expect(two.status).toBe(429);
    expect(Number(two.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('turns upstream failures and outages into a clean 503', async () => {
    await resetLimiter();
    stub({}, { status: 500 });
    expect((await call(geoSearch, { method: 'GET', query: `?q=${encodeURIComponent(uniq('bad '))}` })).status).toBe(503);
    await resetLimiter();
    stub({}, { throws: true });
    const res = await call(geoSearch, { method: 'GET', query: `?q=${encodeURIComponent(uniq('down '))}` });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });

  it('validates input before calling anything', async () => {
    const calls = stub(NOMINATIM_HIT);
    expect((await call(geoSearch, { method: 'GET', query: '?q=ab' })).status).toBe(422);
    expect((await call(geoSearch, { method: 'GET', query: '' })).status).toBe(422);
    expect((await call(geoSearch, { method: 'GET', query: '?q=abcdef&limit=99' })).status).toBe(422);
    expect(calls).toHaveLength(0);
  });
});

describe('reverse geocoding', () => {
  it('maps coordinates to an address and shares cache between nearby taps', async () => {
    await resetLimiter();
    const calls = stub({ display_name: 'Somewhere', lat: '12.97', lon: '77.59', address: { city: 'Bengaluru', state: 'Karnataka', country_code: 'in', postcode: '560001' } });
    const lat = 12 + Math.random(), lng = 77 + Math.random();
    const a = await call(geoReverse, { method: 'GET', query: `?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}` });
    expect(a.body.data).toMatchObject({ city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', country: 'IN' });
    const b = await call(geoReverse, { method: 'GET', query: `?lat=${(lat + 0.000004).toFixed(6)}&lng=${lng.toFixed(6)}` }); // ~0.4 m away
    expect(b.headers.get('x-cache')).toBe('HIT');
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe('/reverse');
  });

  it('returns null when nothing is there, and rejects impossible coordinates', async () => {
    await resetLimiter();
    stub({ error: 'Unable to geocode' });
    const res = await call(geoReverse, { method: 'GET', query: `?lat=${(-40 - Math.random()).toFixed(6)}&lng=${(-120 - Math.random()).toFixed(6)}` });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect((await call(geoReverse, { method: 'GET', query: '?lat=91&lng=0' })).status).toBe(422);
    expect((await call(geoReverse, { method: 'GET', query: '?lat=abc&lng=0' })).status).toBe(422);
  });
});

describe('normalizePlace', () => {
  it('falls back across OSM place types and tolerates sparse addresses', () => {
    expect(normalizePlace({ display_name: 'x', lat: '1', lon: '2', address: { village: 'Tiny', county: 'Big' } })).toMatchObject({ city: 'Tiny', locality: null, state: null, postalCode: null, country: null });
    expect(normalizePlace({ display_name: 'x', lat: '1', lon: '2' })).toMatchObject({ city: null, latitude: 1, longitude: 2 });
    expect(normalizePlace({ display_name: 'x', lat: '1', lon: '2', address: { neighbourhood: 'N', municipality: 'M' } })).toMatchObject({ locality: 'N', city: 'M' });
  });
});
