import type { Item } from "@/lib/api/types";

type N = Item<"/me/notifications">;

/** Where tapping a notification should go. Uses the ids the server puts in `data`; unknown shapes simply don't link. */
export function notificationHref(n: Pick<N, "type" | "data">): string | null {
  const d = (n.data ?? {}) as Record<string, string | undefined>;
  switch (n.type) {
    case "BOOKING_APPROVAL_REQUESTED": return d.bookingId ? `/owner/bookings/${d.bookingId}` : "/owner/bookings";
    case "REVIEW_RECEIVED": return "/owner/reviews";
    case "TENANCY_REQUESTED": return "/owner/tenants";
    case "RENT_INVOICE_ISSUED": case "RENT_DUE_SOON": case "RENT_OVERDUE": case "RENT_PAID":
      return d.audience === "OWNER" ? "/owner/rent" : "/account/stay";
    case "TENANCY_APPROVED": case "TENANCY_REJECTED": case "TENANCY_INVITED": case "TENANCY_STARTED": case "TENANCY_NOTICE": case "TENANCY_ENDED": case "DEPOSIT_SETTLED":
      return d.audience === "OWNER" ? "/owner/tenants" : "/account/stay";
    case "COMPLAINT_CREATED": case "COMPLAINT_ASSIGNED": case "COMPLAINT_UPDATED": case "COMPLAINT_RESOLVED":
      return d.audience === "OWNER" ? "/owner/complaints" : d.audience === "STAFF" ? "/staff" : d.complaintId ? `/account/complaints?open=${d.complaintId}` : "/account/complaints";
    case "STAFF_INVITED": return d.audience === "OWNER" ? "/owner/staff" : "/staff";
    case "REVIEW_REPLIED": return "/account/reviews";
    case "HOSTEL_APPROVED": case "HOSTEL_REJECTED": return d.hostelId ? `/owner/hostels/${d.hostelId}` : "/owner/hostels";
    case "KYC_APPROVED": case "KYC_REJECTED": return "/owner/verification";
    case "SYSTEM":
      if (d.reviewId && !d.bookingId) return "/admin/reviews";
      if (d.ownerId) return `/admin/kyc/${d.ownerId}`;
      if (d.hostelId) return `/admin/hostels/${d.hostelId}`;
      return null;
    default: // booking, payment and refund updates: the booking page redirects hosts to their own view
      return d.bookingId ? `/account/bookings/${d.bookingId}` : null;
  }
}
