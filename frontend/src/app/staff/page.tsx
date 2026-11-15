import type { Metadata } from "next";
import { Suspense } from "react";
import { StaffJobs } from "@/features/staff/staff-jobs";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "My jobs", robots: { index: false } };
export default function Page() { return <Suspense><StaffJobs /></Suspense>; }
