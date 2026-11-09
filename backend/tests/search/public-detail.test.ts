import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@/core/dates';
import { prisma } from '@/infra/db/prisma';
import { redis } from '@/infra/redis/redis';
import { GET as detail } from '@/app/api/v1/hostels/[idOrSlug]/route';
import { GET as availability } from '@/app/api/v1/hostels/[idOrSlug]/availability/route';
import { GET as calendar } from '@/app/api/v1/hostels/[idOrSlug]/calendar/route';
import { availabilitySchema, priceCalendarSchema, publicHostelSchema } from '@/modules/hostels/public-hostels.schema';
import { call } from '../helpers/http';
import { D, TODAY, consume, nextWeekday, publish } from '../helpers/publish';
import { makeUser } from '../helpers/users';

beforeAll(async () => {
  await redis.flushdb();
});

const get = (idOrSlug: string, path = detail, query = '') => call(path as typeof detail, { method: 'GET', params: { idOrSlug }, query });

describe('public listing detail', () => {
  it('resolves by id or slug, matches the contract, and never exposes owner contact details', async () => {
    const owner = await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED', name: 'Priya Private' });
    await prisma.hostel.updateMany({ where: { ownerId: owner.id }, data: {} });
    const h = await publish({ ownerId: owner.id, amenities: ['WIFI', 'CAFE'], rating: 4.5, reviews: 12, rooms: [{ name: 'Dorm', price: 80000 }, { name: 'Suite', kind: 'PRIVATE', price: 250000, occupancy: 2 }] });
    const bySlug = await get(h.hostel.slug);
    const byId = await get(h.hostel.id);
    expect(bySlug.status).toBe(200);
    expect(byId.body.data).toEqual(bySlug.body.data);
    expect(publicHostelSchema.safeParse(bySlug.body.data).error?.issues ?? []).toEqual([]);
    const d = bySlug.body.data;
    expect(d).toMatchObject({ name: h.hostel.name, fromPricePaise: 80000, avgRating: 4.5, reviewCount: 12, currency: 'INR', host: { name: 'Test Stays' }, cancellation: { policy: 'MODERATE' } });
    expect(d.roomTypes.map((r: { name: string; fromPricePaise: number }) => [r.name, r.fromPricePaise])).toEqual([['Dorm', 80000], ['Suite', 250000]]);
    expect(d.amenities.map((a: { code: string }) => a.code).sort()).toEqual(['CAFE', 'WIFI']);
    expect(d.tax).toMatchObject({ lowBps: 500, highBps: 1800, thresholdPaise: 750000 });
    const text = JSON.stringify(bySlug.body);
    expect(text).not.toContain(owner.email);
    expect(text).not.toMatch(/ownerId|contactEmail|"phone"|gstin/);
  });

  it('is "not found" for anything unpublished, deleted, malformed or unknown', async () => {
    for (const status of ['DRAFT', 'PENDING_REVIEW', 'SUSPENDED', 'REJECTED'] as const) {
      const h = await publish({ status });
      expect((await get(h.hostel.slug)).status).toBe(404);
      expect((await get(h.hostel.id)).status).toBe(404);
    }
    expect((await get((await publish({ deleted: true })).hostel.slug)).status).toBe(404);
    expect((await get('no-such-listing')).status).toBe(404);
    expect((await get('../etc/passwd')).status).toBe(404);
    expect((await get('a'.repeat(300))).status).toBe(404);
    expect((await get('00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('separates listing photos from room photos', async () => {
    const h = await publish({ photos: 2 });
    await prisma.media.create({ data: { hostelId: h.hostel.id, roomTypeId: h.rooms[0]!.id, publicId: `test/room-${Date.now()}`, url: 'https://res.cloudinary.com/testcloud/image/upload/v1/room.jpg' } });
    const d = (await get(h.hostel.slug)).body.data;
    expect(d.media).toHaveLength(2);
    expect(d.roomTypes[0].media).toHaveLength(1);
  });
});

describe('availability for given dates', () => {
  it('reports units, eligibility reasons and the real stay price per room type', async () => {
    const ci = nextWeekday(5);
    const h = await publish({ rooms: [
      { name: 'Dorm', units: 4, price: 100000, rules: [{ type: 'WEEKEND', weekdays: [5, 6], adjustmentBps: 5000 }] },
      { name: 'Long stay', units: 2, minStay: 7 },
      { name: 'Sold out', units: 1 },
    ] });
    await consume(h.rooms[2]!.id, ci, addDays(ci, 2), 1);
    await consume(h.rooms[0]!.id, addDays(ci, 1), addDays(ci, 2), 1);
    const res = await get(h.hostel.id, availability, `?checkIn=${ci}&checkOut=${addDays(ci, 2)}&guests=3`);
    expect(availabilitySchema.safeParse(res.body.data).error?.issues ?? []).toEqual([]);
    expect(res.body.data).toMatchObject({ nights: 2, canHost: true });
    const [dorm, long, sold] = res.body.data.rooms;
    expect(dorm).toMatchObject({ availableUnits: 3, eligible: true, reason: null, avgNightlyPaise: 150000, stayPerUnitPaise: 300000 }); // Fri+Sat at +50%
    expect(long).toMatchObject({ eligible: false, reason: 'MIN_STAY' });
    expect(sold).toMatchObject({ availableUnits: 0, eligible: false, reason: 'SOLD_OUT' });
    expect((await get(h.hostel.id, availability, `?checkIn=${ci}&checkOut=${addDays(ci, 2)}&guests=4`)).body.data.canHost).toBe(false); // only 3 beds free
  });

  it('validates its query', async () => {
    const h = await publish();
    expect((await get(h.hostel.id, availability, '')).status).toBe(422);
    expect((await get(h.hostel.id, availability, `?checkIn=${addDays(TODAY, 9)}&checkOut=${addDays(TODAY, 5)}`)).status).toBe(422);
  });
});

describe('price calendar', () => {
  it('lists availability and the unit price per night for every room type', async () => {
    const fri = nextWeekday(5);
    const h = await publish({ rooms: [{ units: 3, price: 100000, rules: [{ type: 'WEEKEND', weekdays: [5], adjustmentBps: 1000 }] }] });
    await consume(h.rooms[0]!.id, addDays(fri, 1), addDays(fri, 2), 3);
    await prisma.inventoryNight.updateMany({ where: { roomTypeId: h.rooms[0]!.id, date: D(addDays(fri, 2)) }, data: { blockedUnits: 1 } });
    const res = await get(h.hostel.slug, calendar, `?from=${fri}&to=${addDays(fri, 3)}`);
    expect(priceCalendarSchema.safeParse(res.body.data).error?.issues ?? []).toEqual([]);
    expect(res.body.data[0].nights).toEqual([
      { date: fri, available: 3, unitPricePaise: 110000 },
      { date: addDays(fri, 1), available: 0, unitPricePaise: 100000 },
      { date: addDays(fri, 2), available: 2, unitPricePaise: 100000 },
      { date: addDays(fri, 3), available: 3, unitPricePaise: 100000 },
    ]);
  });

  it('limits the range and treats nights without inventory as unavailable', async () => {
    const h = await publish();
    expect((await get(h.hostel.id, calendar, `?from=${TODAY}&to=${addDays(TODAY, 120)}`)).status).toBe(422);
    expect((await get(h.hostel.id, calendar, `?from=${addDays(TODAY, 5)}&to=${addDays(TODAY, 1)}`)).status).toBe(422);
    const far = (await get(h.hostel.id, calendar, `?from=${addDays(TODAY, 500)}&to=${addDays(TODAY, 501)}`)).body.data[0].nights;
    expect(far.map((n: { available: number }) => n.available)).toEqual([0, 0]);
  });
});
