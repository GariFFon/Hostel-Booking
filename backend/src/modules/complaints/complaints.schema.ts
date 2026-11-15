import { z } from 'zod';
import { paginationSchema } from '@/core/http/pagination';

const ts = z.iso.datetime();
const note = z.string().trim().min(3, 'Add a few words').max(1000);

export const categorySchema = z.enum(['ELECTRICAL', 'PLUMBING', 'CARPENTRY', 'CLEANING', 'FOOD', 'WIFI', 'SECURITY', 'BEHAVIOUR', 'OTHER']);
export const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const statusSchema = z.enum(['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'REOPENED', 'REJECTED']);
const roleSchema = z.enum(['TENANT', 'OWNER', 'STAFF', 'ADMIN', 'SYSTEM']);

// ── requests ──
/** A tenant can mark a complaint up to HIGH. URGENT is the owner's call (it starts a 4-hour clock). */
export const createComplaintSchema = z.strictObject({
  category: categorySchema,
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  title: z.string().trim().min(3, 'Give it a short title').max(120),
  description: z.string().trim().min(5, 'Describe what is wrong').max(2000),
  location: z.string().trim().max(100).optional(),
  /** When the tenant is free to let someone in. Required: without it staff cannot plan a visit. */
  availableFrom: ts,
  availableTo: ts,
  /** Staff may go in even if the tenant is out (otherwise only while someone is home). */
  allowEntryIfAway: z.boolean().default(false),
});

export const listComplaintsQuerySchema = paginationSchema.extend({ status: statusSchema.optional() });
export const ownerListComplaintsQuerySchema = listComplaintsQuerySchema.extend({
  hostelId: z.uuid().optional(),
  priority: prioritySchema.optional(),
  assignedStaffId: z.uuid().optional(),
  /** `true` = nobody has it yet. */
  unassigned: z.enum(['true', 'false']).optional(),
  /** `true` = past the response deadline and still waiting on someone. */
  overdue: z.enum(['true', 'false']).optional(),
});
export const staffListComplaintsQuerySchema = listComplaintsQuerySchema.extend({ open: z.enum(['true', 'false']).optional() });

export const commentSchema = z.strictObject({ body: z.string().trim().min(1, 'Write something').max(1000), internal: z.boolean().default(false) });
export const attachMediaSchema = z.strictObject({ publicId: z.string().min(10).max(300) });

export const tenantActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('close') }),
  /** If the old free time has passed, a new one is required: staff must be able to plan the second visit. */
  z.strictObject({ action: z.literal('reopen'), reason: note, availableFrom: ts.optional(), availableTo: ts.optional(), allowEntryIfAway: z.boolean().optional() }),
  z.strictObject({ action: z.literal('set_availability'), availableFrom: ts, availableTo: ts, allowEntryIfAway: z.boolean().default(false) }),
  z.strictObject({ action: z.literal('rate'), rating: z.number().int().min(1).max(5), feedback: z.string().trim().max(500).optional() }),
]);

export const ownerActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('acknowledge') }),
  z.strictObject({ action: z.literal('assign'), staffUserId: z.uuid(), note: z.string().trim().max(500).optional() }),
  z.strictObject({ action: z.literal('unassign') }),
  z.strictObject({ action: z.literal('reject'), reason: note }),
  z.strictObject({ action: z.literal('resolve'), note }),
  z.strictObject({ action: z.literal('priority'), priority: prioritySchema }),
  z.strictObject({ action: z.literal('schedule'), visitStart: ts, visitEnd: ts }),
]);

export const staffActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('start') }),
  z.strictObject({ action: z.literal('hold'), reason: note }),
  z.strictObject({ action: z.literal('resolve'), note }),
  z.strictObject({ action: z.literal('schedule'), visitStart: ts, visitEnd: ts }),
]);

// ── responses ──
const person = z.strictObject({ id: z.uuid(), name: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable() });

export const complaintSummarySchema = z.strictObject({
  id: z.uuid(), code: z.string(), status: statusSchema, category: categorySchema, priority: prioritySchema, title: z.string(), location: z.string().nullable(),
  hostel: z.strictObject({ id: z.uuid(), name: z.string(), city: z.string() }),
  unitLabel: z.string(),
  raisedBy: person,
  assignedStaff: z.strictObject({ id: z.uuid(), name: z.string().nullable(), trade: z.string().nullable() }).nullable(),
  slaDueAt: ts, slaBreached: z.boolean(),
  /** When the tenant is free; null only for complaints filed before this existed. */
  availability: z.strictObject({ from: ts, to: ts, allowEntryIfAway: z.boolean() }).nullable(),
  /** The visit slot booked inside that window. */
  visit: z.strictObject({ start: ts, end: ts }).nullable(),
  mediaCount: z.number().int(), commentCount: z.number().int(),
  rating: z.number().int().nullable(), reopenCount: z.number().int(),
  createdAt: ts, updatedAt: ts,
});

export const complaintDetailSchema = complaintSummarySchema.extend({
  description: z.string(),
  acknowledgedAt: ts.nullable(), resolvedAt: ts.nullable(), resolutionNote: z.string().nullable(), closedAt: ts.nullable(), feedback: z.string().nullable(),
  media: z.array(z.strictObject({ id: z.uuid(), url: z.string(), uploadedByRole: roleSchema, createdAt: ts })),
  comments: z.array(z.strictObject({ id: z.uuid(), authorName: z.string(), authorRole: roleSchema, body: z.string(), internal: z.boolean(), createdAt: ts })),
  history: z.array(z.strictObject({ id: z.uuid(), fromStatus: statusSchema.nullable(), toStatus: statusSchema, actorRole: roleSchema, note: z.string().nullable(), createdAt: ts })),
  viewer: z.enum(['TENANT', 'OWNER', 'STAFF', 'ADMIN']),
  version: z.number().int(),
  actions: z.array(z.enum(['comment', 'add_photo', 'close', 'reopen', 'rate', 'acknowledge', 'assign', 'unassign', 'reject', 'resolve', 'set_priority', 'start', 'hold', 'schedule', 'set_availability'])),
});

export type CreateComplaintInput = z.infer<typeof createComplaintSchema>;
export type TenantAction = z.infer<typeof tenantActionSchema>;
export type OwnerAction = z.infer<typeof ownerActionSchema>;
export type StaffAction = z.infer<typeof staffActionSchema>;
export type CommentInput = z.infer<typeof commentSchema>;
