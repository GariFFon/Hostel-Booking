import type { Metadata } from "next";
import { Suspense } from "react";
import { Verification } from "@/features/owner/verification";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Verification", robots: { index: false } };
export default function Page() { return <Suspense><Verification /></Suspense>; }
