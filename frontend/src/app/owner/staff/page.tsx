import type { Metadata } from "next";
import { Suspense } from "react";
import { OwnerStaff } from "@/features/staff/owner-staff";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Staff", robots: { index: false } };
export default function Page() { return <Suspense><OwnerStaff /></Suspense>; }
