"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ReviewCard, type PublicReview } from "@/features/hostel/reviews-section";
import { HostelCard } from "@/features/discovery/hostel-card";
import { BookingCard } from "@/features/account/bookings-list";
import { PriceBreakdown } from "@/features/booking/price-breakdown";
import { StatusBadge } from "@/components/common/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { RatingBadge } from "@/components/common/rating";
import type { BookingSummary, Quote, SearchItem } from "@/lib/api/types";
import { initials, money, plural } from "@/lib/format";

const LONG = "The Extraordinarily Long-Named Backpackers' Hostel & Rooftop Café of Greater Bengaluru Metro";
const demo = { hostel: { name: "Palolem Beach Nomads", locality: "Palolem", city: "Goa", rating: 4.5, reviews: 128, price: 80000 }, review: { name: "Asha R.", title: "Loved it", comment: "Clean dorms and friendly staff." } };

const card = (worst: boolean): SearchItem => ({
  id: "00000000-0000-4000-8000-000000000001", slug: "x", name: worst ? LONG : demo.hostel.name, propertyType: "HOSTEL", city: worst ? "Thiruvananthapuram" : "Goa", state: "Kerala",
  locality: worst ? "Sri Venkateswara Nagar Extension, Phase 3, Near the Old Railway Gate" : demo.hostel.locality, location: { latitude: 1, longitude: 1 }, distanceKm: worst ? 1234.56 : null,
  coverUrl: null, photoUrls: worst ? ["https://invalid.example/x.jpg"] : [], amenityCodes: [], roomKinds: ["DORM", "PRIVATE"], fromPricePaise: worst ? 987654321 : demo.hostel.price, stayFromPricePaise: null,
  currency: "INR", avgRating: worst ? 0 : demo.hostel.rating, reviewCount: worst ? 0 : demo.hostel.reviews, bookingMode: "INSTANT", genderPolicy: worst ? "FEMALE_ONLY" : "MIXED", cancellationPolicy: "STRICT",
});
const review = (worst: boolean): PublicReview => ({
  id: "r", overall: worst ? 1 : 5, cleanliness: null, location: null, staff: null, valueForMoney: null,
  title: worst ? "Absolutely not what the photos showed and the staff were extremely rude to us all weekend long" : demo.review.title,
  comment: worst ? `Check https://www.example-booking-site.example.com/a/very/long/path/that/never/breaks/anywhere/at/all/${"x".repeat(80)} 🙏🙏🙏 बहुत गंदा कमरा।\n\nSecond paragraph with   extra   spaces.\n${"word ".repeat(120)}` : demo.review.comment,
  reviewer: { name: worst ? "Aleksandra W." : demo.review.name }, stay: { month: "2026-10", nights: worst ? 90 : 2 }, ownerReply: worst ? "Thank you for the feedback. ".repeat(30) : null, ownerRepliedAt: null, createdAt: new Date(Date.now() - 86_400_000).toISOString(), editedAt: worst ? new Date().toISOString() : null,
});
const booking = (worst: boolean): BookingSummary => ({
  id: "b", code: "HB-ABCDEF", status: worst ? "CANCELLED_BY_OWNER" : "CONFIRMED", hostel: { id: "h", name: worst ? LONG : demo.hostel.name, city: worst ? "Thiruvananthapuram" : "Goa", coverUrl: null },
  checkIn: "2026-12-30", checkOut: worst ? "2027-03-30" : "2027-01-02", nights: worst ? 90 : 3, guestsCount: worst ? 30 : 1, totalPaise: worst ? 123456789 : 168000, holdExpiresAt: null, guestName: worst ? "Aleksandra Wiśniewska-Kowalczyk" : "Asha Rao", createdAt: new Date().toISOString(),
});
const quote = (worst: boolean): Quote => ({
  hostelId: "h", hostelName: "x", currency: "INR", checkIn: "2026-12-30", checkOut: "2027-01-01", nights: 2, guests: 2,
  items: [{ roomTypeId: "a", name: worst ? "Premium Deluxe Mixed-Gender Sixteen-Bed Dormitory With Lockers And Reading Lights" : "Dorm", kind: "DORM", units: worst ? 12 : 1, nightly: [{ date: "2026-12-30", unitPricePaise: 1, taxBps: 500, isSpecialPrice: worst }, { date: "2026-12-31", unitPricePaise: 1, taxBps: 500, isSpecialPrice: false }], lineSubtotalPaise: worst ? 999999900 : 160000 }],
  subtotalPaise: 0, discountPaise: worst ? 12345600 : 0, taxPaise: worst ? 49999995 : 8000, serviceFeePaise: 0, totalPaise: worst ? 1037654295 : 168000, effectiveGstBps: 500,
  coupon: null, cancellation: { policy: "STRICT", summary: "", freeCancellationUntil: null, tiers: [] }, bookingMode: "INSTANT", holdMinutes: 15, checkInTime: "14:00", checkOutTime: "11:00",
});

export function BreakUi() {
  const worst = useSearchParams().get("data") !== "demo";
  return (
    <div className="mx-auto grid max-w-2xl gap-10 px-4 py-8">
      <div className="sticky top-2 z-50 flex w-fit gap-1 rounded-full bg-muted p-1 text-sm shadow-md">
        {[["worst", "Worst case"], ["demo", "Demo data"]].map(([v, l]) => <a key={v} href={`?data=${v}`} className={`rounded-full px-3 py-1.5 ${(v === "worst") === worst ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}>{l}</a>)}
      </div>
      <section><h2 className="mb-3 font-semibold">Hostel card</h2><div className="w-80 max-w-full"><HostelCard h={card(worst)} /></div></section>
      <section><h2 className="mb-3 font-semibold">Review</h2><ReviewCard r={review(worst)} /></section>
      <section><h2 className="mb-3 font-semibold">Trip row</h2><BookingCard b={booking(worst)} now={null} /></section>
      <section><h2 className="mb-3 font-semibold">Price breakdown</h2><div className="w-80 max-w-full rounded-2xl border p-4"><PriceBreakdown quote={quote(worst)} /></div></section>
      <section><h2 className="mb-3 font-semibold">Small pieces</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name={worst ? "😀" : "Asha Rao"} /><Avatar name={worst ? "Jo" : "Asha Rao"} /><Avatar name={worst ? "" : "Asha Rao"} />
          <span>{initials("Aleksandra Wiśniewska-Kowalczyk")} {initials("😀 Smith")} {initials("")}</span>
          <RatingBadge rating={worst ? 0 : 4.5} count={worst ? 0 : 128} /><RatingBadge rating={5} count={1234567} />
          <StatusBadge status="PENDING_APPROVAL" /><StatusBadge status="SOMETHING_NEW_FROM_THE_SERVER" />
          <span>{plural(1, "guest")} · {plural(0, "stay")} · {plural(1234567, "review")} · {money(null)} · {money(Number.NaN)} · {money(98765432100)}</span>
        </div>
      </section>
    </div>
  );
}
