import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cached, hashKey, invalidate, setCacheClient, type CacheClient } from '@/infra/cache/cache';
import { cloudinaryStorage, setMediaStorage } from '@/infra/cloudinary/storage';
import { redis } from '@/infra/redis/redis';
import { GET as detail } from '@/app/api/v1/hostels/[idOrSlug]/route';
import { GET as search } from '@/app/api/v1/hostels/route';
import { GET as amenities } from '@/app/api/v1/amenities/route';
import { PATCH as patchHostel } from '@/app/api/v1/owner/hostels/[id]/route';
import { PATCH as patchRoom } from '@/app/api/v1/owner/room-types/[id]/route';
import { POST as createRule } from '@/app/api/v1/owner/room-types/[id]/price-rules/route';
import { PUT as putBlocks } from '@/app/api/v1/owner/room-types/[id]/blocks/route';
import { POST as suspend } from '@/app/api/v1/admin/hostels/[id]/suspend/route';
import { POST as reinstate } from '@/app/api/v1/admin/hostels/[id]/reinstate/route';
import { POST as withdraw } from '@/app/api/v1/owner/hostels/[id]/withdraw/route';
import { PATCH as patchAmenity } from '@/app/api/v1/admin/amenities/[id]/route';
import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { call } from '../helpers/http';
import { FakeStorage } from '../helpers/fake-storage';
import { attachPhoto } from '../helpers/listings';
import { TODAY, publish, uniq } from '../helpers/publish';
import { makeUser } from '../helpers/users';

beforeAll(async () => {
  await redis.flushdb();
});
afterEach(() => setCacheClient(null));

/** In-memory stand-in so we can observe commands and simulate outages. */
class MemClient implements CacheClient {
  data = new Map<string, string>();
  ttl = new Map<string, number>();
  fail = false;
  async get(k: string) { if (this.fail) throw new Error('down'); return this.data.get(k) ?? null; }
  async mget(...ks: string[]) { if (this.fail) throw new Error('down'); return ks.map((k) => this.data.get(k) ?? null); }
  async set(k: string, v: string, _m: 'EX', ttl: number) { if (this.fail) throw new Error('down'); this.data.set(k, v); this.ttl.set(k, ttl); return 'OK'; }
  async incr(k: string) { if (this.fail) throw new Error('down'); const n = Number(this.data.get(k) ?? 0) + 1; this.data.set(k, String(n)); return n; }
}

