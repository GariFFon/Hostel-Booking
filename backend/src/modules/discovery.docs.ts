import { z } from 'zod';
import { documentRoute } from '@/core/openapi/registry';
import { geoReverseQuerySchema, geoSearchQuerySchema, placeSchema } from '@/modules/geo/geo.schema';
import { availabilitySchema, priceCalendarSchema, publicHostelSchema } from '@/modules/hostels/public-hostels.schema';
import { quoteDtoSchema, quoteRequestSchema } from '@/modules/pricing/quote.schema';
import {
  availabilityQuerySchema, calendarQuerySchema, cityItemSchema, mapMarkerSchema, mapQuerySchema, searchItemSchema, searchQuerySchema, suggestQuerySchema, suggestResponseSchema,
} from '@/modules/search/search.schema';

const P = ['Discovery'];

documentRoute({ method: 'get', path: '/hostels', summary: 'Search listings (geo, dates, filters, keyset pagination). meta.total is returned on the first page only; X-Cache: HIT|MISS', tags: P, query: searchQuerySchema, response: z.array(searchItemSchema), errors: [] });
documentRoute({ method: 'get', path: '/hostels/map', summary: 'Lightweight map markers inside a bounding box (same filters as search)', tags: P, query: mapQuerySchema, response: z.array(mapMarkerSchema) });
documentRoute({ method: 'get', path: '/hostels/{idOrSlug}', summary: 'Public listing detail by id or slug (cached; invalidated on any change)', tags: P, response: publicHostelSchema, errors: [404] });
documentRoute({ method: 'get', path: '/hostels/{idOrSlug}/availability', summary: 'Availability and stay price per room type for given dates', tags: P, query: availabilityQuerySchema, response: availabilitySchema, errors: [404] });
documentRoute({ method: 'get', path: '/hostels/{idOrSlug}/calendar', summary: 'Per-night availability and unit price (max 93 days), for date pickers', tags: P, query: calendarQuerySchema, response: priceCalendarSchema, errors: [404] });
documentRoute({ method: 'post', path: '/quotes', summary: 'Price a stay: price rules, GST, coupon, cancellation terms. Read-only (holds nothing). Optional bearer token enables per-user coupon limits', tags: P, body: quoteRequestSchema, response: quoteDtoSchema, errors: [404, 409] });
documentRoute({ method: 'get', path: '/search/suggest', summary: 'Autocomplete for cities and listing names', tags: P, query: suggestQuerySchema, response: suggestResponseSchema });
documentRoute({ method: 'get', path: '/cities', summary: 'Cities with listings, most popular first', tags: P, response: z.array(cityItemSchema) });
documentRoute({ method: 'get', path: '/geo/search', summary: 'Address/place search (OpenStreetMap Nominatim, cached 24h, rate limited)', tags: ['Geo'], query: geoSearchQuerySchema, response: z.array(placeSchema), errors: [503] });
documentRoute({ method: 'get', path: '/geo/reverse', summary: 'Coordinates to address; null when nothing is found', tags: ['Geo'], query: geoReverseQuerySchema, response: placeSchema.nullable(), errors: [503] });
