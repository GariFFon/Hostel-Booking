import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmail } from "@/features/auth/recovery-forms";

export const metadata: Metadata = { title: "Verify your email", robots: { index: false } };

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Verify your email</h1>
      <p className="mt-1.5 mb-7 text-sm text-muted-foreground">One moment while we confirm your address.</p>
      <Suspense fallback={<div className="h-64" aria-hidden />}><VerifyEmail /></Suspense>
    </>
  );
}
