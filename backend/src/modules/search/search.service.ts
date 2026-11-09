import { Prisma } from '@/generated/prisma/client';
import { diffDays } from '@/core/dates';
import { Errors } from '@/core/errors/app-error';
import { cached, hashKey } from '@/infra/cache/cache';
import { ns } from '@/infra/cache/invalidation';
import { prisma } from '@/infra/db/prisma';
import { transformUrl } from '@/infra/cloudinary/storage';
import { taxPolicy } from '@/modules/pricing/pricing.config';
import { nightlyUnitPrice } from '@/modules/pricing/pricing.engine';
import { availabilityFor, stayNights, toRuleInput } from '@/modules/pricing/quote.service';
import type { MapQuery, SearchFilters, SearchQuery, Sort } from './search.schema';

const { sql, join, empty } = Prisma;

// ───────────────────────── filters → SQL ─────────────────────────

function parseBbox(bbox: string) {
  const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number) as [number, number, number, number];
  return { minLng, minLat, maxLng, maxLat };
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function distanceSql(f: SearchFilters) {
  return f.lat !== undefined && f.lng !== undefined ? sql`earth_distance(ll_to_earth(${f.lat}::float8, ${f.lng}::float8), ll_to_earth(h.latitude, h.longitude))` : null;
}

/** Room-level predicate shared by the "has a matching room" and availability checks. */
function roomPredicate(f: SearchFilters) {
  const parts: Prisma.Sql[] = [sql`rt.hostel_id = h.id`, sql`rt.is_active`, sql`rt.deleted_at IS NULL`];
  if (f.roomKind) parts.push(sql`rt.kind = ${f.roomKind}::"RoomKind"`);
  if (f.gender) parts.push(sql`rt.gender IN (${f.gender}::"RoomGender", 'MIXED'::"RoomGender")`);
  return parts;
}

export function buildWhere(f: SearchFilters): Prisma.Sql[] {
  const where: Prisma.Sql[] = [sql`h.status = 'APPROVED'::"HostelStatus"`, sql`h.deleted_at IS NULL`];

  if (f.city) where.push(sql`lower(h.city) = lower(${f.city})`);
  if (f.q) {
    const like = `%${likeEscape(f.q.toLowerCase())}%`;
    // Only columns with trigram indexes (name, city, locality): one unindexed column would force a sequential scan for the whole OR.
    where.push(sql`(lower(h.name) LIKE ${like} OR lower(h.city) LIKE ${like} OR lower(h.locality) LIKE ${like}
      OR lower(h.name) % lower(${f.q}) OR lower(h.city) % lower(${f.q}))`);
  }
  if (f.lat !== undefined && f.lng !== undefined) {
    const meters = f.radiusKm * 1000;
    where.push(sql`earth_box(ll_to_earth(${f.lat}::float8, ${f.lng}::float8), ${meters}::float8) @> ll_to_earth(h.latitude, h.longitude)`);
    where.push(sql`${distanceSql(f)} <= ${meters}::float8`);
  }
  if (f.bbox) {
    const b = parseBbox(f.bbox);
    where.push(sql`h.latitude BETWEEN ${b.minLat}::float8 AND ${b.maxLat}::float8 AND h.longitude BETWEEN ${b.minLng}::float8 AND ${b.maxLng}::float8`);
  }
  if (f.propertyType) where.push(sql`h.property_type = ${f.propertyType}::"PropertyType"`);
  if (f.minPrice !== undefined) where.push(sql`h.min_price_paise >= ${f.minPrice}`);
  if (f.maxPrice !== undefined) where.push(sql`h.min_price_paise <= ${f.maxPrice}`);
  if (f.minRating !== undefined) where.push(sql`h.avg_rating >= ${f.minRating}::float8`);
  if (f.instantBook) where.push(sql`h.booking_mode = 'INSTANT'::"BookingMode"`);
  if (f.gender === 'MALE') where.push(sql`h.gender_policy <> 'FEMALE_ONLY'::"GenderPolicy"`);
  if (f.gender === 'FEMALE') where.push(sql`h.gender_policy <> 'MALE_ONLY'::"GenderPolicy"`);
  if (f.amenities?.length) {
    where.push(sql`(SELECT count(DISTINCT a.code) FROM hostel_amenities ha JOIN amenities a ON a.id = ha.amenity_id
      WHERE ha.hostel_id = h.id AND a.code = ANY(${f.amenities}::text[])) = ${f.amenities.length}`);
  }

  if (f.checkIn && f.checkOut) {
    // Enough free capacity across matching rooms for the whole stay (every night must have an inventory row).
    const nights = diffDays(f.checkIn, f.checkOut);
    where.push(sql`(
      SELECT COALESCE(SUM(GREATEST(a.units, 0) * rt.max_occupancy_per_unit), 0)
      FROM room_types rt
      JOIN LATERAL (
        SELECT min(i.total_units - i.held_units - i.booked_units - i.blocked_units)::int AS units, count(*)::int AS n
        FROM inventory_nights i WHERE i.room_type_id = rt.id AND i.date >= ${f.checkIn}::date AND i.date < ${f.checkOut}::date
      ) a ON a.n = ${nights}
      WHERE ${join(roomPredicate(f), ' AND ')} AND ${nights} BETWEEN rt.min_stay_nights AND rt.max_stay_nights
    ) >= ${f.guests}`);
  } else if (f.roomKind || f.gender) {
    where.push(sql`EXISTS (SELECT 1 FROM room_types rt WHERE ${join(roomPredicate(f), ' AND ')})`);
  }
  return where;
}

