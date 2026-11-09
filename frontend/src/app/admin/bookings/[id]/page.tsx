import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminBookingDetail } from "@/features/admin/bookings";

export const instant = false;
export const metadata: Metadata = { title: "Booking", robots: { index: false } };
export default function Page() { return <Suspense><AdminBookingDetail /></Suspense>; }
