import { z } from 'zod';
import { isDateString } from '@/core/dates';

/** Default-free: reused for partial updates so omitted fields are never reset. */
const fields = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).nullish(),
  kind: z.enum(['DORM', 'PRIVATE']),
  gender: z.enum(['MIXED', 'MALE', 'FEMALE']),
  totalUnits: z.number().int().min(1).max(500),
  maxOccupancyPerUnit: z.number().int().min(1).max(10),
  basePricePaise: z.number().int().min(100, 'Minimum price is ₹1').max(10_000_000, 'Maximum price is ₹1,00,000'),
  priceUnit: z.enum(['NIGHT', 'MONTH']),
  minStayNights: z.number().int().min(1).max(365),
  maxStayNights: z.number().int().min(1).max(365),
  isActive: z.boolean(),
});

export type RoomShape = Pick<z.infer<typeof fields>, 'kind' | 'gender' | 'maxOccupancyPerUnit' | 'minStayNights' | 'maxStayNights'>;

export function validateRoomShape(v: RoomShape) {
  const issues: { path: string; message: string }[] = [];
  if (v.kind === 'DORM' && v.maxOccupancyPerUnit !== 1) issues.push({ path: 'maxOccupancyPerUnit', message: 'A dorm unit is a single bed; use maxOccupancyPerUnit 1' });
  if (v.kind === 'PRIVATE' && v.gender !== 'MIXED') issues.push({ path: 'gender', message: 'Only dorm beds can be gender-specific' });
  if (v.maxStayNights < v.minStayNights) issues.push({ path: 'maxStayNights', message: 'Maximum stay must be at least the minimum stay' });
  return issues;
}

export const createRoomTypeSchema = fields
  .extend({
    gender: fields.shape.gender.default('MIXED'),
    maxOccupancyPerUnit: fields.shape.maxOccupancyPerUnit.default(1),
    priceUnit: fields.shape.priceUnit.default('NIGHT'),
    minStayNights: fields.shape.minStayNights.default(1),
    maxStayNights: fields.shape.maxStayNights.default(30),
    isActive: fields.shape.isActive.default(true),
  })
  .superRefine((v, ctx) => {
  for (const i of validateRoomShape(v)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
});
/** `kind` is immutable: changing a dorm into a private room would invalidate existing bookings. */
export const updateRoomTypeSchema = fields.omit({ kind: true }).partial().extend({ expectedVersion: z.number().int().positive().optional() }).strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'expectedVersion'), 'Provide at least one field to update');

const date = z.string().refine(isDateString, 'Use YYYY-MM-DD');
export const blockSchema = z.object({ from: date, to: date, units: z.number().int().min(0).max(500), reason: z.string().trim().max(200).nullish() });
export const calendarQuerySchema = z.object({ from: date, to: date });

export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>;
export type UpdateRoomTypeInput = z.infer<typeof updateRoomTypeSchema>;
