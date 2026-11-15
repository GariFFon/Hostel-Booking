import { z } from 'zod';

const label = z.string().trim().min(1, 'Give the unit a label').max(40);
const unitStatus = z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED']);

/** Add one or many units to a room type, e.g. labels ["204-B1", "204-B2"]. */
export const createUnitsSchema = z.strictObject({
  labels: z.array(label).min(1).max(200),
  floor: z.number().int().min(-5).max(200).nullish(),
});

export const updateUnitSchema = z
  .strictObject({
    label: label.optional(),
    floor: z.number().int().min(-5).max(200).nullable().optional(),
    status: unitStatus.optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to change' });

export const unitDtoSchema = z.strictObject({
  id: z.uuid(), roomTypeId: z.uuid(), label: z.string(), floor: z.number().int().nullable(), status: unitStatus, notes: z.string().nullable(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});

export type CreateUnitsInput = z.infer<typeof createUnitsSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
