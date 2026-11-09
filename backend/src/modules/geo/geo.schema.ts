import { z } from 'zod';

export const geoSearchQuerySchema = z.object({ q: z.string().trim().min(3).max(150), limit: z.coerce.number().int().min(1).max(8).default(5) });
export const geoReverseQuerySchema = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

export const placeSchema = z.strictObject({
  label: z.string(), latitude: z.number(), longitude: z.number(), locality: z.string().nullable(), city: z.string().nullable(),
  state: z.string().nullable(), postalCode: z.string().nullable(), country: z.string().nullable(),
});
export type Place = z.infer<typeof placeSchema>;
