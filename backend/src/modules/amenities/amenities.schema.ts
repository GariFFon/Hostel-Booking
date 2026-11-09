import { z } from 'zod';

export const amenityCategorySchema = z.enum(['COMFORT', 'SAFETY', 'FOOD', 'WORK', 'WELLNESS', 'TRANSPORT']);
export const createAmenitySchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use UPPER_SNAKE_CASE, 2-40 characters'),
  label: z.string().trim().min(2).max(60),
  category: amenityCategorySchema,
  icon: z.string().trim().max(40).nullish(),
});
export const updateAmenitySchema = createAmenitySchema.omit({ code: true }).partial().strict().refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
