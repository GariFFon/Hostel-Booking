import { z } from 'zod';

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    phone: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a phone number in international format').nullable(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']).nullable(),
    dateOfBirth: z.iso.date().nullable(),
    city: z.string().trim().max(80).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
