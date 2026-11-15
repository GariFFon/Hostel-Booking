import { z } from 'zod';

export const uploadPurposeSchema = z.enum(['HOSTEL_IMAGE', 'ROOM_IMAGE', 'AVATAR', 'KYC_DOCUMENT', 'COMPLAINT_IMAGE', 'DEPOSIT_PROOF']);
export type UploadPurpose = z.infer<typeof uploadPurposeSchema>;

export const signatureRequestSchema = z
  .object({
    purpose: uploadPurposeSchema,
    /** Required for HOSTEL_IMAGE and ROOM_IMAGE: the hostel the asset will belong to. */
    hostelId: z.uuid().optional(),
    /** Required for COMPLAINT_IMAGE: the complaint the photo is evidence for. */
    complaintId: z.uuid().optional(),
    /** Required for DEPOSIT_PROOF: the stay whose deposit settlement the photo is evidence for (owners only). */
    tenancyId: z.uuid().optional(),
  })
  .refine((v) => !(v.purpose === 'HOSTEL_IMAGE' || v.purpose === 'ROOM_IMAGE') || v.hostelId, { message: 'hostelId is required', path: ['hostelId'] })
  .refine((v) => v.purpose !== 'COMPLAINT_IMAGE' || v.complaintId, { message: 'complaintId is required', path: ['complaintId'] })
  .refine((v) => v.purpose !== 'DEPOSIT_PROOF' || v.tenancyId, { message: 'tenancyId is required', path: ['tenancyId'] });

export const signatureResponseSchema = z.object({
  uploadUrl: z.url(),
  fields: z.record(z.string(), z.string()),
  publicId: z.string(),
  expiresAt: z.iso.datetime(),
  maxBytes: z.number().int(),
  allowedFormats: z.array(z.string()),
});

export type SignatureRequest = z.infer<typeof signatureRequestSchema>;
