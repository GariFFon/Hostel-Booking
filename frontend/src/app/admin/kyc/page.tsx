import type { Metadata } from "next";
import { Suspense } from "react";
import { KycQueue } from "@/features/admin/kyc";

export const instant = false;
export const metadata: Metadata = { title: "Host verification", robots: { index: false } };
export default function Page() { return <Suspense><KycQueue /></Suspense>; }
