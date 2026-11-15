import { z } from 'zod';
import { isDateString } from '@/core/dates';
import { paginationSchema } from '@/core/http/pagination';

const date = z.string().refine(isDateString, 'Use a date like 2027-01-15');
const phone = z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a phone number in international format');
const reason = z.string().trim().min(3, 'Give a short reason').max(500);
const gender = z.enum(['MALE', 'FEMALE', 'OTHER']);
const payMethod = z.enum(['CASH', 'UPI', 'BANK']);

export const applicationStatusSchema = z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED']);
export const tenancyStatusSchema = z.enum(['INVITED', 'PENDING_MOVE_IN', 'ACTIVE', 'NOTICE', 'ENDED', 'CANCELLED']);

// ── requests ──
export const createApplicationSchema = z.strictObject({
  roomTypeId: z.uuid(),
  moveInDate: date,
  tenureMonths: z.number().int().min(1).max(60).optional(),
  gender: gender.optional(),
  occupation: z.string().trim().max(100).optional(),
  message: z.string().trim().max(1000).optional(),
  emergencyContactName: z.string().trim().min(2, 'Enter a contact name').max(100),
  emergencyContactPhone: phone,
});

export const listApplicationsQuerySchema = paginationSchema.extend({ status: applicationStatusSchema.optional() });
export const ownerListApplicationsQuerySchema = listApplicationsQuerySchema.extend({ hostelId: z.uuid().optional() });

const rent = z.number().int().min(100, 'Minimum rent is ₹1').max(10_000_000);
const deposit = z.number().int().min(0).max(100_000_000);

export const approveApplicationSchema = z.strictObject({ unitId: z.uuid().optional(), rentPaise: rent.optional(), depositPaise: deposit.optional(), startDate: date.optional() });
export const rejectApplicationSchema = z.strictObject({ reason });

export const createTenancySchema = z.strictObject({
  roomTypeId: z.uuid(),
  unitId: z.uuid().optional(),
  tenantEmail: z.email().max(254),
  startDate: date,
  rentPaise: rent.optional(),
  depositPaise: deposit.optional(),
  depositReceived: z.strictObject({ method: payMethod, reference: z.string().trim().max(100).optional() }).optional(),
  emergencyContactName: z.string().trim().min(2).max(100).optional(),
  emergencyContactPhone: phone.optional(),
});

export const updateTenancyTermsSchema = z
  .strictObject({
    rentPaise: rent.optional(), depositPaise: deposit.optional(), startDate: date.optional(),
    dueDay: z.number().int().min(1).max(28).optional(), graceDays: z.number().int().min(0).max(30).optional(), noticeDays: z.number().int().min(0).max(180).optional(),
    expectedVersion: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'expectedVersion'), { message: 'Provide at least one term to change' });

export const recordDepositSchema = z.strictObject({ method: payMethod, reference: z.string().trim().max(100).optional() });
export const cancelTenancySchema = z.strictObject({ reason });
/** Notice: the day the tenant will have moved out. It must be at least the stay's notice period away. */
export const giveNoticeSchema = z.strictObject({ moveOutDate: date, reason: z.string().trim().max(500).optional() });
/** Move-out: the day the tenant actually left (today if omitted; never in the future). */
export const moveOutSchema = z.strictObject({ movedOutOn: date.optional(), note: z.string().trim().max(500).optional() });
export const acceptInviteSchema = z.strictObject({ token: z.string().min(20).max(200) });

export const listTenanciesQuerySchema = paginationSchema.extend({ status: tenancyStatusSchema.optional() });
export const ownerListTenanciesQuerySchema = listTenanciesQuerySchema.extend({ hostelId: z.uuid().optional() });

