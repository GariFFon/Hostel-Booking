import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetForm } from "@/features/auth/recovery-forms";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Choose a new password</h1>
      <p className="mt-1.5 mb-7 text-sm text-muted-foreground">Pick something you haven't used elsewhere.</p>
      <Suspense fallback={<div className="h-64" aria-hidden />}><ResetForm /></Suspense>
    </>
  );
}
