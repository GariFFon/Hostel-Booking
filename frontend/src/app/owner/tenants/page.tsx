import type { Metadata } from "next";
import { Suspense } from "react";
import { OwnerTenants } from "@/features/owner/tenants";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Tenants", robots: { index: false } };
export default function Page() { return <Suspense><OwnerTenants /></Suspense>; }
