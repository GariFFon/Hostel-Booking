import type { Metadata } from "next";
import { Suspense } from "react";
import { HideTabBar } from "@/components/layout/hide-tab-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckoutView } from "@/features/checkout/checkout-view";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Review and book", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <>
      <HideTabBar />
      <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10"><Skeleton className="h-9 w-64" /><Skeleton className="mt-8 h-96" /></div>}><CheckoutView /></Suspense>
    </>
  );
}
