import type { Metadata } from "next";
import { Suspense } from "react";
import { WishlistList } from "@/features/account/wishlist-list";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Saved stays", robots: { index: false } };
export default function Page() { return <Suspense><WishlistList /></Suspense>; }
