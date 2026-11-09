import { Suspense } from "react";
import { AuthGate } from "@/components/common/auth-gate";
import { AdminShell } from "@/features/admin/admin-shell";

// Signed-in, client-rendered area behind <AuthGate>: nothing here can be prerendered, so skip instant-navigation validation.
export const instant = false;

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <Suspense><AuthGate roles={["ADMIN"]}><AdminShell>{children}</AdminShell></AuthGate></Suspense>;
}
