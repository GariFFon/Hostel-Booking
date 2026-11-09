import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingDetailView } from "@/features/account/booking-detail";

// A signed-in, fully client-rendered screen: there is no static content to prefetch, so skip instant-navigation validation for it.
export const instant = false;
export const metadata: Metadata = { title: "Booking", robots: { index: false } };
export default function Page() { return <Suspense><BookingDetailView /></Suspense>; }
