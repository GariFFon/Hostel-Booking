import type { Metadata } from "next";
import { Suspense } from "react";
import { OwnerReports } from "@/features/owner/reports";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Reports", robots: { index: false } };
export default function Page() { return <Suspense><OwnerReports /></Suspense>; }
