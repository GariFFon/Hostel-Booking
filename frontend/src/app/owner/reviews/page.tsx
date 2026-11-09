import type { Metadata } from "next";
import { Suspense } from "react";
import { OwnerReviews } from "@/features/owner/reviews-view";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Reviews", robots: { index: false } };
export default function Page() { return <Suspense><OwnerReviews /></Suspense>; }