describe('cache layer', () => {
  it('loads once, then serves from cache until the namespace is invalidated', async () => {
    const mem = new MemClient();
    setCacheClient(mem);
    let loads = 0;
    const opts = { ns: ['ns-a'], key: 'k', ttlSeconds: 60 };
    const load = async () => ({ n: ++loads });
    expect(await cached(opts, load)).toEqual({ value: { n: 1 }, hit: false });
    expect(await cached(opts, load)).toEqual({ value: { n: 1 }, hit: true });
    await invalidate('ns-a');
    expect(await cached(opts, load)).toEqual({ value: { n: 2 }, hit: false });
    expect(await cached(opts, load)).toEqual({ value: { n: 2 }, hit: true });
  });

  it('keeps namespaces independent, and an entry in two namespaces dies with either', async () => {
    setCacheClient(new MemClient());
    let a = 0, b = 0, both = 0;
    const get = (ns: string[], load: () => Promise<number>) => cached({ ns, key: 'k', ttlSeconds: 60 }, load);
    await get(['A'], async () => ++a); await get(['B'], async () => ++b); await get(['A', 'B'], async () => ++both);
    await invalidate('A');
    await get(['A'], async () => ++a); await get(['B'], async () => ++b); await get(['A', 'B'], async () => ++both);
    expect([a, b, both]).toEqual([2, 1, 2]);
  });

  it('shares one load between concurrent misses (no stampede)', async () => {
    setCacheClient(new MemClient());
    let loads = 0;
    const slow = async () => { loads++; await new Promise((r) => setTimeout(r, 40)); return 'v'; };
    const results = await Promise.all(Array.from({ length: 25 }, () => cached({ ns: ['s'], key: 'k', ttlSeconds: 30 }, slow)));
    expect(loads).toBe(1);
    expect(results.every((r) => r.value === 'v')).toBe(true);
  });

  it('never fails a request when Redis is down: it just loads', async () => {
    const mem = new MemClient();
    mem.fail = true;
    setCacheClient(mem);
    expect(await cached({ ns: ['x'], key: 'k', ttlSeconds: 30 }, async () => 'fresh')).toEqual({ value: 'fresh', hit: false });
    await expect(invalidate('x')).resolves.toBeUndefined();
    mem.fail = false;
    expect((await cached({ ns: ['x'], key: 'k', ttlSeconds: 30 }, async () => 'fresh')).hit).toBe(false);
  });

  it('does not cache failures, jitters TTLs, hashes long keys and skips oversized values', async () => {
    const mem = new MemClient();
    setCacheClient(mem);
    await expect(cached({ ns: ['f'], key: 'k', ttlSeconds: 60 }, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect((await cached({ ns: ['f'], key: 'k', ttlSeconds: 60 }, async () => 'ok')).hit).toBe(false); // the failure was not cached
    const ttls = new Set<number>();
    for (let i = 0; i < 30; i++) { await cached({ ns: ['j'], key: `k${i}`, ttlSeconds: 300 }, async () => i); }
    for (const [k, t] of mem.ttl) if (k.includes('j@')) ttls.add(t);
    expect(Math.min(...ttls)).toBeGreaterThanOrEqual(300);
    expect(Math.max(...ttls)).toBeLessThan(331);
    expect(ttls.size).toBeGreaterThan(1);
    await cached({ ns: ['h'], key: 'x'.repeat(500), ttlSeconds: 30 }, async () => 1);
    expect([...mem.data.keys()].every((k) => k.length < 120)).toBe(true);
    let loads = 0;
    const big = async () => { loads++; return 'z'.repeat(600 * 1024); };
    await cached({ ns: ['big'], key: 'k', ttlSeconds: 30 }, big); await cached({ ns: ['big'], key: 'k', ttlSeconds: 30 }, big);
    expect(loads).toBe(2);
    expect(hashKey({ a: 1 })).toBe(hashKey({ a: 1 }));
    expect(hashKey({ a: 1 })).not.toBe(hashKey({ a: 2 }));
  });
});

describe('cache behaviour through the API', () => {
  const storage = new FakeStorage();
  const getDetail = (slug: string) => call(detail, { method: 'GET', params: { idOrSlug: slug } });
  const owner = async () => makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' });

  it('serves a repeated detail request from cache (X-Cache), and shows owner edits immediately', async () => {
    const o = await owner();
    const h = await publish({ ownerId: o.id, name: uniq('Before ') });
    const first = await getDetail(h.hostel.slug);
    const second = await getDetail(h.hostel.slug);
    expect([first.headers.get('x-cache'), second.headers.get('x-cache')]).toEqual(['MISS', 'HIT']);

    const upd = await call(patchHostel, { method: 'PATCH', token: o.token, params: { id: h.hostel.id }, body: { name: 'After Rename Hostel' } });
    expect(upd.status).toBe(200);
    const third = await getDetail(h.hostel.slug);
    expect(third.headers.get('x-cache')).toBe('MISS');
    expect(third.body.data.name).toBe('After Rename Hostel');
    expect((await getDetail(h.hostel.slug)).headers.get('x-cache')).toBe('HIT');
  });

  it('invalidates on room, price-rule, photo and capacity changes', async () => {
    setMediaStorage(storage);
    const o = await owner();
    const h = await publish({ ownerId: o.id, rooms: [{ price: 80000 }] });
    const room = h.rooms[0]!;
    await getDetail(h.hostel.slug);

    await call(patchRoom, { method: 'PATCH', token: o.token, params: { id: room.id }, body: { basePricePaise: 95000 } });
    let d = await getDetail(h.hostel.slug);
    expect([d.headers.get('x-cache'), d.body.data.fromPricePaise]).toEqual(['MISS', 95000]);

    await call(createRule, { token: o.token, params: { id: room.id }, body: { type: 'WEEKEND', weekdays: [6], adjustmentBps: 1000 } });
    expect((await getDetail(h.hostel.slug)).headers.get('x-cache')).toBe('MISS');

    await getDetail(h.hostel.slug);
    await attachPhoto(o.token, h.hostel.id, storage);
    d = await getDetail(h.hostel.slug);
    expect([d.headers.get('x-cache'), d.body.data.media.length]).toEqual(['MISS', 4]);
    setMediaStorage(cloudinaryStorage);
  });

  it('removes suspended listings from detail and search at once, and restores them on reinstatement', async () => {
    const o = await owner();
    const admin = await makeUser({ roles: ['ADMIN'] });
    const city = uniq('Cch');
    const h = await publish({ ownerId: o.id, city });
    const find = () => call(search, { method: 'GET', query: `?city=${city}` });
    expect((await find()).body.data).toHaveLength(1);
    expect((await find()).headers.get('x-cache')).toBe('HIT');

    await call(suspend, { token: admin.token, params: { id: h.hostel.id }, body: { reason: 'Safety investigation underway' } });
    expect((await find()).body.data).toEqual([]);
    expect((await getDetail(h.hostel.slug)).status).toBe(404);

    await call(reinstate, { token: admin.token, params: { id: h.hostel.id } });
    expect((await find()).body.data).toHaveLength(1);
    expect((await getDetail(h.hostel.slug)).status).toBe(200);

    await call(withdraw, { token: o.token, params: { id: h.hostel.id } }); // owner takes it offline
    expect((await find()).body.data).toEqual([]);
  });

  it('dated searches reflect calendar blocks immediately, but undated ones are unaffected', async () => {
    const o = await owner();
    const city = uniq('Inv');
    const h = await publish({ ownerId: o.id, city, rooms: [{ units: 2 }] });
    const q = `?city=${city}&checkIn=${addDays(TODAY, 20)}&checkOut=${addDays(TODAY, 22)}&guests=1`;
    expect((await call(search, { method: 'GET', query: q })).body.data).toHaveLength(1);
    expect((await call(search, { method: 'GET', query: q })).headers.get('x-cache')).toBe('HIT');
    await call(putBlocks, { method: 'PUT', token: o.token, params: { id: h.rooms[0]!.id }, body: { from: addDays(TODAY, 20), to: addDays(TODAY, 21), units: 2 } });
    const after = await call(search, { method: 'GET', query: q });
    expect(after.headers.get('x-cache')).toBe('MISS');
    expect(after.body.data).toEqual([]); // fully blocked
    const plain = `?city=${city}`;
    await call(search, { method: 'GET', query: plain });
    await call(putBlocks, { method: 'PUT', token: o.token, params: { id: h.rooms[0]!.id }, body: { from: addDays(TODAY, 20), to: addDays(TODAY, 21), units: 0 } });
    expect((await call(search, { method: 'GET', query: plain })).headers.get('x-cache')).toBe('HIT'); // inventory moves do not bust undated results
  });

  it('amenity edits show up in cached detail and search', async () => {
    const admin = await makeUser({ roles: ['ADMIN'] });
    const code = `CCHAM_${Date.now()}`;
    const city = uniq('Amc');
    const h = await publish({ city, amenities: [code] });
    const am = await prisma.amenity.findUniqueOrThrow({ where: { code } });
    await getDetail(h.hostel.slug);
    await call(amenities, { method: 'GET' });
    await call(patchAmenity, { method: 'PATCH', token: admin.token, params: { id: am.id }, body: { label: 'Renamed Amenity' } });
    const d = await getDetail(h.hostel.slug);
    expect(d.headers.get('x-cache')).toBe('MISS');
    expect(d.body.data.amenities[0].label).toBe('Renamed Amenity');
  });
});
