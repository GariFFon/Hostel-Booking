import type { Metadata } from "next";
import { Suspense } from "react";
import { OwnerBookingsList } from "@/features/owner/bookings-list";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Bookings", robots: { index: false } };
export default function Page() { return <Suspense><OwnerBookingsList /></Suspense>; }
