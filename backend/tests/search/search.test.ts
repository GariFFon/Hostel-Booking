import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@/core/dates';
import { redis } from '@/infra/redis/redis';
import { invalidateInventory } from '@/infra/cache/invalidation';
import { prisma } from '@/infra/db/prisma';
import { GET as search } from '@/app/api/v1/hostels/route';
import { GET as mapSearch } from '@/app/api/v1/hostels/map/route';
import { GET as suggest } from '@/app/api/v1/search/suggest/route';
import { GET as cities } from '@/app/api/v1/cities/route';
import { searchItemSchema, mapMarkerSchema, suggestResponseSchema, cityItemSchema } from '@/modules/search/search.schema';
import { call } from '../helpers/http';
import { D, TODAY, consume, nextWeekday, publish, uniq } from '../helpers/publish';

beforeAll(async () => {
  await redis.flushdb();
});

const find = (q: string) => call(search, { method: 'GET', query: `?${q}` });
const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((h) => h.id);
const nameOf = (res: { body: { data: { name: string }[] } }) => res.body.data.map((h) => h.name);

describe('visibility', () => {
  it('only shows approved, non-deleted listings, and responses match the contract', async () => {
    const city = uniq('Vis');
    const live = await publish({ city, name: 'Live One' });
    await publish({ city, name: 'Draft', status: 'DRAFT' });
    await publish({ city, name: 'Pending', status: 'PENDING_REVIEW' });
    await publish({ city, name: 'Suspended', status: 'SUSPENDED' });
    await publish({ city, name: 'Rejected', status: 'REJECTED' });
    await publish({ city, name: 'Deleted', deleted: true });
    const res = await find(`city=${city}`);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([live.hostel.id]);
    expect(res.body.meta.total).toBe(1);
    for (const item of res.body.data) expect(searchItemSchema.safeParse(item).error?.issues ?? []).toEqual([]);
    expect(res.body.data[0]).toMatchObject({ fromPricePaise: 80000, currency: 'INR', roomKinds: ['DORM'], stayFromPricePaise: null });
    expect(res.body.data[0].photoUrls.length).toBe(3);
    expect(res.body.data[0].photoUrls[0]).toContain('/upload/c_fill,w_640,h_480');
  });
});

describe('text and place', () => {
  it('matches city case-insensitively, and name / locality / typos via q', async () => {
    const city = uniq('Txt');
    await publish({ city, name: 'Banyan Tree Hostel', locality: 'Anjuna' });
    await publish({ city, name: 'Coconut Grove', locality: 'Vagator' });
    expect(nameOf(await find(`city=${city.toUpperCase()}`)).sort()).toEqual(['Banyan Tree Hostel', 'Coconut Grove']);
    expect(nameOf(await find(`q=banyan&city=${city}`))).toEqual(['Banyan Tree Hostel']);
    expect(nameOf(await find(`q=vagator&city=${city}`))).toEqual(['Coconut Grove']);
    expect(nameOf(await find(`q=${encodeURIComponent('Banyan Tre Hostl')}&city=${city}`))).toContain('Banyan Tree Hostel'); // typo tolerance
  });

  it('treats % and _ in the query literally (no wildcard injection)', async () => {
    const city = uniq('Lit');
    await publish({ city, name: 'Plain Name' });
    expect(ids(await find(`q=${encodeURIComponent('%')}&city=${city}`))).toEqual([]);
    expect(ids(await find(`q=${encodeURIComponent('P_ain')}&city=${city}`))).toEqual([]);
    expect((await find(`q=${encodeURIComponent("'; DROP TABLE hostels; --")}`)).status).toBe(200);
    expect(await prisma.hostel.count()).toBeGreaterThan(0);
  });
});

