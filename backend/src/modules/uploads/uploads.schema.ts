import { z } from 'zod';

export const uploadPurposeSchema = z.enum(['HOSTEL_IMAGE', 'ROOM_IMAGE', 'AVATAR', 'KYC_DOCUMENT']);
export type UploadPurpose = z.infer<typeof uploadPurposeSchema>;

export const signatureRequestSchema = z
  .object({
    purpose: uploadPurposeSchema,
    /** Required for HOSTEL_IMAGE and ROOM_IMAGE: the hostel the asset will belong to. */
    hostelId: z.uuid().optional(),
  })
  .refine((v) => !(v.purpose === 'HOSTEL_IMAGE' || v.purpose === 'ROOM_IMAGE') || v.hostelId, { message: 'hostelId is required', path: ['hostelId'] });

export const signatureResponseSchema = z.object({
  uploadUrl: z.url(),
  fields: z.record(z.string(), z.string()),
  publicId: z.string(),
  expiresAt: z.iso.datetime(),
  maxBytes: z.number().int(),
  allowedFormats: z.array(z.string()),
});

export type SignatureRequest = z.infer<typeof signatureRequestSchema>;
