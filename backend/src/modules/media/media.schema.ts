import { z } from 'zod';

export const addMediaSchema = z.object({
  publicId: z.string().min(10).max(300),
  roomTypeId: z.uuid().nullish(),
  altText: z.string().trim().max(200).nullish(),
});
export const updateMediaSchema = z
  .object({ altText: z.string().trim().max(200).nullable(), isCover: z.literal(true) })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const reorderMediaSchema = z.object({ ids: z.array(z.uuid()).min(1).max(50) });
