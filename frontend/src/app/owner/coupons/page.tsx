import type { Metadata } from "next";
import { Suspense } from "react";
import { CouponsManager } from "@/features/coupons/coupons-manager";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Coupons", robots: { index: false } };
export default function Page() { return <Suspense><CouponsManager role="OWNER" /></Suspense>; }