describe('geo', () => {
  // ~0.009 degrees of latitude is ~1 km
  const center = { lat: 21.5 + Math.random() * 5, lng: -100 + Math.random() * 20 };
  it('filters by radius, reports distance, and sorts nearest-first by default', async () => {
    const near = await publish({ name: 'Near 1km', lat: center.lat + 0.009, lng: center.lng });
    const mid = await publish({ name: 'Mid 8km', lat: center.lat + 0.072, lng: center.lng });
    const far = await publish({ name: 'Far 30km', lat: center.lat + 0.27, lng: center.lng });
    const res = await find(`lat=${center.lat}&lng=${center.lng}&radiusKm=10`);
    expect(ids(res)).toEqual([near.hostel.id, mid.hostel.id]);
    expect(res.body.data[0].distanceKm).toBeGreaterThan(0.8);
    expect(res.body.data[0].distanceKm).toBeLessThan(1.3);
    expect(res.body.data[1].distanceKm).toBeGreaterThan(7);
    expect(ids(await find(`lat=${center.lat}&lng=${center.lng}&radiusKm=50`))).toEqual([near.hostel.id, mid.hostel.id, far.hostel.id]);
    expect((await find(`city=Nowhere${uniq()}`)).body.data).toEqual([]);
  });

  it('map endpoint returns markers inside the bounding box only', async () => {
    const c = { lat: -30 + Math.random() * 5, lng: 120 + Math.random() * 20 };
    const inside = await publish({ lat: c.lat, lng: c.lng });
    await publish({ lat: c.lat + 5, lng: c.lng });
    const bbox = [c.lng - 1, c.lat - 1, c.lng + 1, c.lat + 1].join(',');
    const res = await call(mapSearch, { method: 'GET', query: `?bbox=${bbox}` });
    expect(res.body.data.map((m: { id: string }) => m.id)).toEqual([inside.hostel.id]);
    expect(mapMarkerSchema.safeParse(res.body.data[0]).error?.issues ?? []).toEqual([]);
    expect((await call(mapSearch, { method: 'GET', query: '' })).status).toBe(422); // bbox is required
    expect((await find(`bbox=${bbox}`)).body.data.map((h: { id: string }) => h.id)).toEqual([inside.hostel.id]);
  });
});

describe('filters', () => {
  it('price, type, room kind, rating, instant book and amenities (all must match)', async () => {
    const city = uniq('Flt');
    const cheap = await publish({ city, name: 'Cheap', rooms: [{ price: 40000 }], rating: 3.5, reviews: 4, amenities: ['WIFI'] });
    const posh = await publish({ city, name: 'Posh', rooms: [{ kind: 'PRIVATE', price: 300000, occupancy: 2 }], rating: 4.8, reviews: 30, amenities: ['WIFI', 'POOL'], bookingMode: 'APPROVAL' });
    const pg = await publish({ city, name: 'PG Place', propertyType: 'PG', rooms: [{ price: 90000 }], rating: 4.1, reviews: 9, amenities: ['MESS'] });
    expect(nameOf(await find(`city=${city}&maxPrice=50000`))).toEqual(['Cheap']);
    expect(nameOf(await find(`city=${city}&minPrice=100000`))).toEqual(['Posh']);
    expect(ids(await find(`city=${city}&propertyType=PG`))).toEqual([pg.hostel.id]);
    expect(ids(await find(`city=${city}&roomKind=PRIVATE`))).toEqual([posh.hostel.id]);
    expect(nameOf(await find(`city=${city}&minRating=4.5`))).toEqual(['Posh']);
    expect(nameOf(await find(`city=${city}&instantBook=true`)).sort()).toEqual(['Cheap', 'PG Place']);
    expect(ids(await find(`city=${city}&amenities=wifi`)).sort()).toEqual([cheap.hostel.id, posh.hostel.id].sort());
    expect(ids(await find(`city=${city}&amenities=WIFI,POOL`))).toEqual([posh.hostel.id]); // ALL required
    expect(ids(await find(`city=${city}&amenities=WIFI,NOPE`))).toEqual([]);
  });

  it('gender: women-only listings are hidden from men and vice versa; room genders are respected', async () => {
    const city = uniq('Gen');
    const mixed = await publish({ city, name: 'Mixed', rooms: [{ gender: 'MIXED' }] });
    const women = await publish({ city, name: 'Women Only', genderPolicy: 'FEMALE_ONLY', rooms: [{ gender: 'FEMALE' }] });
    const femaleDorm = await publish({ city, name: 'Female Dorm Only', rooms: [{ gender: 'FEMALE' }] });
    expect(ids(await find(`city=${city}&gender=MALE`))).toEqual([mixed.hostel.id]);
    expect(ids(await find(`city=${city}&gender=FEMALE`)).sort()).toEqual([mixed.hostel.id, women.hostel.id, femaleDorm.hostel.id].sort());
  });
});

