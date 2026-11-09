import { z } from 'zod';
import { documentRoute } from '@/core/openapi/registry';
import { couponDtoSchema, createCouponSchema, listCouponsQuerySchema, offerSchema, updateCouponSchema } from '@/modules/coupons/coupons.schema';
import {
  deviceDtoSchema, listNotificationsQuerySchema, notificationDtoSchema, notificationPreferencesSchema, readAllResultSchema, registerDeviceSchema, unreadCountSchema, updateNotificationPreferencesSchema,
} from '@/modules/notifications/notifications.schema';
import {
  adminReviewSchema, adminReviewsQuerySchema, createReviewSchema, myReviewSchema, ownerReviewSchema, ownerReviewsQuerySchema, publicReviewSchema, publicReviewsQuerySchema, reasonSchema,
  replyReviewSchema, reportResultSchema, reviewSummarySchema, updateReviewSchema,
} from '@/modules/reviews/reviews.schema';
import { wishlistIdsSchema, wishlistItemSchema, wishlistQuerySchema, wishlistStateSchema } from '@/modules/wishlist/wishlist.schema';
import { paginationSchema } from '@/core/http/pagination';

const R = ['Reviews'], W = ['Wishlist'], C = ['Coupons'], N = ['Notifications'], O = ['Owner'], A = ['Admin'];
const done = z.strictObject({ deleted: z.boolean() });

// ── reviews ──
documentRoute({ method: 'get', path: '/hostels/{idOrSlug}/reviews', summary: 'Published reviews of a listing (keyset pagination; sort=recent|highest|lowest; rating filter). Reviewer names are shortened ("Asha R."). X-Cache: HIT|MISS', tags: R, query: publicReviewsQuerySchema, response: z.array(publicReviewSchema), errors: [404] });
documentRoute({ method: 'get', path: '/hostels/{idOrSlug}/reviews/summary', summary: 'Rating distribution and category averages', tags: R, response: reviewSummarySchema, errors: [404] });
documentRoute({ method: 'post', path: '/bookings/{id}/review', summary: 'Review a completed stay (one per booking, within 60 days of check-out). The booking exposes the `review` action while this is possible', tags: R, auth: true, body: createReviewSchema, response: myReviewSchema, status: 201, errors: [403, 404, 409] });
documentRoute({ method: 'get', path: '/me/reviews', summary: 'My reviews, with moderation status and whether I can still edit them', tags: R, auth: true, query: paginationSchema, response: z.array(myReviewSchema) });
documentRoute({ method: 'patch', path: '/reviews/{id}', summary: 'Edit my review: only for 14 days after posting and only until the host has replied. null clears an optional field', tags: R, auth: true, body: updateReviewSchema, response: myReviewSchema, errors: [404, 409] });
documentRoute({ method: 'delete', path: '/reviews/{id}', summary: 'Delete my review (same window as editing)', tags: R, auth: true, response: done, errors: [404, 409] });
documentRoute({ method: 'get', path: '/owner/reviews', summary: 'Reviews of my properties (filter by property, replied, status, rating)', tags: O, auth: true, query: ownerReviewsQuerySchema, response: z.array(ownerReviewSchema), errors: [403] });
documentRoute({ method: 'put', path: '/owner/reviews/{id}/reply', summary: 'Set or replace my public reply (the guest is notified of the first one)', tags: O, auth: true, body: replyReviewSchema, response: ownerReviewSchema, errors: [403, 404, 409] });
documentRoute({ method: 'delete', path: '/owner/reviews/{id}/reply', summary: 'Remove my reply', tags: O, auth: true, response: ownerReviewSchema, errors: [403, 404, 409] });
documentRoute({ method: 'post', path: '/owner/reviews/{id}/report', summary: 'Ask moderators to look at a review that breaks the content rules (once per review). Hosts cannot hide reviews themselves', tags: O, auth: true, body: reasonSchema, response: reportResultSchema, errors: [403, 404, 409] });
documentRoute({ method: 'get', path: '/admin/reviews', summary: 'All reviews, with guest identity and moderation state', tags: A, auth: true, query: adminReviewsQuerySchema, response: z.array(adminReviewSchema), errors: [403] });
documentRoute({ method: 'post', path: '/admin/reviews/{id}/hide', summary: 'Hide a review (reason is shown to the guest). Ratings are recomputed', tags: A, auth: true, body: reasonSchema, response: adminReviewSchema, errors: [403, 404, 409] });
documentRoute({ method: 'post', path: '/admin/reviews/{id}/restore', summary: 'Publish a hidden review again', tags: A, auth: true, response: adminReviewSchema, errors: [403, 404, 409] });

