import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditViewer } from "@/features/admin/audit";

export const instant = false;
export const metadata: Metadata = { title: "Audit log", robots: { index: false } };
export default function Page() { return <Suspense><AuditViewer /></Suspense>; }
