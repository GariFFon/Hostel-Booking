import type { Metadata } from "next";
import { Suspense } from "react";
import { NotificationsList } from "@/features/account/notifications-list";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Notifications", robots: { index: false } };
export default function Page() { return <Suspense><NotificationsList /></Suspense>; }
