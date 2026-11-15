import { Suspense } from "react";
import { AuthGate } from "@/components/common/auth-gate";
import { StaffShell } from "@/features/staff/staff-shell";

// Signed-in, client-rendered area behind <AuthGate>: nothing here can be prerendered, so skip instant-navigation validation.
export const instant = false;

// No role is required here: someone accepting their first invitation does not have the STAFF role yet. The page decides what to show.
export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  return <Suspense><AuthGate><StaffShell>{children}</StaffShell></AuthGate></Suspense>;
}