export const tenancyTermsSchema = z.strictObject({
  depositMonths: z.number().int().min(0).max(12), noticeDays: z.number().int().min(0).max(180), rentDueDay: z.number().int().min(1).max(28), rentGraceDays: z.number().int().min(0).max(30),
  /** GST charged on rent, in basis points (0 = none). Long-stay student housing is often exempt; confirm with an accountant. */
  rentGstBps: z.number().int().min(0).max(2800),
  /** A flat fee added once when an invoice goes overdue. 0 = none. */
  rentLateFeePaise: z.number().int().min(0).max(10_000_000),
});
export const updateTenancyTermsDefaultsSchema = tenancyTermsSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one term to change' });
export const publicTenancyTermsSchema = tenancyTermsSchema.extend({
  rooms: z.array(z.strictObject({ roomTypeId: z.uuid(), name: z.string(), kind: z.enum(['DORM', 'PRIVATE']), gender: z.enum(['MIXED', 'MALE', 'FEMALE']), rentPaise: z.number().int(), freeUnits: z.number().int() })),
});

// ── responses ──
const ts = z.iso.datetime();
const person = z.strictObject({ id: z.uuid(), name: z.string().nullable(), email: z.string(), phone: z.string().nullable() });
const hostelRef = z.strictObject({ id: z.uuid(), slug: z.string(), name: z.string(), city: z.string(), addressLine: z.string() });
const roomRef = z.strictObject({ id: z.uuid(), name: z.string(), kind: z.enum(['DORM', 'PRIVATE']) });

export const applicationDtoSchema = z.strictObject({
  id: z.uuid(), status: applicationStatusSchema, hostel: hostelRef, roomType: roomRef, applicant: person,
  moveInDate: date, tenureMonths: z.number().int().nullable(), gender: z.string().nullable(), occupation: z.string().nullable(), message: z.string().nullable(),
  emergencyContact: z.strictObject({ name: z.string(), phone: z.string() }), decisionNote: z.string().nullable(), decidedAt: ts.nullable(),
  tenancyId: z.uuid().nullable(), createdAt: ts, actions: z.array(z.enum(['withdraw', 'approve', 'reject'])),
});

export const tenancyDtoSchema = z.strictObject({
  id: z.uuid(), code: z.string(), status: tenancyStatusSchema, hostel: hostelRef, roomType: roomRef,
  unit: z.strictObject({ id: z.uuid(), label: z.string(), floor: z.number().int().nullable() }),
  tenant: person.nullable(), inviteEmail: z.string().nullable(),
  startDate: date, endDate: date.nullable(),
  rentPaise: z.number().int(), depositPaise: z.number().int(), dueDay: z.number().int(), graceDays: z.number().int(), noticeDays: z.number().int(), gstRateBps: z.number().int(), lateFeePaise: z.number().int(),
  deposit: z.strictObject({ status: z.enum(['NONE', 'DUE', 'RECEIVED']), receivedAt: ts.nullable(), method: z.enum(['CASH', 'UPI', 'BANK', 'ONLINE']).nullable(), reference: z.string().nullable() }),
  depositWarning: z.string().nullable(),
  emergencyContact: z.strictObject({ name: z.string(), phone: z.string() }).nullable(),
  activatedAt: ts.nullable(), cancelledAt: ts.nullable(), cancelReason: z.string().nullable(), applicationId: z.uuid().nullable(),
  notice: z.strictObject({ givenAt: ts, by: z.enum(['TENANT', 'OWNER']), reason: z.string().nullable(), moveOutDate: date.nullable() }).nullable(),
  movedOutAt: ts.nullable(),
  /** The deposit settlement once the stay has ended (hidden from the tenant while it is still the owner's draft). */
  settlement: z.strictObject({ id: z.uuid(), status: z.enum(['DRAFT', 'PROPOSED', 'DISPUTED', 'AGREED', 'COMPLETED']), refundPaise: z.number().int() }).nullable(),
  version: z.number().int(), createdAt: ts,
  actions: z.array(z.enum(['accept', 'decline', 'edit', 'record_deposit', 'activate', 'cancel', 'give_notice', 'withdraw_notice', 'pay_deposit', 'serve_notice', 'move_out', 'settle'])),
});

export type GiveNoticeInput = z.infer<typeof giveNoticeSchema>;
export type MoveOutInput = z.infer<typeof moveOutSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type ApproveApplicationInput = z.infer<typeof approveApplicationSchema>;
export type CreateTenancyInput = z.infer<typeof createTenancySchema>;
export type UpdateTenancyTermsInput = z.infer<typeof updateTenancyTermsSchema>;
export type TenancyTermsInput = z.infer<typeof updateTenancyTermsDefaultsSchema>;
