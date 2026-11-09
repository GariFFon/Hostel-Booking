import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotForm } from "@/features/auth/recovery-forms";

export const metadata: Metadata = { title: "Forgot your password?", robots: { index: false } };

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Forgot your password?</h1>
      <p className="mt-1.5 mb-7 text-sm text-muted-foreground">Enter your email and we'll send you a reset link.</p>
      <Suspense fallback={<div className="h-64" aria-hidden />}><ForgotForm /></Suspense>
    </>
  );
}
