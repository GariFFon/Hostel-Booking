import { Prisma } from '@/generated/prisma/client';
import { addDays, diffDays, toDateString } from '@/core/dates';
import { Errors } from '@/core/errors/app-error';
import { cached } from '@/infra/cache/cache';
import { ns } from '@/infra/cache/invalidation';
import { prisma } from '@/infra/db/prisma';
import { toMediaDto } from '@/modules/media/media.mapper';
import { SUMMARY } from '@/modules/pricing/cancellation-policy';
import { taxPolicy } from '@/modules/pricing/pricing.config';
import { nightlyUnitPrice, type PriceRuleInput } from '@/modules/pricing/pricing.engine';
import { availabilityFor, stayNights, toRuleInput } from '@/modules/pricing/quote.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts a UUID or a slug. Unknown, unpublished and deleted listings are all simply "not found". */
export async function resolvePublicHostelId(idOrSlug: string): Promise<string> {
  const h = await prisma.hostel.findFirst({
    where: { status: 'APPROVED', deletedAt: null, ...(UUID.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug.toLowerCase() }) },
    select: { id: true },
  });
  if (!h) throw Errors.notFound('Hostel');
  return h.id;
}

const perNight = (r: { basePricePaise: number; priceUnit: 'NIGHT' | 'MONTH' }) => (r.priceUnit === 'MONTH' ? Math.round(r.basePricePaise / 30) : r.basePricePaise);

interface RoomInternal { id: string; name: string; kind: 'DORM' | 'PRIVATE'; basePricePaise: number; priceUnit: 'NIGHT' | 'MONTH'; minStayNights: number; maxStayNights: number; maxOccupancyPerUnit: number; rules: PriceRuleInput[] }

