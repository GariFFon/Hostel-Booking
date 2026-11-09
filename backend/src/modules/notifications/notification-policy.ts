import type { NotificationType } from '@/generated/prisma/client';

/**
 * Which preference switch governs an in-app notification.
 *  - `bookings`: booking, payment and refund updates          (inAppBookings)
 *  - `reviews`:  review requests, new reviews, host replies   (inAppReviews)
 *  - `always`:   account, listing-moderation, KYC and system notices; users cannot mute these
 *
 * Typed as a full Record so adding a NotificationType forces a decision here (the compiler fails until it is classified).
 * Emails are separate: confirmations, cancellations, payment and refund emails are transactional and always sent;
 * only the pre-stay reminder email honours `emailBookings`.
 */
export type NotificationCategory = 'bookings' | 'reviews' | 'always';

export const NOTIFICATION_CATEGORY: Record<NotificationType, NotificationCategory> = {
  BOOKING_CREATED: 'bookings',
  BOOKING_CONFIRMED: 'bookings',
  BOOKING_APPROVAL_REQUESTED: 'bookings',
  BOOKING_APPROVED: 'bookings',
  BOOKING_REJECTED: 'bookings',
  BOOKING_EXPIRED: 'bookings',
  BOOKING_CANCELLED: 'bookings',
  BOOKING_REMINDER: 'bookings',
  PAYMENT_SUCCEEDED: 'bookings',
  PAYMENT_FAILED: 'bookings',
  REFUND_PROCESSED: 'bookings',
  REVIEW_REQUESTED: 'reviews',
  REVIEW_RECEIVED: 'reviews',
  REVIEW_REPLIED: 'reviews',
  HOSTEL_APPROVED: 'always',
  HOSTEL_REJECTED: 'always',
  KYC_APPROVED: 'always',
  KYC_REJECTED: 'always',
  SYSTEM: 'always',
};

export interface NotificationPreferences {
  emailBookings: boolean;
  emailMarketing: boolean;
  inAppBookings: boolean;
  inAppReviews: boolean;
}

/** What a user without a saved preference row gets. */
export const DEFAULT_PREFERENCES: NotificationPreferences = { emailBookings: true, emailMarketing: false, inAppBookings: true, inAppReviews: true };

export function inAppAllowed(type: NotificationType, prefs: NotificationPreferences): boolean {
  switch (NOTIFICATION_CATEGORY[type]) {
    case 'bookings': return prefs.inAppBookings;
    case 'reviews': return prefs.inAppReviews;
    case 'always': return true;
  }
}
