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
    [{ type: "TENANCY_REQUESTED", data: { audience: "OWNER" } }, "/owner/tenants"],
    [{ type: "TENANCY_APPROVED", data: { audience: "TENANT" } }, "/account/stay"],
    [{ type: "TENANCY_APPROVED", data: { audience: "OWNER" } }, "/owner/tenants"], // an owner told "tenant accepted"
    [{ type: "TENANCY_STARTED", data: { audience: "OWNER" } }, "/owner/tenants"],
    [{ type: "TENANCY_ENDED", data: null }, "/account/stay"],
    [{ type: "RENT_INVOICE_ISSUED", data: { audience: "TENANT" } }, "/account/stay"],
    [{ type: "RENT_DUE_SOON", data: null }, "/account/stay"],
    [{ type: "RENT_OVERDUE", data: { audience: "OWNER" } }, "/owner/rent"],
    [{ type: "RENT_PAID", data: { audience: "OWNER" } }, "/owner/rent"],
    [{ type: "DEPOSIT_SETTLED", data: { audience: "OWNER" } }, "/owner/tenants"],
    [{ type: "DEPOSIT_SETTLED", data: { audience: "TENANT" } }, "/account/stay"],
    [{ type: "TENANCY_NOTICE", data: { audience: "OWNER" } }, "/owner/tenants"],
    [{ type: "COMPLAINT_CREATED", data: { audience: "OWNER", complaintId: "c1" } }, "/owner/complaints"],
    [{ type: "COMPLAINT_ASSIGNED", data: { audience: "STAFF", complaintId: "c1" } }, "/staff"],
    [{ type: "COMPLAINT_UPDATED", data: { audience: "TENANT", complaintId: "c1" } }, "/account/complaints?open=c1"],
    [{ type: "COMPLAINT_RESOLVED", data: { audience: "TENANT" } }, "/account/complaints"],
    [{ type: "STAFF_INVITED", data: { audience: "STAFF" } }, "/staff"],
    [{ type: "STAFF_INVITED", data: { audience: "OWNER" } }, "/owner/staff"],
    [{ type: "HOSTEL_APPROVED", data: { hostelId: "h" } }, "/owner/hostels/h"],
    [{ type: "SYSTEM", data: { ownerId: "o" } }, "/admin/kyc/o"],
    [{ type: "SYSTEM", data: { reviewId: "r", hostelId: "h" } }, "/admin/reviews"],
    [{ type: "SYSTEM", data: { hostelId: "h" } }, "/admin/hostels/h"],
    [{ type: "SYSTEM", data: null }, null],
    [{ type: "BOOKING_CONFIRMED", data: null }, null],
  ] as const)("%j", (n, href) => expect(notificationHref(n as never)).toBe(href));
});