/** Integer sort keys: no float round-trip problems in cursors. `dir` is the SQL direction for (key, id). */
function sortSpec(sort: Sort, f: SearchFilters): { key: Prisma.Sql; dir: 'ASC' | 'DESC'; effective: Sort } {
  const dist = distanceSql(f);
  switch (sort) {
    case 'price_asc': return { key: sql`COALESCE(h.min_price_paise, 2147483647)::bigint`, dir: 'ASC', effective: sort };
    case 'price_desc': return { key: sql`COALESCE(h.min_price_paise, 0)::bigint`, dir: 'DESC', effective: sort };
    case 'rating': return { key: sql`(round(h.avg_rating * 100) * 100000 + LEAST(h.review_count, 99999))::bigint`, dir: 'DESC', effective: sort };
    case 'newest': return { key: sql`extract(epoch FROM COALESCE(h.approved_at, h.created_at))::bigint`, dir: 'DESC', effective: sort };
    case 'distance': return { key: sql`round(${dist})::bigint`, dir: 'ASC', effective: sort };
    case 'relevance': return { key: sql`round(GREATEST(similarity(lower(h.name), lower(${f.q}))::float8, similarity(lower(h.city), lower(${f.q}))::float8 * 0.8, similarity(lower(COALESCE(h.locality, '')), lower(${f.q}))::float8 * 0.6) * 1000)::bigint`, dir: 'DESC', effective: sort };
    default: return { key: sql`round(h.avg_rating * ln(1 + h.review_count) * 1000)::bigint`, dir: 'DESC', effective: 'recommended' };
  }
}

// ───────────────────────── cursors ─────────────────────────

interface Cursor { s: Sort; k: string; id: string }
const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor(raw: string, sort: Sort): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Cursor;
    if (c.s !== sort || !/^-?\d+$/.test(c.k) || !/^[0-9a-f-]{36}$/i.test(c.id)) throw new Error('bad');
    return c;
  } catch {
    throw Errors.validation([{ path: 'cursor', message: 'Invalid or mismatched cursor. Restart from the first page.' }]);
  }
}

// ───────────────────────── queries ─────────────────────────

interface Row { id: string; sort_key_text: string; dist_m: number | null }

const baseSelect = (f: SearchFilters, key: Prisma.Sql) => {
  const dist = distanceSql(f);
  return sql`SELECT h.id::text AS id, ${key} AS sort_key, ${dist ? sql`${dist}` : sql`NULL::float8`} AS dist_m FROM hostels h WHERE ${join(buildWhere(f), ' AND ')}`;
};

export interface SearchItem {
  id: string; slug: string; name: string; propertyType: 'HOSTEL' | 'PG'; city: string; state: string; locality: string | null;
  location: { latitude: number; longitude: number }; distanceKm: number | null; coverUrl: string | null; photoUrls: string[]; amenityCodes: string[];
  roomKinds: ('DORM' | 'PRIVATE')[]; fromPricePaise: number | null; stayFromPricePaise: number | null; currency: string; avgRating: number; reviewCount: number;
  bookingMode: 'INSTANT' | 'APPROVAL'; genderPolicy: 'MIXED' | 'MALE_ONLY' | 'FEMALE_ONLY'; cancellationPolicy: 'FLEXIBLE' | 'MODERATE' | 'STRICT';
}

