import { addDays, todayIn } from '@/core/dates';
import { invalidateInventory } from '@/infra/cache/invalidation';
import { prisma } from '@/infra/db/prisma';
import { ensureInventory } from '@/modules/availability/inventory.service';
import { makeUser } from './users';

export const TODAY = todayIn('Asia/Kolkata');
export const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const uniq = (p = 'x') => `${p}${Math.random().toString(36).slice(2, 8)}`;

/** The next date (>= `from`) that falls on the given weekday (0=Sun..6=Sat). */
export function nextWeekday(weekday: number, from = addDays(TODAY, 7)): string {
  let d = from;
  while (D(d).getUTCDay() !== weekday) d = addDays(d, 1);
  return d;
}

export interface RoomSpec {
  name?: string; kind?: 'DORM' | 'PRIVATE'; gender?: 'MIXED' | 'MALE' | 'FEMALE'; units?: number; price?: number; occupancy?: number;
  minStay?: number; maxStay?: number; priceUnit?: 'NIGHT' | 'MONTH';
  rules?: { type: 'WEEKEND' | 'DATE_RANGE'; weekdays?: number[]; startDate?: string; endDate?: string; pricePaise?: number; adjustmentBps?: number; priority?: number }[];
}

export interface HostelSpec {
  ownerId?: string; name?: string; city?: string; state?: string; locality?: string | null; lat?: number; lng?: number;
  status?: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'SUSPENDED' | 'REJECTED'; deleted?: boolean;
  propertyType?: 'HOSTEL' | 'PG'; bookingMode?: 'INSTANT' | 'APPROVAL'; genderPolicy?: 'MIXED' | 'MALE_ONLY' | 'FEMALE_ONLY';
  cancellationPolicy?: 'FLEXIBLE' | 'MODERATE' | 'STRICT'; amenities?: string[]; rating?: number; reviews?: number; rooms?: RoomSpec[];
  photos?: number; approvedAt?: Date; timezone?: string;
}

/** Creates a hostel in any state straight in the database, with rooms, a year of inventory and photos. */
export async function publish(spec: HostelSpec = {}) {
  const ownerId = spec.ownerId ?? (await makeUser({ roles: ['OWNER', 'GUEST'], kyc: 'APPROVED' })).id;
  const name = spec.name ?? uniq('Hostel ');
  for (const code of spec.amenities ?? []) await prisma.amenity.upsert({ where: { code }, update: {}, create: { code, label: code.replace(/_/g, ' ').toLowerCase(), category: 'COMFORT' } });
  const amenityRows = await prisma.amenity.findMany({ where: { code: { in: spec.amenities ?? [] } } });
  const rooms = spec.rooms ?? [{}];
  const status = spec.status ?? 'APPROVED';
  const hostel = await prisma.hostel.create({
    data: {
      ownerId, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${uniq()}`, name, description: 'A lovely place to stay with friendly staff and clean rooms.',
      propertyType: spec.propertyType ?? 'HOSTEL', status, bookingMode: spec.bookingMode ?? 'INSTANT', genderPolicy: spec.genderPolicy ?? 'MIXED',
      cancellationPolicy: spec.cancellationPolicy ?? 'MODERATE', timezone: spec.timezone ?? 'Asia/Kolkata',
      addressLine1: '1 Test Road', phone: '+919800000000', locality: spec.locality === undefined ? 'Old Town' : spec.locality, city: spec.city ?? 'Testville', state: spec.state ?? 'Testland', postalCode: '403001',
      latitude: spec.lat ?? 15.5, longitude: spec.lng ?? 73.8, avgRating: spec.rating ?? 0, reviewCount: spec.reviews ?? 0,
      approvedAt: status === 'APPROVED' ? (spec.approvedAt ?? new Date()) : null, deletedAt: spec.deleted ? new Date() : null,
      amenities: { create: amenityRows.map((a) => ({ amenityId: a.id })) },
      media: { create: Array.from({ length: spec.photos ?? 3 }, (_, i) => ({ publicId: `test/${uniq('p')}/${i}`, url: `https://res.cloudinary.com/testcloud/image/upload/v1/test/${uniq('img')}.jpg`, isCover: i === 0, sortOrder: i })) },
    },
  });
  const created = [];
  for (const r of rooms) {
    const room = await prisma.roomType.create({
      data: {
        hostelId: hostel.id, name: r.name ?? 'Dorm', kind: r.kind ?? 'DORM', gender: r.gender ?? 'MIXED', totalUnits: r.units ?? 6, basePricePaise: r.price ?? 80000,
        maxOccupancyPerUnit: r.occupancy ?? 1, minStayNights: r.minStay ?? 1, maxStayNights: r.maxStay ?? 30, priceUnit: r.priceUnit ?? 'NIGHT',
        priceRules: r.rules ? { create: r.rules.map((x) => ({ type: x.type, weekdays: x.weekdays ?? [], startDate: x.startDate ? D(x.startDate) : null, endDate: x.endDate ? D(x.endDate) : null, pricePaise: x.pricePaise ?? null, adjustmentBps: x.adjustmentBps ?? null, priority: x.priority ?? 0 })) } : undefined,
      },
    });
    await ensureInventory(prisma, room.id, room.totalUnits, TODAY);
    created.push(room);
  }
  const min = Math.min(...rooms.map((r) => (r.priceUnit === 'MONTH' ? Math.round((r.price ?? 80000) / 30) : (r.price ?? 80000))));
  await prisma.hostel.update({ where: { id: hostel.id }, data: { minPricePaise: min } });
  return { hostel: { ...hostel, minPricePaise: min }, rooms: created, ownerId };
}

/** Marks units as booked on [from, to) for a room type (inventory only; no booking row). */
export async function consume(roomTypeId: string, from: string, to: string, units: number) {
  await prisma.inventoryNight.updateMany({ where: { roomTypeId, date: { gte: D(from), lt: D(to) } }, data: { bookedUnits: units } });
  await invalidateInventory();
}
