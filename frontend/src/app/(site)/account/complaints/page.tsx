import type { Metadata } from "next";
import { Suspense } from "react";
import { TenantComplaints } from "@/features/complaints/tenant-complaints";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Complaints", robots: { index: false } };
export default function Page() { return <Suspense><TenantComplaints /></Suspense>; }
