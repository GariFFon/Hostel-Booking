import { z } from 'zod';

export const reportQuerySchema = z.object({ hostelId: z.uuid().optional() });
const n = z.number().int();

export const occupancyReportSchema = z.strictObject({
  asOf: z.string(),
  totals: z.strictObject({ units: n, occupied: n, onNotice: n, reserved: n, maintenance: n, vacant: n, occupancyPct: z.number() }),
  byHostel: z.array(z.strictObject({
    hostelId: z.uuid(), name: z.string(), city: z.string(), propertyType: z.string(),
    units: n, occupied: n, onNotice: n, reserved: n, maintenance: n, vacant: n, occupancyPct: z.number(),
    byRoom: z.array(z.strictObject({ roomTypeId: z.uuid(), name: z.string(), units: n, occupied: n, onNotice: n, reserved: n, maintenance: n, vacant: n })),
  })),
  /** Tenants on notice, soonest first: the beds that free up next. */
  vacatingSoon: z.array(z.strictObject({ tenancyId: z.uuid(), tenant: z.string().nullable(), hostel: z.string(), unitLabel: z.string(), moveOutDate: z.string(), daysLeft: n })),
});

export const duesReportSchema = z.strictObject({
  asOf: z.string(),
  totals: z.strictObject({ tenants: n, invoices: n, owedPaise: n, overduePaise: n }),
  /** What is owed, by how long it has been overdue. "Not yet due" is billed but inside its due date + grace. */
  buckets: z.array(z.strictObject({ key: z.enum(['NOT_DUE', 'D1_7', 'D8_30', 'D31_60', 'D60_PLUS']), label: z.string(), invoices: n, owedPaise: n })),
  rows: z.array(z.strictObject({
    tenancyId: z.uuid(), tenant: z.string().nullable(), email: z.string(), hostel: z.string(), unitLabel: z.string(),
    invoices: n, owedPaise: n, oldestDueDate: z.string(), daysOverdue: n,
  })),
});

export type OccupancyReport = z.infer<typeof occupancyReportSchema>;
export type DuesReport = z.infer<typeof duesReportSchema>;
