import type { NotificationType } from '@/generated/prisma/client';

/**
 * Which preference switch governs an in-app notification.
 *  - `bookings`: booking, payment and refund updates          (inAppBookings)
 *  - `reviews`:  review requests, new reviews, host replies   (inAppReviews)
 *  - `rent`:     tenancy lifecycle, rent invoices, deposits   (inAppRent)
 *  - `complaints`: complaint filing, assignment and updates   (inAppComplaints)
 *  - `always`:   account, listing-moderation, KYC and system notices; users cannot mute these
 *
 * Typed as a full Record so adding a NotificationType forces a decision here (the compiler fails until it is classified).
 * Emails are separate: confirmations, cancellations, payment and refund emails are transactional and always sent;
 * only the pre-stay reminder email honours `emailBookings`.
 */
export type NotificationCategory = 'bookings' | 'reviews' | 'rent' | 'complaints' | 'always';

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
  TENANCY_REQUESTED: 'rent',
  TENANCY_APPROVED: 'rent',
  TENANCY_REJECTED: 'rent',
  TENANCY_INVITED: 'rent',
  TENANCY_STARTED: 'rent',
  TENANCY_NOTICE: 'rent',
  TENANCY_ENDED: 'rent',
  RENT_INVOICE_ISSUED: 'rent',
  RENT_DUE_SOON: 'rent',
  RENT_OVERDUE: 'rent',
  RENT_PAID: 'rent',
  DEPOSIT_SETTLED: 'rent',
  COMPLAINT_CREATED: 'complaints',
  COMPLAINT_ASSIGNED: 'complaints',
  COMPLAINT_UPDATED: 'complaints',
  COMPLAINT_RESOLVED: 'complaints',
  STAFF_INVITED: 'always',
  SYSTEM: 'always',
};

export interface NotificationPreferences {
  emailBookings: boolean;
  emailMarketing: boolean;
  inAppBookings: boolean;
  inAppReviews: boolean;
  inAppRent: boolean;
  emailRent: boolean;
  inAppComplaints: boolean;
}

/** What a user without a saved preference row gets. */
export const DEFAULT_PREFERENCES: NotificationPreferences = { emailBookings: true, emailMarketing: false, inAppBookings: true, inAppReviews: true, inAppRent: true, emailRent: true, inAppComplaints: true };

export function inAppAllowed(type: NotificationType, prefs: NotificationPreferences): boolean {
  switch (NOTIFICATION_CATEGORY[type]) {
    case 'bookings': return prefs.inAppBookings;
    case 'reviews': return prefs.inAppReviews;
    case 'rent': return prefs.inAppRent;
    case 'complaints': return prefs.inAppComplaints;
    case 'always': return true;
  }
}
