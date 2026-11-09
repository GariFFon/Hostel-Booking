import type { Metadata } from "next";
import { Suspense } from "react";
import { MyReviews } from "@/features/account/reviews-list";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Your reviews", robots: { index: false } };
export default function Page() { return <Suspense><MyReviews /></Suspense>; }
