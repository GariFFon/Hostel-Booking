import { z } from 'zod';
import { amenityDtoSchema, mediaDtoSchema } from '@/modules/listings.dto';

export const publicRoomTypeSchema = z.strictObject({
  id: z.uuid(), name: z.string(), description: z.string().nullable(), kind: z.enum(['DORM', 'PRIVATE']), gender: z.enum(['MIXED', 'MALE', 'FEMALE']),
  capacity: z.number().int(), maxOccupancyPerUnit: z.number().int(), minStayNights: z.number().int(), maxStayNights: z.number().int(),
  priceUnit: z.enum(['NIGHT', 'MONTH']), fromPricePaise: z.number().int(), media: z.array(mediaDtoSchema),
});

export const publicHostelSchema = z.strictObject({
  id: z.uuid(), slug: z.string(), name: z.string(), description: z.string(), propertyType: z.enum(['HOSTEL', 'PG']),
  bookingMode: z.enum(['INSTANT', 'APPROVAL']), genderPolicy: z.enum(['MIXED', 'MALE_ONLY', 'FEMALE_ONLY']),
  cancellation: z.strictObject({ policy: z.enum(['FLEXIBLE', 'MODERATE', 'STRICT']), summary: z.string() }),
  address: z.strictObject({ line1: z.string(), line2: z.string().nullable(), locality: z.string().nullable(), city: z.string(), state: z.string(), postalCode: z.string(), country: z.string() }),
  location: z.strictObject({ latitude: z.number(), longitude: z.number() }),
  checkInTime: z.string(), checkOutTime: z.string(), houseRules: z.string().nullable(), currency: z.string(), timezone: z.string(),
  host: z.strictObject({ name: z.string().nullable() }),
  amenities: z.array(amenityDtoSchema.omit({ id: true })), media: z.array(mediaDtoSchema), roomTypes: z.array(publicRoomTypeSchema),
  avgRating: z.number(), reviewCount: z.number().int(), fromPricePaise: z.number().int().nullable(),
  tax: z.strictObject({ lowBps: z.number().int(), highBps: z.number().int(), thresholdPaise: z.number().int(), note: z.string() }),
});

const roomAvailability = z.strictObject({
  roomTypeId: z.uuid(), name: z.string(), kind: z.enum(['DORM', 'PRIVATE']), availableUnits: z.number().int(), eligible: z.boolean(),
  reason: z.enum(['MIN_STAY', 'MAX_STAY', 'SOLD_OUT']).nullable(), avgNightlyPaise: z.number().int().nullable(), stayPerUnitPaise: z.number().int().nullable(),
});
export const availabilitySchema = z.strictObject({
  hostelId: z.uuid(), checkIn: z.string(), checkOut: z.string(), nights: z.number().int(), guests: z.number().int(), canHost: z.boolean(), rooms: z.array(roomAvailability),
});
export const priceCalendarSchema = z.array(z.strictObject({
  roomTypeId: z.uuid(), name: z.string(), nights: z.array(z.strictObject({ date: z.string(), available: z.number().int(), unitPricePaise: z.number().int() })),
}));
