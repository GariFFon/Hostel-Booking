import { z } from 'zod';

const gstin = z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN');

export const updateOwnerProfileSchema = z
  .object({
    businessName: z.string().trim().min(2).max(120).nullable(),
    gstin: gstin.nullable(),
    panLast4: z.string().regex(/^[A-Z0-9]{4}$/i, 'Enter the last 4 characters of your PAN').transform((s) => s.toUpperCase()).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

export const addKycDocumentSchema = z.object({
  type: z.enum(['GOVERNMENT_ID', 'PROPERTY_PROOF', 'BUSINESS_LICENSE', 'GST_CERTIFICATE', 'OTHER']),
  publicId: z.string().min(10).max(300),
});

export const kycListQuerySchema = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'NOT_SUBMITTED']).default('PENDING') });
export const kycRejectSchema = z.object({ reason: z.string().trim().min(10).max(1000) });
