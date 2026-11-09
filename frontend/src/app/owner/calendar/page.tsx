import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarView } from "@/features/owner/calendar-view";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Calendar", robots: { index: false } };
export default function Page() { return <Suspense><CalendarView /></Suspense>; }
