import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminReviews } from "@/features/admin/reviews";

export const instant = false;
export const metadata: Metadata = { title: "Review moderation", robots: { index: false } };
export default function Page() { return <Suspense><AdminReviews /></Suspense>; }
