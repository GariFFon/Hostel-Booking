import { Suspense } from "react";
import { AuthGate } from "@/components/common/auth-gate";
import { OwnerShell } from "@/features/owner/owner-shell";

// Signed-in, client-rendered area behind <AuthGate>: nothing here can be prerendered, so skip instant-navigation validation.
export const instant = false;

export default function OwnerLayout({ children }: LayoutProps<"/owner">) {
  return <Suspense><AuthGate roles={["OWNER"]}><OwnerShell>{children}</OwnerShell></AuthGate></Suspense>;
}
