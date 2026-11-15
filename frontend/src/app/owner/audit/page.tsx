import type { Metadata } from "next";
import { Suspense } from "react";
import { OwnerAudit } from "@/features/owner/audit";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Activity log", robots: { index: false } };
export default function Page() { return <Suspense><OwnerAudit /></Suspense>; }
