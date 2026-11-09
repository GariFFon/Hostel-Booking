import type { Metadata } from "next";
import { Suspense } from "react";
import { NewHostel } from "@/features/owner/new-hostel";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "New property", robots: { index: false } };
export default function Page() { return <Suspense><NewHostel /></Suspense>; }
