import type { Metadata } from "next";
import { AdminTenancies } from "@/features/admin/tenancies-list";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Stays", robots: { index: false } };
export default function Page() { return <AdminTenancies />; }
