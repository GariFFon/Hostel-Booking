import { z } from 'zod';

// Response contracts for listing-related endpoints. `strictObject` so tests catch undocumented fields.
const ts = z.iso.datetime();

export const mediaDtoSchema = z.strictObject({
  id: z.uuid(), roomTypeId: z.uuid().nullable(), url: z.string(), thumbUrl: z.string(), cardUrl: z.string(), fullUrl: z.string(),
  altText: z.string().nullable(), width: z.number().nullable(), height: z.number().nullable(), sortOrder: z.number().int(), isCover: z.boolean(),
});

export const roomTypeDtoSchema = z.strictObject({
  id: z.uuid(), hostelId: z.uuid(), name: z.string(), description: z.string().nullable(), kind: z.enum(['DORM', 'PRIVATE']),
  gender: z.enum(['MIXED', 'MALE', 'FEMALE']), totalUnits: z.number().int(), maxOccupancyPerUnit: z.number().int(),
  basePricePaise: z.number().int(), priceUnit: z.enum(['NIGHT', 'MONTH']), minStayNights: z.number().int(), maxStayNights: z.number().int(),
  isActive: z.boolean(), version: z.number().int(), createdAt: ts, updatedAt: ts,
});

export const amenityDtoSchema = z.strictObject({ id: z.uuid(), code: z.string(), label: z.string(), category: z.string(), icon: z.string().nullable() });

export const hostelDtoSchema = z.strictObject({
  id: z.uuid(), ownerId: z.uuid(), slug: z.string(), name: z.string(), description: z.string(),
  propertyType: z.enum(['HOSTEL', 'PG']), status: z.enum(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']),
  bookingMode: z.enum(['INSTANT', 'APPROVAL']), cancellationPolicy: z.enum(['FLEXIBLE', 'MODERATE', 'STRICT']),
  genderPolicy: z.enum(['MIXED', 'MALE_ONLY', 'FEMALE_ONLY']), timezone: z.string(), currency: z.string(),
  address: z.strictObject({ line1: z.string(), line2: z.string().nullable(), locality: z.string().nullable(), city: z.string(), state: z.string(), postalCode: z.string(), country: z.string() }),
  location: z.strictObject({ latitude: z.number(), longitude: z.number() }),
  phone: z.string().nullable(), contactEmail: z.string().nullable(), checkInTime: z.string(), checkOutTime: z.string(),
  houseRules: z.string().nullable(), gstin: z.string().nullable(),
  amenities: z.array(z.strictObject({ code: z.string(), label: z.string(), category: z.string(), icon: z.string().nullable() })),
  media: z.array(mediaDtoSchema), roomTypes: z.array(roomTypeDtoSchema),
  avgRating: z.number(), reviewCount: z.number().int(), minPricePaise: z.number().int().nullable(),
  rejectionReason: z.string().nullable(), approvedAt: ts.nullable(), version: z.number().int(), createdAt: ts, updatedAt: ts,
});

export const hostelSummarySchema = z.strictObject({
  id: z.uuid(), slug: z.string(), name: z.string(), city: z.string(), propertyType: z.enum(['HOSTEL', 'PG']),
  status: z.enum(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']), coverUrl: z.string().nullable(),
  roomTypeCount: z.number().int(), mediaCount: z.number().int(), minPricePaise: z.number().int().nullable(),
  avgRating: z.number(), reviewCount: z.number().int(), rejectionReason: z.string().nullable(), updatedAt: ts,
});

export const priceRuleDtoSchema = z.strictObject({
  id: z.uuid(), roomTypeId: z.uuid(), type: z.enum(['WEEKEND', 'DATE_RANGE']), name: z.string().nullable(), weekdays: z.array(z.number().int()),
  startDate: z.string().nullable(), endDate: z.string().nullable(), pricePaise: z.number().int().nullable(), adjustmentBps: z.number().int().nullable(),
  priority: z.number().int(), isActive: z.boolean(),
});

export const calendarNightSchema = z.strictObject({ date: z.string(), total: z.number().int(), held: z.number().int(), booked: z.number().int(), blocked: z.number().int(), available: z.number().int() });

export const kycDocumentSchema = z.strictObject({ id: z.uuid(), type: z.string(), format: z.string().nullable(), bytes: z.number().nullable(), uploadedAt: ts });
export const ownerKycSchema = z.strictObject({
  businessName: z.string().nullable(), gstin: z.string().nullable(), panLast4: z.string().nullable(),
  kycStatus: z.enum(['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED']), rejectionReason: z.string().nullable(),
  reviewedAt: ts.nullable(), documents: z.array(kycDocumentSchema),
});
export const adminKycSchema = z.strictObject({
  ownerId: z.uuid(), email: z.string(), fullName: z.string().nullable(), phone: z.string().nullable(), businessName: z.string().nullable(),
  gstin: z.string().nullable(), panLast4: z.string().nullable(), kycStatus: z.enum(['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED']), rejectionReason: z.string().nullable(),
  documents: z.array(kycDocumentSchema.extend({ downloadUrl: z.string(), downloadUrlExpiresInSeconds: z.number().int() })),
});
export const adminKycListItemSchema = z.strictObject({ ownerId: z.uuid(), email: z.string(), fullName: z.string().nullable(), businessName: z.string().nullable(), kycStatus: z.string(), documentCount: z.number().int(), updatedAt: ts });

const ownerInfo = z.object({ id: z.uuid(), email: z.string(), profile: z.object({ fullName: z.string(), phone: z.string().nullable() }).nullable(), ownerProfile: z.object({ kycStatus: z.string(), businessName: z.string().nullable() }).nullable() });
export const adminHostelSchema = hostelDtoSchema.extend({ owner: ownerInfo });
export const adminHostelDetailSchema = adminHostelSchema.extend({
  history: z.array(z.strictObject({ id: z.string(), action: z.string(), actorId: z.uuid().nullable(), actorRole: z.string().nullable(), outcome: z.string(), createdAt: z.union([ts, z.date()]), metadata: z.unknown().nullable() })),
});
export const adminHostelListItemSchema = hostelSummarySchema.extend({ owner: ownerInfo });