/** Cached together: the public DTO plus the pricing inputs needed for dated views. */
async function loadDetail(id: string) {
  const h = await prisma.hostel.findFirstOrThrow({
    where: { id, status: 'APPROVED', deletedAt: null },
    include: {
      amenities: { include: { amenity: true } },
      media: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      roomTypes: { where: { isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { priceRules: { where: { isActive: true } } } },
      owner: { select: { ownerProfile: { select: { businessName: true } }, profile: { select: { fullName: true } } } },
    },
  });
  const tax = taxPolicy();
  const dto = {
    id: h.id, slug: h.slug, name: h.name, description: h.description, propertyType: h.propertyType, bookingMode: h.bookingMode, genderPolicy: h.genderPolicy,
    cancellation: { policy: h.cancellationPolicy, summary: SUMMARY[h.cancellationPolicy] },
    address: { line1: h.addressLine1, line2: h.addressLine2, locality: h.locality, city: h.city, state: h.state, postalCode: h.postalCode, country: h.country },
    location: { latitude: h.latitude, longitude: h.longitude }, checkInTime: h.checkInTime, checkOutTime: h.checkOutTime, houseRules: h.houseRules, currency: h.currency, timezone: h.timezone,
    host: { name: h.owner.ownerProfile?.businessName ?? h.owner.profile?.fullName ?? null }, // never the owner's email/phone
    amenities: h.amenities.map((a) => ({ code: a.amenity.code, label: a.amenity.label, category: a.amenity.category, icon: a.amenity.icon })),
    media: h.media.filter((m) => !m.roomTypeId).map(toMediaDto),
    roomTypes: h.roomTypes.map((r) => ({
      id: r.id, name: r.name, description: r.description, kind: r.kind, gender: r.gender, capacity: r.totalUnits, maxOccupancyPerUnit: r.maxOccupancyPerUnit,
      minStayNights: r.minStayNights, maxStayNights: r.maxStayNights, priceUnit: r.priceUnit, fromPricePaise: perNight(r), media: h.media.filter((m) => m.roomTypeId === r.id).map(toMediaDto),
    })),
    avgRating: h.avgRating, reviewCount: h.reviewCount,
    fromPricePaise: h.roomTypes.length ? Math.min(...h.roomTypes.map(perNight)) : null,
    tax: { ...tax, note: `GST is added at checkout: ${tax.lowBps / 100}% when the nightly price per bed/room is up to ₹${tax.thresholdPaise / 100}, ${tax.highBps / 100}% above.` },
  };
  const rooms: RoomInternal[] = h.roomTypes.map((r) => ({ id: r.id, name: r.name, kind: r.kind, basePricePaise: r.basePricePaise, priceUnit: r.priceUnit, minStayNights: r.minStayNights, maxStayNights: r.maxStayNights, maxOccupancyPerUnit: r.maxOccupancyPerUnit, rules: r.priceRules.map(toRuleInput) }));
  return { dto, rooms };
}

type Detail = Awaited<ReturnType<typeof loadDetail>>;
const getDetail = (id: string) => cached<Detail>({ ns: [ns.hostel(id), ns.amenities], key: 'detail', ttlSeconds: 600 }, () => loadDetail(id));

export const publicHostelsService = {
  async get(idOrSlug: string) {
    const r = await getDetail(await resolvePublicHostelId(idOrSlug));
    return { dto: r.value.dto, hit: r.hit };
  },

  async availability(idOrSlug: string, q: { checkIn: string; checkOut: string; guests: number }) {
    const id = await resolvePublicHostelId(idOrSlug);
    const { value } = await getDetail(id);
    const nights = stayNights(q.checkIn, q.checkOut);
    const avail = await availabilityFor(prisma, value.rooms.map((r) => r.id), q.checkIn, q.checkOut);
    const rooms = value.rooms.map((r) => {
      const availableUnits = avail.get(r.id) ?? 0;
      const reason = nights.length < r.minStayNights ? 'MIN_STAY' : nights.length > r.maxStayNights ? 'MAX_STAY' : availableUnits < 1 ? 'SOLD_OUT' : null;
      const prices = nights.map((d) => nightlyUnitPrice(r, d).unitPricePaise);
      const total = prices.reduce((a, b) => a + b, 0);
      return { roomTypeId: r.id, name: r.name, kind: r.kind, availableUnits, eligible: reason === null, reason: reason as 'MIN_STAY' | 'MAX_STAY' | 'SOLD_OUT' | null, avgNightlyPaise: Math.round(total / nights.length), stayPerUnitPaise: total };
    });
    const capacity = rooms.filter((r) => r.eligible).reduce((s, r) => s + r.availableUnits * value.rooms.find((x) => x.id === r.roomTypeId)!.maxOccupancyPerUnit, 0);
    return { hostelId: id, checkIn: q.checkIn, checkOut: q.checkOut, nights: nights.length, guests: q.guests, canHost: capacity >= q.guests, rooms };
  },

  /** Per-night availability and price, for date pickers. Not cached: it reflects live inventory. */
  async calendar(idOrSlug: string, q: { from: string; to: string }) {
    const id = await resolvePublicHostelId(idOrSlug);
    const { value } = await getDetail(id);
    const ids = value.rooms.map((r) => r.id);
    const rows = ids.length
      ? await prisma.$queryRaw<{ room_type_id: string; date: Date; available: number }[]>(Prisma.sql`
          SELECT room_type_id::text AS room_type_id, date, (total_units - held_units - booked_units - blocked_units)::int AS available
          FROM inventory_nights WHERE room_type_id = ANY(${ids}::uuid[]) AND date BETWEEN ${q.from}::date AND ${q.to}::date`)
      : [];
    const free = new Map(rows.map((r) => [`${r.room_type_id}|${toDateString(r.date)}`, Math.max(0, r.available)]));
    const days = Array.from({ length: diffDays(q.from, q.to) + 1 }, (_, i) => addDays(q.from, i));
    return value.rooms.map((r) => ({ roomTypeId: r.id, name: r.name, nights: days.map((date) => ({ date, available: free.get(`${r.id}|${date}`) ?? 0, unitPricePaise: nightlyUnitPrice(r, date).unitPricePaise })) }));
  },
};

