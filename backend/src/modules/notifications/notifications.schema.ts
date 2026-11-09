import { z } from 'zod';
import { paginationSchema } from '@/core/http/pagination';

const ts = z.iso.datetime();
const TYPES = [
  'BOOKING_CREATED', 'BOOKING_CONFIRMED', 'BOOKING_APPROVAL_REQUESTED', 'BOOKING_APPROVED', 'BOOKING_REJECTED', 'BOOKING_EXPIRED', 'BOOKING_CANCELLED', 'BOOKING_REMINDER',
  'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'REFUND_PROCESSED', 'REVIEW_REQUESTED', 'REVIEW_RECEIVED', 'REVIEW_REPLIED', 'HOSTEL_APPROVED', 'HOSTEL_REJECTED', 'KYC_APPROVED', 'KYC_REJECTED', 'SYSTEM',
] as const;
export const notificationTypeSchema = z.enum(TYPES);

export const notificationDtoSchema = z.strictObject({
  id: z.uuid(), type: notificationTypeSchema, title: z.string(), body: z.string(),
  /** Deep-link hints for the client, e.g. { bookingId, code } or { hostelId }. Never contains secrets. */
  data: z.record(z.string(), z.unknown()).nullable(),
  read: z.boolean(), readAt: ts.nullable(), createdAt: ts,
});

export const listNotificationsQuerySchema = paginationSchema.extend({
  unread: z.enum(['true', 'false']).optional(), // 'true' = only unread
  type: notificationTypeSchema.optional(),
});

export const unreadCountSchema = z.strictObject({ unread: z.number().int() });
export const readAllResultSchema = z.strictObject({ updated: z.number().int() });

export const notificationPreferencesSchema = z.strictObject({
  emailBookings: z.boolean(), emailMarketing: z.boolean(), inAppBookings: z.boolean(), inAppReviews: z.boolean(),
});
export const updateNotificationPreferencesSchema = z.strictObject({
  emailBookings: z.boolean().optional(), emailMarketing: z.boolean().optional(), inAppBookings: z.boolean().optional(), inAppReviews: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one preference' });

export const registerDeviceSchema = z.strictObject({
  platform: z.enum(['ANDROID', 'IOS', 'WEB']),
  /** FCM / APNs registration token. */
  pushToken: z.string().trim().min(16).max(4096),
});
export const deviceDtoSchema = z.strictObject({ id: z.uuid(), platform: z.enum(['ANDROID', 'IOS', 'WEB']), createdAt: ts, lastSeenAt: ts });