async function hydrate(rows: Row[], f: SearchFilters): Promise<SearchItem[]> {
  if (rows.length === 0) return [];
  const hostels = await prisma.hostel.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    include: {
      media: { where: { deletedAt: null, roomTypeId: null }, orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }], take: 4 },
      amenities: { include: { amenity: { select: { code: true } } } },
      roomTypes: { where: { isActive: true, deletedAt: null }, include: { priceRules: { where: { isActive: true } } } },
    },
  });
  const byId = new Map(hostels.map((h) => [h.id, h]));

  // With dates, show the real average nightly price of the cheapest room that can host the stay.
  let avail: Map<string, number> | null = null;
  const nights = f.checkIn && f.checkOut ? stayNights(f.checkIn, f.checkOut) : null;
  if (nights && f.checkIn && f.checkOut) avail = await availabilityFor(prisma, hostels.flatMap((h) => h.roomTypes.map((r) => r.id)), f.checkIn, f.checkOut);

  return rows.flatMap((row) => {
    const h = byId.get(row.id);
    if (!h) return [];
    const perNightBase = (r: (typeof h.roomTypes)[number]) => (r.priceUnit === 'MONTH' ? Math.round(r.basePricePaise / 30) : r.basePricePaise);
    const fromPrice = h.roomTypes.length ? Math.min(...h.roomTypes.map(perNightBase)) : h.minPricePaise;
    let stayFrom: number | null = null;
    if (nights && avail) {
      const eligible = h.roomTypes.filter((r) => (avail!.get(r.id) ?? 0) >= 1 && nights.length >= r.minStayNights && nights.length <= r.maxStayNights);
      const avgs = eligible.map((r) => Math.round(nights.reduce((s, d) => s + nightlyUnitPrice({ basePricePaise: r.basePricePaise, priceUnit: r.priceUnit, rules: r.priceRules.map(toRuleInput) }, d).unitPricePaise, 0) / nights.length));
      stayFrom = avgs.length ? Math.min(...avgs) : null;
    }
    const photos = h.media.map((m) => transformUrl(m.url, 'c_fill,w_640,h_480,f_auto,q_auto'));
    return [{
      id: h.id, slug: h.slug, name: h.name, propertyType: h.propertyType, city: h.city, state: h.state, locality: h.locality,
      location: { latitude: h.latitude, longitude: h.longitude }, distanceKm: row.dist_m === null ? null : Math.round((row.dist_m / 1000) * 10) / 10,
      coverUrl: photos[0] ?? null, photoUrls: photos, amenityCodes: h.amenities.map((a) => a.amenity.code).sort(), roomKinds: [...new Set(h.roomTypes.map((r) => r.kind))].sort() as ('DORM' | 'PRIVATE')[],
      fromPricePaise: fromPrice, stayFromPricePaise: stayFrom, currency: h.currency, avgRating: h.avgRating, reviewCount: h.reviewCount,
      bookingMode: h.bookingMode, genderPolicy: h.genderPolicy, cancellationPolicy: h.cancellationPolicy,
    }];
  });
}

export interface SearchPage { items: SearchItem[]; nextCursor: string | null; total: number | null }

async function runSearch(q: SearchQuery): Promise<SearchPage> {
  const wanted: Sort = q.sort ?? (q.q ? 'relevance' : q.lat !== undefined ? 'distance' : 'recommended');
  const { key, dir, effective } = sortSpec(wanted, q);
  const cursor = q.cursor ? decodeCursor(q.cursor, effective) : null;
  const cmp = dir === 'ASC' ? sql`>` : sql`<`;
  const order = dir === 'ASC' ? sql`ASC` : sql`DESC`;

  const rows = await prisma.$queryRaw<Row[]>(sql`
    WITH base AS (${baseSelect(q, key)})
    SELECT id, sort_key::text AS sort_key_text, dist_m FROM base   -- NB: never alias to "sort_key": ORDER BY would then sort the text alias
    ${cursor ? sql`WHERE (sort_key, id::uuid) ${cmp} (${cursor.k}::bigint, ${cursor.id}::uuid)` : empty}
    ORDER BY sort_key ${order}, id::uuid ${order}
    LIMIT ${q.limit + 1}`);

  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const total = cursor ? null : Number((await prisma.$queryRaw<{ n: bigint }[]>(sql`SELECT count(*) AS n FROM hostels h WHERE ${join(buildWhere(q), ' AND ')}`))[0]!.n);
  return {
    items: await hydrate(page, q),
    nextCursor: rows.length > q.limit && last ? encodeCursor({ s: effective, k: last.sort_key_text, id: last.id }) : null,
    total,
  };
}

