import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminBookings } from "@/features/admin/bookings";

export const instant = false;
export const metadata: Metadata = { title: "Bookings", robots: { index: false } };
export default function Page() { return <Suspense><AdminBookings /></Suspense>; }
