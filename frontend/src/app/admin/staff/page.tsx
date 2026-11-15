import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminStaff } from "@/features/staff/admin-staff";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Staff and vendors", robots: { index: false } };
export default function Page() { return <Suspense><AdminStaff /></Suspense>; }
