import { z } from 'zod';
import { isDateString } from '@/core/dates';

export const earningsQuerySchema = z.object({
  from: z.string().refine(isDateString, 'Use YYYY-MM-DD').optional(),
  to: z.string().refine(isDateString, 'Use YYYY-MM-DD').optional(),
  hostelId: z.uuid().optional(),
});

export const earningsSchema = z.strictObject({
  from: z.string(), to: z.string(), currency: z.string(),
  settled: z.strictObject({ bookings: z.number().int(), ownerPayablePaise: z.number().int(), commissionPaise: z.number().int(), taxPaise: z.number().int(), refundedPaise: z.number().int() }),
  upcoming: z.strictObject({ bookings: z.number().int(), expectedOwnerPaise: z.number().int() }),
  byHostel: z.array(z.strictObject({ hostelId: z.uuid(), name: z.string(), bookings: z.number().int(), ownerPayablePaise: z.number().int() })),
});
