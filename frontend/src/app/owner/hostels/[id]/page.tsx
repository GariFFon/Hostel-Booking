import type { Metadata } from "next";
import { Suspense } from "react";
import { HostelEditor } from "@/features/owner/hostel-editor";

export const instant = false; // signed-in, fully client-rendered editor
export const metadata: Metadata = { title: "Edit property", robots: { index: false } };
export default function Page() { return <Suspense><HostelEditor /></Suspense>; }
