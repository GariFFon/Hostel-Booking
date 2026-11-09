import type { Metadata } from "next";
import { Suspense } from "react";
import { OwnerOverview } from "@/features/owner/overview";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Host dashboard", robots: { index: false } };
export default function Page() { return <Suspense><OwnerOverview /></Suspense>; }
