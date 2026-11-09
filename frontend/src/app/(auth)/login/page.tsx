import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Sign in</h1>
      <p className="mt-1.5 mb-7 text-sm text-muted-foreground">Welcome back. Pick up where you left off.</p>
      <Suspense fallback={<div className="h-64" aria-hidden />}><LoginForm /></Suspense>
    </>
  );
}
