"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Building2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useHydrated } from "@/hooks/use-hydrated";
import { useSessionActions, useUser, type Role } from "@/lib/session/use-session";

/**
 * Wraps a signed-in area. Signed out → sign-in (and back). Wrong role → an explanation with the next step, never a blank page.
 * (The backend authorises every call; this is the experience, not the security boundary.)
 */
export function AuthGate({ roles, children }: { roles?: Role[]; children: React.ReactNode }) {
  const { user, isLoading, hasRole } = useUser();
  const hydrated = useHydrated();
  const router = useRouter();
  const path = usePathname();
  const { refresh } = useSessionActions();
  React.useEffect(() => { if (!isLoading && !user) router.replace(`/login?next=${encodeURIComponent(path)}`); }, [isLoading, user, router, path]);

  const becomeOwner = useMutation({
    mutationFn: () => unwrap(api.POST("/me/become-owner")),
    onSuccess: async () => { await refresh(); toast.success("You're now a host. Let's set up your first property."); router.refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!hydrated || isLoading || !user) return <div className="mx-auto max-w-5xl px-4 py-10" aria-busy><Skeleton className="h-9 w-56" /><Skeleton className="mt-6 h-64" /></div>;
  if (roles && !roles.some((r) => hasRole(r))) {
    const wantsOwner = roles.includes("OWNER") && !roles.includes("ADMIN");
    return (
      <div className="mx-auto max-w-xl px-4 py-20">
        <EmptyState icon={wantsOwner ? Building2 : ShieldAlert} title={wantsOwner ? "Become a host to list your property" : "You don't have access to this area"}
          description={wantsOwner ? "Your account is set up for booking stays. Add hosting to list a hostel or PG, set prices and manage bookings." : "This section is for administrators."}
          action={wantsOwner ? <Button loading={becomeOwner.isPending} onClick={() => becomeOwner.mutate()}>Start hosting</Button> : <Button asChild variant="outline"><Link href="/">Go home</Link></Button>} />
      </div>
    );
  }
  return <>{children}</>;
}
