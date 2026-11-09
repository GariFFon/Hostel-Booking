import { Suspense } from "react";
import { AuthGate } from "@/components/common/auth-gate";
import { AccountNav } from "@/features/account/account-nav";

// Signed-in, client-rendered area behind <AuthGate>: nothing here can be prerendered, so skip instant-navigation validation.
export const instant = false;

export default function AccountLayout({ children }: LayoutProps<"/account">) {
  return (
    <Suspense>
      <AuthGate>
        <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-28 sm:px-6 md:py-10 md:pb-10">
          <AccountNav />
          <div className="mt-6">{children}</div>
        </div>
      </AuthGate>
    </Suspense>
  );
}
