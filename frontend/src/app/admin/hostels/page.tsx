import type { Metadata } from "next";
import { Suspense } from "react";
import { HostelsQueue } from "@/features/admin/hostels-queue";

export const instant = false;
export const metadata: Metadata = { title: "Listings", robots: { index: false } };
export default function Page() { return <Suspense><HostelsQueue /></Suspense>; }
