import type { Metadata } from "next";
import { Suspense } from "react";
import { KycReview } from "@/features/admin/kyc";

export const instant = false;
export const metadata: Metadata = { title: "Verify host", robots: { index: false } };
export default function Page() { return <Suspense><KycReview /></Suspense>; }
