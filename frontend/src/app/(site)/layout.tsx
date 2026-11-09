import { Suspense } from "react";
import { BottomNav } from "@/components/layout/bottom-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { VerifyEmailBanner } from "@/features/auth/verify-banner";

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      <Suspense><VerifyEmailBanner /></Suspense>
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
      <Suspense><BottomNav /></Suspense>
    </>
  );
}