// ── wishlist ──
documentRoute({ method: 'get', path: '/me/wishlist', summary: 'My saved properties, newest first (only listings that are currently live)', tags: W, auth: true, query: wishlistQuerySchema, response: z.array(wishlistItemSchema) });
documentRoute({ method: 'get', path: '/me/wishlist/ids', summary: 'Ids of everything I saved (max 500), to draw the heart on cached search results', tags: W, auth: true, response: wishlistIdsSchema });
documentRoute({ method: 'put', path: '/me/wishlist/{hostelId}', summary: 'Save a property (idempotent)', tags: W, auth: true, response: wishlistStateSchema, errors: [404, 409] });
documentRoute({ method: 'delete', path: '/me/wishlist/{hostelId}', summary: 'Remove a property from my list (idempotent)', tags: W, auth: true, response: wishlistStateSchema });

// ── coupons ──
documentRoute({ method: 'get', path: '/hostels/{idOrSlug}/offers', summary: 'Public offers for a listing: valid, not fully redeemed codes marked public (its own and platform-wide). Terms are re-checked by /quotes. X-Cache: HIT|MISS', tags: C, response: z.array(offerSchema), errors: [404] });
documentRoute({ method: 'get', path: '/owner/coupons', summary: 'Coupons on my properties', tags: O, auth: true, query: listCouponsQuerySchema, response: z.array(couponDtoSchema), errors: [403] });
documentRoute({ method: 'post', path: '/owner/coupons', summary: 'Create a coupon for one of my properties (funded by me: the discount reduces my payout). Codes are global and upper-case', tags: O, auth: true, body: createCouponSchema, response: couponDtoSchema, status: 201, errors: [403, 404, 409] });
documentRoute({ method: 'get', path: '/owner/coupons/{id}', summary: 'One of my coupons, with usage', tags: O, auth: true, response: couponDtoSchema, errors: [403, 404] });
documentRoute({ method: 'patch', path: '/owner/coupons/{id}', summary: 'Change a coupon. Code, discount type and property are fixed', tags: O, auth: true, body: updateCouponSchema, response: couponDtoSchema, errors: [403, 404, 422] });
documentRoute({ method: 'delete', path: '/owner/coupons/{id}', summary: 'Delete a coupon that was never used; otherwise deactivate it (409)', tags: O, auth: true, response: done, errors: [403, 404, 409] });
documentRoute({ method: 'get', path: '/admin/coupons', summary: 'All coupons (scope=PLATFORM|PROPERTY)', tags: A, auth: true, query: listCouponsQuerySchema, response: z.array(couponDtoSchema), errors: [403] });
documentRoute({ method: 'post', path: '/admin/coupons', summary: 'Create a platform-wide coupon (funded by the platform: owners are paid in full)', tags: A, auth: true, body: createCouponSchema, response: couponDtoSchema, status: 201, errors: [403, 409] });
documentRoute({ method: 'get', path: '/admin/coupons/{id}', summary: 'Any coupon', tags: A, auth: true, response: couponDtoSchema, errors: [403, 404] });
documentRoute({ method: 'patch', path: '/admin/coupons/{id}', summary: 'Change a platform coupon; for a host coupon only isActive/isPublic (moderation)', tags: A, auth: true, body: updateCouponSchema, response: couponDtoSchema, errors: [403, 404, 422] });
documentRoute({ method: 'delete', path: '/admin/coupons/{id}', summary: 'Delete an unused coupon; otherwise deactivate it (409)', tags: A, auth: true, response: done, errors: [403, 404, 409] });

// ── notifications ──
documentRoute({ method: 'get', path: '/me/notifications', summary: 'My notifications, newest first (unread=true for only unread; type filter)', tags: N, auth: true, query: listNotificationsQuerySchema, response: z.array(notificationDtoSchema) });
documentRoute({ method: 'get', path: '/me/notifications/unread-count', summary: 'Number of unread notifications (cheap; poll this for the badge)', tags: N, auth: true, response: unreadCountSchema });
documentRoute({ method: 'post', path: '/me/notifications/read-all', summary: 'Mark everything as read', tags: N, auth: true, response: readAllResultSchema });
documentRoute({ method: 'post', path: '/me/notifications/{id}/read', summary: 'Mark one notification as read (idempotent)', tags: N, auth: true, response: notificationDtoSchema, errors: [404] });
documentRoute({ method: 'delete', path: '/me/notifications/{id}', summary: 'Delete one notification', tags: N, auth: true, response: done, errors: [404] });
documentRoute({ method: 'get', path: '/me/notification-preferences', summary: 'My notification preferences (defaults when never saved)', tags: N, auth: true, response: notificationPreferencesSchema });
documentRoute({ method: 'patch', path: '/me/notification-preferences', summary: 'Change preferences. Account, moderation, KYC and system notices cannot be muted; payment/refund/cancellation emails are always sent', tags: N, auth: true, body: updateNotificationPreferencesSchema, response: notificationPreferencesSchema });
documentRoute({ method: 'post', path: '/me/devices', summary: 'Register a push token (FCM/APNs). Idempotent; a token moves to the signed-in account. Delivery is switched on in a later phase', tags: N, auth: true, body: registerDeviceSchema, response: deviceDtoSchema, status: 201 });
documentRoute({ method: 'delete', path: '/me/devices/{id}', summary: 'Unregister a device (call on sign-out)', tags: N, auth: true, response: done, errors: [404] });
