import type { Metadata } from "next";
import { Suspense } from "react";
import { HostelsList } from "@/features/owner/hostels-list";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Properties", robots: { index: false } };
export default function Page() { return <Suspense><HostelsList /></Suspense>; }
