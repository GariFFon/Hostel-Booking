import { z } from 'zod';

export const auditQuerySchema = z.object({
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  actorId: z.uuid().optional(),
  /** Prefix match: "booking." returns every booking event. */
  action: z.string().max(60).optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().regex(/^\d{1,18}$/).optional(),
});

export const auditEntrySchema = z.strictObject({
  id: z.string(), at: z.iso.datetime(), actorId: z.uuid().nullable(), actorRole: z.string().nullable(), action: z.string(), entityType: z.string(), entityId: z.string().nullable(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']), before: z.unknown().nullable(), after: z.unknown().nullable(), metadata: z.unknown().nullable(),
  requestId: z.string().nullable(), ip: z.string().nullable(), userAgent: z.string().nullable(), hash: z.string().nullable(),
});

export const auditVerifySchema = z.strictObject({ intact: z.boolean(), rowsChecked: z.number().int(), broken: z.array(z.strictObject({ id: z.string(), reason: z.string() })) });
