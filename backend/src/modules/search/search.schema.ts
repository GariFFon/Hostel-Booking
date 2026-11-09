import { z } from 'zod';
import { addDays, diffDays, isDateString, todayIn } from '@/core/dates';
import { MAX_STAY_NIGHTS } from '@/modules/pricing/quote.schema';

const csv = z.string().max(500).transform((s) => [...new Set(s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))]);
const date = z.string().refine(isDateString, 'Use YYYY-MM-DD');
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const num = (min: number, max: number) => z.coerce.number().min(min).max(max);

export const SORTS = ['recommended', 'relevance', 'price_asc', 'price_desc', 'rating', 'distance', 'newest'] as const;
export type Sort = (typeof SORTS)[number];

const filterShape = {
  q: z.string().trim().min(1).max(100).optional(),
  city: z.string().trim().min(1).max(80).optional(),
  lat: num(-90, 90).optional(),
  lng: num(-180, 180).optional(),
  radiusKm: num(0.5, 200).default(25),
  /** minLng,minLat,maxLng,maxLat (map viewport) */
  bbox: z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/, 'Use minLng,minLat,maxLng,maxLat').optional(),
  checkIn: date.optional(),
  checkOut: date.optional(),
  guests: z.coerce.number().int().min(1).max(30).default(1),
  minPrice: z.coerce.number().int().min(0).optional(), // paise per night
  maxPrice: z.coerce.number().int().min(0).optional(),
  amenities: csv.optional(),
  propertyType: z.enum(['HOSTEL', 'PG']).optional(),
  roomKind: z.enum(['DORM', 'PRIVATE']).optional(),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  minRating: num(0, 5).optional(),
  instantBook: bool.optional(),
};

type Filters = z.infer<z.ZodObject<typeof filterShape>>;

function validateFilters(v: Filters, ctx: z.RefinementCtx) {
  const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if ((v.lat === undefined) !== (v.lng === undefined)) bad('lat', 'Provide both lat and lng');
  if ((v.checkIn === undefined) !== (v.checkOut === undefined)) bad('checkIn', 'Provide both checkIn and checkOut');
  if (v.checkIn && v.checkOut) {
    const nights = diffDays(v.checkIn, v.checkOut);
    if (nights < 1) bad('checkOut', 'Check-out must be after check-in');
    else if (nights > MAX_STAY_NIGHTS) bad('checkOut', `Stays are limited to ${MAX_STAY_NIGHTS} nights`);
    if (v.checkIn < addDays(todayIn('Asia/Kolkata'), -1)) bad('checkIn', 'Check-in cannot be in the past'); // one day of timezone slack
  }
  if (v.minPrice !== undefined && v.maxPrice !== undefined && v.minPrice > v.maxPrice) bad('minPrice', 'minPrice must not exceed maxPrice');
  if (v.bbox) {
    const [minLng, minLat, maxLng, maxLat] = v.bbox.split(',').map(Number) as [number, number, number, number];
    if (minLat >= maxLat || minLng >= maxLng || Math.abs(minLat) > 90 || Math.abs(maxLat) > 90 || Math.abs(minLng) > 180 || Math.abs(maxLng) > 180) bad('bbox', 'Invalid bounding box');
  }
}

export const searchQuerySchema = z
  .object({
    ...filterShape,
    sort: z.enum(SORTS).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    validateFilters(v, ctx);
    if (v.sort === 'distance' && v.lat === undefined) ctx.addIssue({ code: 'custom', path: ['sort'], message: 'Sorting by distance needs lat and lng' });
    if (v.sort === 'relevance' && !v.q) ctx.addIssue({ code: 'custom', path: ['sort'], message: 'Relevance sorting needs q' });
  });

export const mapQuerySchema = z
  .object({ ...filterShape, bbox: filterShape.bbox.unwrap(), limit: z.coerce.number().int().min(1).max(300).default(150) })
  .superRefine(validateFilters);

export const suggestQuerySchema = z.object({ q: z.string().trim().min(2).max(60) });

export const availabilityQuerySchema = z
  .object({ checkIn: date, checkOut: date, guests: z.coerce.number().int().min(1).max(30).default(1) })
  .superRefine((v, ctx) => {
    const n = diffDays(v.checkIn, v.checkOut);
    if (n < 1) ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Check-out must be after check-in' });
    else if (n > MAX_STAY_NIGHTS) ctx.addIssue({ code: 'custom', path: ['checkOut'], message: `Stays are limited to ${MAX_STAY_NIGHTS} nights` });
  });

export const calendarQuerySchema = z
  .object({ from: date, to: date })
  .superRefine((v, ctx) => {
    const n = diffDays(v.from, v.to);
    if (n < 0) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must not be before from' });
    else if (n > 92) ctx.addIssue({ code: 'custom', path: ['to'], message: 'The range is limited to 93 days' });
  });

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type MapQuery = z.infer<typeof mapQuerySchema>;
export type SearchFilters = Filters;

// ---- response contracts ----
export const searchItemSchema = z.strictObject({
  id: z.uuid(), slug: z.string(), name: z.string(), propertyType: z.enum(['HOSTEL', 'PG']), city: z.string(), state: z.string(), locality: z.string().nullable(),
  location: z.strictObject({ latitude: z.number(), longitude: z.number() }), distanceKm: z.number().nullable(),
  coverUrl: z.string().nullable(), photoUrls: z.array(z.string()), amenityCodes: z.array(z.string()), roomKinds: z.array(z.enum(['DORM', 'PRIVATE'])),
  fromPricePaise: z.number().int().nullable(), stayFromPricePaise: z.number().int().nullable(), currency: z.string(),
  avgRating: z.number(), reviewCount: z.number().int(), bookingMode: z.enum(['INSTANT', 'APPROVAL']), genderPolicy: z.enum(['MIXED', 'MALE_ONLY', 'FEMALE_ONLY']),
  cancellationPolicy: z.enum(['FLEXIBLE', 'MODERATE', 'STRICT']),
});
export const mapMarkerSchema = z.strictObject({
  id: z.uuid(), slug: z.string(), name: z.string(), propertyType: z.enum(['HOSTEL', 'PG']), latitude: z.number(), longitude: z.number(),
  fromPricePaise: z.number().int().nullable(), avgRating: z.number(), reviewCount: z.number().int(),
});
export const suggestResponseSchema = z.strictObject({
  cities: z.array(z.strictObject({ city: z.string(), state: z.string(), count: z.number().int() })),
  hostels: z.array(z.strictObject({ id: z.uuid(), slug: z.string(), name: z.string(), city: z.string() })),
});
export const cityItemSchema = z.strictObject({ city: z.string(), state: z.string(), count: z.number().int(), latitude: z.number(), longitude: z.number(), fromPricePaise: z.number().int().nullable() });
