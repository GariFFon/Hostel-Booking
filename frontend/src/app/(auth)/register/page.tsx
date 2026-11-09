import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "@/features/auth/register-form";

export const metadata: Metadata = { title: "Create your account", robots: { index: false } };

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Create your account</h1>
      <p className="mt-1.5 mb-7 text-sm text-muted-foreground">Book stays, or list your own property.</p>
      <Suspense fallback={<div className="h-64" aria-hidden />}><RegisterForm /></Suspense>
    </>
  );
}