/** Undated searches change only when listings change; dated ones also when inventory moves. */
export const searchService = {
  async search(q: SearchQuery) {
    // Dated results also depend on live inventory, so they are invalidated on every hold/booking/block (see invalidateInventory).
    const dated = Boolean(q.checkIn);
    return cached({ ns: dated ? [ns.search, ns.inventory] : [ns.search], key: `s:${hashKey(q)}`, ttlSeconds: dated ? 120 : 300 }, () => runSearch(q));
  },

  async map(q: MapQuery) {
    return cached({ ns: q.checkIn ? [ns.search, ns.inventory] : [ns.search], key: `m:${hashKey(q)}`, ttlSeconds: q.checkIn ? 120 : 120 }, async () => {
      const rows = await prisma.$queryRaw<{ id: string; slug: string; name: string; property_type: 'HOSTEL' | 'PG'; latitude: number; longitude: number; min_price_paise: number | null; avg_rating: number; review_count: number }[]>(sql`
        SELECT h.id::text AS id, h.slug, h.name, h.property_type, h.latitude, h.longitude, h.min_price_paise, h.avg_rating, h.review_count
        FROM hostels h WHERE ${join(buildWhere(q), ' AND ')}
        ORDER BY h.avg_rating DESC, h.id LIMIT ${q.limit}`);
      return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, propertyType: r.property_type, latitude: r.latitude, longitude: r.longitude, fromPricePaise: r.min_price_paise, avgRating: r.avg_rating, reviewCount: r.review_count }));
    });
  },

  async suggest(q: string) {
    return cached({ ns: [ns.search], key: `g:${q.toLowerCase()}`, ttlSeconds: 300 }, async () => {
      const like = `${likeEscape(q.toLowerCase())}%`;
      const contains = `%${likeEscape(q.toLowerCase())}%`;
      const [cities, hostels] = await Promise.all([
        prisma.$queryRaw<{ city: string; state: string; count: bigint }[]>(sql`
          SELECT min(city) AS city, min(state) AS state, count(*) AS count FROM hostels
          WHERE status = 'APPROVED'::"HostelStatus" AND deleted_at IS NULL AND (lower(city) LIKE ${like} OR lower(city) % lower(${q}))
          GROUP BY lower(city) ORDER BY count(*) DESC, min(city) LIMIT 5`),
        prisma.$queryRaw<{ id: string; slug: string; name: string; city: string }[]>(sql`
          SELECT id::text AS id, slug, name, city FROM hostels
          WHERE status = 'APPROVED'::"HostelStatus" AND deleted_at IS NULL AND (lower(name) LIKE ${contains} OR lower(name) % lower(${q}))
          ORDER BY (lower(name) LIKE ${like}) DESC, similarity(lower(name), lower(${q})) DESC, avg_rating DESC LIMIT 6`),
      ]);
      return { cities: cities.map((c) => ({ city: c.city, state: c.state, count: Number(c.count) })), hostels };
    });
  },

  async cities() {
    return cached({ ns: [ns.cities], key: 'all', ttlSeconds: 600 }, async () => {
      const rows = await prisma.$queryRaw<{ city: string; state: string; count: bigint; lat: number; lng: number; min_price: number | null }[]>(sql`
        SELECT min(city) AS city, min(state) AS state, count(*) AS count, avg(latitude) AS lat, avg(longitude) AS lng, min(min_price_paise) AS min_price
        FROM hostels WHERE status = 'APPROVED'::"HostelStatus" AND deleted_at IS NULL
        GROUP BY lower(city) ORDER BY count(*) DESC, min(city) LIMIT 50`);
      return rows.map((r) => ({ city: r.city, state: r.state, count: Number(r.count), latitude: r.lat, longitude: r.lng, fromPricePaise: r.min_price }));
    });
  },
};
