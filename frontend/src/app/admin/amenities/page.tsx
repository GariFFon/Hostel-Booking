import type { Metadata } from "next";
import { Suspense } from "react";
import { AmenitiesAdmin } from "@/features/admin/amenities";

export const instant = false;
export const metadata: Metadata = { title: "Amenities", robots: { index: false } };
export default function Page() { return <Suspense><AmenitiesAdmin /></Suspense>; }
