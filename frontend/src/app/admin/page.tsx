import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminOverview } from "@/features/admin/overview";

export const instant = false;
export const metadata: Metadata = { title: "Admin", robots: { index: false } };
export default function Page() { return <Suspense><AdminOverview /></Suspense>; }
