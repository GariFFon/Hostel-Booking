import type { Metadata } from "next";
import { Suspense } from "react";
import { OwnerBookingDetail } from "@/features/owner/booking-detail";

export const instant = false;
export const metadata: Metadata = { title: "Booking", robots: { index: false } };
export default function Page() { return <Suspense><OwnerBookingDetail /></Suspense>; }
