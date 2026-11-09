import type { Metadata } from "next";
import { Suspense } from "react";
import { HostelReview } from "@/features/admin/hostel-review";

export const instant = false;
export const metadata: Metadata = { title: "Review listing", robots: { index: false } };
export default function Page() { return <Suspense><HostelReview /></Suspense>; }
