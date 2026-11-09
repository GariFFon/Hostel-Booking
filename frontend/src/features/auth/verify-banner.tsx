"use client";
import * as React from "react";
import { MailWarning } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useHydrated } from "@/hooks/use-hydrated";
import { useUser } from "@/lib/session/use-session";

/** Hosts can't publish and guests can't always book until the address is verified: say so, and make fixing it one tap. */
export function VerifyEmailBanner() {
  const { user } = useUser();
  const hydrated = useHydrated();
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  if (!hydrated || !user || user.emailVerified) return null;
  async function resend() {
    setSending(true);
    try { await unwrap(api.POST("/auth/resend-verification", { body: { email: user!.email } })); setSent(true); toast.success("Verification email sent"); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setSending(false); }
  }
  return (
    <div className="border-b bg-warning/10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6">
        <MailWarning className="size-4 shrink-0 text-warning" aria-hidden />
        <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">Verify <b>{user.email}</b> to unlock everything.</p>
        <Button variant="ghost" size="sm" onClick={resend} loading={sending} disabled={sent}>{sent ? "Sent. Check your inbox" : "Resend email"}</Button>
      </div>
    </div>
  );
}
