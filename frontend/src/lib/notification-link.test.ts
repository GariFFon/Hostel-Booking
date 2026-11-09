import { describe, expect, it } from "vitest";
import { notificationHref } from "./notification-link";

describe("where a notification leads", () => {
  it.each([
    [{ type: "BOOKING_CONFIRMED", data: { bookingId: "b1" } }, "/account/bookings/b1"],
    [{ type: "REFUND_PROCESSED", data: { bookingId: "b1" } }, "/account/bookings/b1"],
    [{ type: "BOOKING_APPROVAL_REQUESTED", data: { bookingId: "b2" } }, "/owner/bookings/b2"],
    [{ type: "REVIEW_RECEIVED", data: { reviewId: "r" } }, "/owner/reviews"],
    [{ type: "REVIEW_REPLIED", data: null }, "/account/reviews"],
    [{ type: "KYC_REJECTED", data: null }, "/owner/verification"],
    [{ type: "HOSTEL_APPROVED", data: { hostelId: "h" } }, "/owner/hostels/h"],
    [{ type: "SYSTEM", data: { ownerId: "o" } }, "/admin/kyc/o"],
    [{ type: "SYSTEM", data: { reviewId: "r", hostelId: "h" } }, "/admin/reviews"],
    [{ type: "SYSTEM", data: { hostelId: "h" } }, "/admin/hostels/h"],
    [{ type: "SYSTEM", data: null }, null],
    [{ type: "BOOKING_CONFIRMED", data: null }, null],
  ] as const)("%j", (n, href) => expect(notificationHref(n as never)).toBe(href));
});
