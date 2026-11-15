import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminComplaints } from "@/features/complaints/admin-complaints";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Complaints", robots: { index: false } };
export default function Page() { return <Suspense><AdminComplaints /></Suspense>; }
