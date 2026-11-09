import type { Metadata } from "next";
import { Suspense } from "react";
import { EarningsView } from "@/features/owner/earnings-view";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Earnings", robots: { index: false } };
export default function Page() { return <Suspense><EarningsView /></Suspense>; }