describe('dates and availability', () => {
  const stay = { checkIn: addDays(TODAY, 20), checkOut: addDays(TODAY, 23) };
  const q = (city: string, extra = '') => `city=${city}&checkIn=${stay.checkIn}&checkOut=${stay.checkOut}${extra}`;

  it('requires enough free capacity for every night of the stay and the party size', async () => {
    const city = uniq('Avl');
    const small = await publish({ city, name: 'Small', rooms: [{ units: 2 }] });
    const big = await publish({ city, name: 'Big', rooms: [{ units: 10 }] });
    expect(nameOf(await find(q(city, '&guests=2'))).sort()).toEqual(['Big', 'Small']);
    expect(nameOf(await find(q(city, '&guests=4')))).toEqual(['Big']);
    await consume(big.rooms[0]!.id, addDays(stay.checkIn, 1), addDays(stay.checkIn, 2), 9); // one night nearly full
    expect(nameOf(await find(q(city, '&guests=4')))).toEqual([]);
    expect(nameOf(await find(q(city, '&guests=1'))).sort()).toEqual(['Big', 'Small']);
    await consume(small.rooms[0]!.id, stay.checkIn, stay.checkOut, 2); // sold out
    expect(nameOf(await find(q(city, '&guests=1')))).toEqual(['Big']);
  });

  it('respects blocked and held units, minimum stay, and the open booking horizon', async () => {
    const city = uniq('Rst');
    const blocked = await publish({ city, name: 'Blocked', rooms: [{ units: 3 }] });
    await prisma.inventoryNight.updateMany({ where: { roomTypeId: blocked.rooms[0]!.id, date: { gte: D(stay.checkIn), lt: D(stay.checkOut) } }, data: { blockedUnits: 3 } });
    await invalidateInventory();
    await publish({ city, name: 'Held', rooms: [{ units: 1 }] }).then((h) => prisma.inventoryNight.updateMany({ where: { roomTypeId: h.rooms[0]!.id, date: { gte: D(stay.checkIn), lt: D(stay.checkOut) } }, data: { heldUnits: 1 } }).then(() => invalidateInventory()));
    await publish({ city, name: 'Long stay only', propertyType: 'PG', rooms: [{ minStay: 7 }] });
    await publish({ city, name: 'Open', rooms: [{ units: 2 }] });
    expect(nameOf(await find(q(city)))).toEqual(['Open']);
    const beyond = await find(`city=${city}&checkIn=${addDays(TODAY, 400)}&checkOut=${addDays(TODAY, 402)}`);
    expect(beyond.body.data).toEqual([]); // inventory is not open that far ahead
  });

  it('shows the real average nightly price for the stay (price rules included) when dates are given', async () => {
    const city = uniq('Prc');
    const fri = nextWeekday(5);
    await publish({ city, name: 'Weekend uplift', rooms: [{ price: 100000, rules: [{ type: 'WEEKEND', weekdays: [5, 6], adjustmentBps: 5000 }] }] });
    const res = await find(`city=${city}&checkIn=${fri}&checkOut=${addDays(fri, 2)}`); // Fri + Sat, both +50%
    expect(res.body.data[0]).toMatchObject({ fromPricePaise: 100000, stayFromPricePaise: 150000 });
    const weekday = await find(`city=${city}&checkIn=${addDays(fri, 3)}&checkOut=${addDays(fri, 4)}`); // Monday
    expect(weekday.body.data[0].stayFromPricePaise).toBe(100000);
  });
});

describe('sorting and keyset pagination', () => {
  const city = uniq('Pag');
  let created: { id: string; price: number; rating: number; reviews: number; lat: number }[] = [];
  beforeAll(async () => {
    // 8 listings with deliberate ties so tie-breaking on id is exercised
    const specs = [[50000, 4.5, 10], [50000, 4.5, 10], [70000, 4.0, 3], [70000, 4.8, 40], [90000, 0, 0], [90000, 0, 0], [30000, 3.2, 8], [120000, 4.9, 55]] as const;
    for (const [i, [price, rating, reviews]] of specs.entries()) {
      const h = await publish({ city, name: `Paged ${i}`, rooms: [{ price }], rating, reviews, lat: 12 + i * 0.01, lng: 77, approvedAt: new Date(Date.now() - i * 60_000) });
      created.push({ id: h.hostel.id, price, rating, reviews, lat: 12 + i * 0.01 });
    }
  });

  async function walk(sort: string, extra = '') {
    const seen: string[] = [];
    let cursor: string | null = null;
    let first = true;
    for (let page = 0; page < 10; page++) {
      const res: { body: { data: { id: string }[]; meta: { nextCursor: string | null; total?: number } } } = await find(`city=${city}&sort=${sort}&limit=3${extra}${cursor ? `&cursor=${cursor}` : ''}`);
      if (first) expect(res.body.meta.total).toBe(8);
      else expect(res.body.meta.total).toBeUndefined(); // counted once, on the first page
      first = false;
      seen.push(...res.body.data.map((h) => h.id));
      cursor = res.body.meta.nextCursor;
      if (!cursor) break;
    }
    return seen;
  }

  it.each(['recommended', 'price_asc', 'price_desc', 'rating', 'newest', 'distance'])('%s: every listing exactly once, in a consistent order, across pages', async (sort) => {
    const seen = await walk(sort, sort === 'distance' ? '&lat=12&lng=77&radiusKm=100' : '');
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
    const byId = new Map(created.map((c) => [c.id, c]));
    const prices = seen.map((id) => byId.get(id)!.price);
    if (sort === 'price_asc') expect(prices).toEqual([...prices].sort((a, b) => a - b));
    if (sort === 'price_desc') expect(prices).toEqual([...prices].sort((a, b) => b - a));
    if (sort === 'rating') expect(seen.map((id) => byId.get(id)!.rating)).toEqual([...created.map((c) => c.rating)].sort((a, b) => b - a));
    if (sort === 'newest') expect(seen).toEqual(created.map((c) => c.id)); // approvedAt decreases with index
    if (sort === 'distance') expect(seen).toEqual(created.map((c) => c.id)); // latitude increases with index
  });

  it('single-page and page-by-page results agree', async () => {
    const all = ids(await find(`city=${city}&sort=price_asc&limit=50`));
    expect(await walk('price_asc')).toEqual(all);
  });

  it('rejects cursors that are garbage or belong to another sort', async () => {
    const first = await find(`city=${city}&sort=price_asc&limit=2`);
    expect((await find(`city=${city}&sort=price_desc&limit=2&cursor=${first.body.meta.nextCursor}`)).status).toBe(422);
    expect((await find(`city=${city}&sort=price_asc&cursor=garbage`)).status).toBe(422);
    expect((await find(`city=${city}&sort=price_asc&cursor=${Buffer.from('{"s":"price_asc","k":"1; DROP","id":"x"}').toString('base64url')}`)).status).toBe(422);
  });

  it('relevance ranks the best textual match first', async () => {
    const c = uniq('Rel');
    await publish({ city: c, name: 'Sunset Haven' });
    await publish({ city: c, name: 'Sunrise Backpackers' });
    const res = await find(`q=sunset&city=${c}&sort=relevance`);
    expect(nameOf(res)[0]).toBe('Sunset Haven');
  });
});

