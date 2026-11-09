import { z } from 'zod';
import { paginationSchema } from '@/core/http/pagination';

export const wishlistQuerySchema = paginationSchema;

export const wishlistItemSchema = z.strictObject({
  savedAt: z.iso.datetime(),
  hostel: z.strictObject({
    id: z.uuid(), slug: z.string(), name: z.string(), propertyType: z.enum(['HOSTEL', 'PG']), city: z.string(), state: z.string(), locality: z.string().nullable(),
    coverUrl: z.string().nullable(), fromPricePaise: z.number().int().nullable(), currency: z.string(), avgRating: z.number(), reviewCount: z.number().int(),
    bookingMode: z.enum(['INSTANT', 'APPROVAL']), genderPolicy: z.enum(['MIXED', 'MALE_ONLY', 'FEMALE_ONLY']),
  }),
});

/** Every saved hostel id (at most 500), so clients can draw the heart on cached/public search results. */
export const wishlistIdsSchema = z.strictObject({ hostelIds: z.array(z.uuid()) });
export const wishlistStateSchema = z.strictObject({ hostelId: z.uuid(), saved: z.boolean() });
