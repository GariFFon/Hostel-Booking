import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminRent } from "@/features/admin/rent";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Rent", robots: { index: false } };
export default function Page() { return <Suspense><AdminRent /></Suspense>; }