describe('validation', () => {
  it.each([
    ['lat without lng', 'lat=10'],
    ['dates: only one', `checkIn=${addDays(TODAY, 5)}`],
    ['checkout before checkin', `checkIn=${addDays(TODAY, 9)}&checkOut=${addDays(TODAY, 5)}`],
    ['stay over 90 nights', `checkIn=${addDays(TODAY, 5)}&checkOut=${addDays(TODAY, 120)}`],
    ['past dates', `checkIn=2020-01-01&checkOut=2020-01-03`],
    ['min > max price', 'minPrice=500&maxPrice=100'],
    ['distance sort without a point', 'sort=distance'],
    ['relevance without q', 'sort=relevance'],
    ['bad bbox', 'bbox=1,2,3'],
    ['inverted bbox', 'bbox=10,10,5,5'],
    ['unknown sort', 'sort=magic'],
    ['limit 0', 'limit=0'],
    ['limit 500', 'limit=500'],
    ['impossible date', `checkIn=2026-02-31&checkOut=2026-03-02`],
    ['unknown property type', 'propertyType=CASTLE'],
  ])('422: %s', async (_name, query) => {
    const res = await find(query);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('suggest and cities', () => {
  it('autocompletes cities (with counts) and listing names', async () => {
    const stem = uniq('Zq').replace(/[^a-z]/gi, 'z').slice(0, 6);
    const city = `${stem}pur`;
    await publish({ city, name: `${stem} Palace Hostel` });
    await publish({ city, name: 'Another One' });
    const res = await call(suggest, { method: 'GET', query: `?q=${stem}` });
    expect(suggestResponseSchema.safeParse(res.body.data).error?.issues ?? []).toEqual([]);
    expect(res.body.data.cities).toEqual([{ city, state: 'Testland', count: 2 }]);
    expect(res.body.data.hostels.map((h: { name: string }) => h.name)).toEqual([`${stem} Palace Hostel`]);
    expect((await call(suggest, { method: 'GET', query: '?q=a' })).status).toBe(422);
  });

  it('lists cities with counts, centre and from-price', async () => {
    const city = uniq('Cty').replace(/[^a-z]/gi, 'q');
    await publish({ city, rooms: [{ price: 55000 }] });
    await publish({ city, rooms: [{ price: 45000 }] });
    const res = await call(cities, { method: 'GET' });
    const row = res.body.data.find((c: { city: string }) => c.city === city);
    expect(cityItemSchema.safeParse(row).error?.issues ?? []).toEqual([]);
    expect(row).toMatchObject({ count: 2, fromPricePaise: 45000 });
  });
});

describe('abuse protection', () => {
  it('rate-limits search per IP without affecting other clients', async () => {
    const ip = `10.99.${Math.floor(Math.random() * 200)}.7`;
    let last = 200;
    for (let i = 0; i < 125; i++) last = (await call(search, { method: 'GET', ip, query: `?city=Nowhere${i}` })).status;
    expect(last).toBe(429);
    expect((await call(search, { method: 'GET', query: '?city=Anywhere' })).status).toBe(200);
  });
});
