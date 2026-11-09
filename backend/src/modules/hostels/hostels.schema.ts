import { z } from 'zod';
import { isValidTimezone } from '@/core/dates';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm');
const gstin = z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN');
const phone = z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a phone number in international format');

export const propertyTypeSchema = z.enum(['HOSTEL', 'PG']);
export const hostelStatusSchema = z.enum(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']);

/** Default-free fields: used as-is for updates (partial), and extended with defaults for creation. */
const hostelFields = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().min(20, 'Describe your property in at least 20 characters').max(4000),
  propertyType: propertyTypeSchema,
  bookingMode: z.enum(['INSTANT', 'APPROVAL']),
  cancellationPolicy: z.enum(['FLEXIBLE', 'MODERATE', 'STRICT']),
  genderPolicy: z.enum(['MIXED', 'MALE_ONLY', 'FEMALE_ONLY']),
  timezone: z.string().refine(isValidTimezone, 'Unknown timezone'),
  addressLine1: z.string().trim().min(3).max(200),
  addressLine2: z.string().trim().max(200).nullish(),
  locality: z.string().trim().max(100).nullish(),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().regex(/^[A-Za-z0-9 -]{3,10}$/, 'Invalid postal code'),
  country: z.string().trim().toUpperCase().length(2),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  phone: phone.nullish(),
  contactEmail: z.email().max(254).nullish(),
  checkInTime: hhmm,
  checkOutTime: hhmm,
  houseRules: z.string().trim().max(3000).nullish(),
  gstin: gstin.nullish(),
  amenityCodes: z.array(z.string().trim().toUpperCase().min(2).max(40)).max(40),
});

const indiaPostal = (v: { country?: string; postalCode?: string }, ctx: z.RefinementCtx) => {
  if (v.country === 'IN' && v.postalCode !== undefined && !/^\d{6}$/.test(v.postalCode)) {
    ctx.addIssue({ code: 'custom', path: ['postalCode'], message: 'Indian PIN codes have 6 digits' });
  }
};

export const createHostelSchema = hostelFields
  .extend({
    propertyType: hostelFields.shape.propertyType.default('HOSTEL'),
    bookingMode: hostelFields.shape.bookingMode.default('INSTANT'),
    cancellationPolicy: hostelFields.shape.cancellationPolicy.default('MODERATE'),
    genderPolicy: hostelFields.shape.genderPolicy.default('MIXED'),
    timezone: hostelFields.shape.timezone.default('Asia/Kolkata'),
    country: hostelFields.shape.country.default('IN'),
    checkInTime: hostelFields.shape.checkInTime.default('14:00'),
    checkOutTime: hostelFields.shape.checkOutTime.default('11:00'),
    amenityCodes: hostelFields.shape.amenityCodes.default([]),
  })
  .superRefine(indiaPostal);
export const updateHostelSchema = hostelFields
  .partial()
  .extend({ expectedVersion: z.number().int().positive().optional() })
  .strict()
  .superRefine(indiaPostal)
  .refine((v) => Object.keys(v).some((k) => k !== 'expectedVersion'), 'Provide at least one field to update');

export const listOwnerHostelsQuerySchema = z.object({ status: hostelStatusSchema.optional() });

export const reasonSchema = z.object({ reason: z.string().trim().min(10, 'Please give at least 10 characters').max(1000) });

export type CreateHostelInput = z.infer<typeof createHostelSchema>;
export type UpdateHostelInput = z.infer<typeof updateHostelSchema>;
