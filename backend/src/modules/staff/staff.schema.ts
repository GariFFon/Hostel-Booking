import { z } from 'zod';

const ts = z.iso.datetime();
export const tradeSchema = z.enum(['ELECTRICIAN', 'PLUMBER', 'CARPENTER', 'CLEANER', 'COOK', 'SECURITY', 'WARDEN', 'NETWORK', 'OTHER']);
const email = z.email().max(254);

export const ownerInviteSchema = z.strictObject({ email, trade: tradeSchema, hostelIds: z.array(z.uuid()).min(1, 'Pick at least one property').max(30) });
export const adminInviteSchema = z.strictObject({ email, trade: tradeSchema });
export const acceptStaffInviteSchema = z.strictObject({ token: z.string().min(20).max(200) });
export const setHostelsSchema = z.strictObject({ hostelIds: z.array(z.uuid()).max(30) });

const hostelRef = z.strictObject({ id: z.uuid(), name: z.string() });

export const staffDtoSchema = z.strictObject({
  userId: z.uuid(), name: z.string().nullable(), email: z.string(), phone: z.string().nullable(), trade: tradeSchema,
  /** OWN = this owner's own staff; VENDOR = a platform vendor the owner has engaged. */
  kind: z.enum(['OWN', 'VENDOR']), status: z.enum(['ACTIVE', 'INACTIVE']),
  hostels: z.array(hostelRef), openJobs: z.number().int(), createdAt: ts,
});

export const staffInviteDtoSchema = z.strictObject({
  id: z.uuid(), email: z.string(), trade: tradeSchema, kind: z.enum(['OWN', 'VENDOR']), hostels: z.array(hostelRef), expiresAt: ts, createdAt: ts,
});

export const ownerStaffDtoSchema = z.strictObject({ staff: z.array(staffDtoSchema), invites: z.array(staffInviteDtoSchema) });

export const vendorDtoSchema = z.strictObject({ userId: z.uuid(), name: z.string().nullable(), trade: tradeSchema, hostels: z.array(hostelRef) });

export const adminStaffDtoSchema = staffDtoSchema.extend({ ownerName: z.string().nullable() });

export const staffMeDtoSchema = z.strictObject({
  userId: z.uuid(), trade: tradeSchema, kind: z.enum(['OWN', 'VENDOR']), status: z.enum(['ACTIVE', 'INACTIVE']), employer: z.string().nullable(),
  hostels: z.array(z.strictObject({ id: z.uuid(), name: z.string(), city: z.string() })), openJobs: z.number().int(),
});

export type OwnerInviteInput = z.infer<typeof ownerInviteSchema>;
export type AdminInviteInput = z.infer<typeof adminInviteSchema>;

export const setStatusSchema = z.strictObject({ status: z.enum(['ACTIVE', 'INACTIVE']) });
