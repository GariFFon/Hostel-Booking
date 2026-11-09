import { env } from '@/core/config/env';
import { AppError } from '@/core/errors/app-error';
import { rateLimit } from '@/core/rate-limit/rate-limit';
import { cached } from '@/infra/cache/cache';
import type { Place } from './geo.schema';

interface NominatimItem {
  display_name: string; lat: string; lon: string;
  address?: { suburb?: string; neighbourhood?: string; city_district?: string; city?: string; town?: string; village?: string; municipality?: string; county?: string; state?: string; postcode?: string; country_code?: string };
}

export function normalizePlace(i: NominatimItem): Place {
  const a = i.address ?? {};
  return {
    label: i.display_name, latitude: Number(i.lat), longitude: Number(i.lon),
    locality: a.suburb ?? a.neighbourhood ?? a.city_district ?? null,
    city: a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? null,
    state: a.state ?? null, postalCode: a.postcode ?? null, country: a.country_code?.toUpperCase() ?? null,
  };
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...args) => fetch(...args);
/** Test seam. */
export function setGeoFetch(f: Fetch | null) {
  fetchImpl = f ?? ((...args) => fetch(...args));
}

/**
 * OpenStreetMap Nominatim's usage policy: identify the app, at most 1 request/second, cache results.
 * Everything here is cached for a day, and uncached calls share one global 1 req/s limiter.
 */
async function nominatim<T>(path: string, params: Record<string, string>): Promise<T> {
  await rateLimit({ bucket: 'nominatim:global', limit: 1, windowSeconds: 1 });
  const e = env();
  const url = `${e.GEOCODER_BASE_URL}${path}?${new URLSearchParams({ format: 'jsonv2', addressdetails: '1', ...params })}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': e.GEOCODER_USER_AGENT, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(4000) });
  } catch {
    throw new AppError('DEPENDENCY_UNAVAILABLE', 'Address lookup is temporarily unavailable');
  }
  if (!res.ok) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Address lookup is temporarily unavailable');
  return (await res.json()) as T;
}

export const geoService = {
  async search(q: string, limit: number) {
    return cached({ ns: ['geo'], key: `s:${q.toLowerCase()}:${limit}`, ttlSeconds: 86_400 }, async () => {
      const items = await nominatim<NominatimItem[]>('/search', { q, limit: String(limit), countrycodes: env().GEOCODER_COUNTRY_CODES });
      return items.map(normalizePlace);
    });
  },

  async reverse(lat: number, lng: number) {
    // ~11 m grid so nearby taps share a cache entry
    const key = `r:${lat.toFixed(4)},${lng.toFixed(4)}`;
    return cached({ ns: ['geo'], key, ttlSeconds: 86_400 }, async () => {
      const item = await nominatim<NominatimItem & { error?: string }>('/reverse', { lat: lat.toFixed(6), lon: lng.toFixed(6), zoom: '18' });
      return item.error ? null : normalizePlace(item);
    });
  },
};
