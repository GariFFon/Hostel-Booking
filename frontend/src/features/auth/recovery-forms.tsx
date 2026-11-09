"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, MailCheck, XCircle } from "lucide-react";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, describe } from "@/components/common/form-field";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useSessionActions } from "@/lib/session/use-session";
import { PasswordField } from "./password-field";
import { forgotSchema, resetSchema } from "./schemas";

export function ForgotForm() {
  const [sent, setSent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema) });
  async function onSubmit({ email }: z.infer<typeof forgotSchema>) {
    setError(null);
    try { await unwrap(api.POST("/auth/forgot-password", { body: { email } })); setSent(email); }
    catch (e) { setError(errorMessage(e)); }
  }
  if (sent) {
    return (
      <div className="grid gap-4 text-center">
        <MailCheck className="mx-auto size-10 text-primary" />
        <p className="font-medium">Check your inbox</p>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">If an account exists for <b>{sent}</b>, we&apos;ve sent a link to reset your password. It expires in an hour.</p>
        <Button asChild variant="outline"><Link href="/login">Back to sign in</Link></Button>
      </div>
    );
  }
  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <FormField label="Email" htmlFor="email" error={errors.email?.message}>
        <Input {...register("email")} {...describe("email", errors.email?.message)} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" enterKeyHint="send" />
      </FormField>
      <Button type="submit" size="lg" loading={isSubmitting}>Send reset link</Button>
      <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">Back to sign in</Link>
    </form>
  );
}

export function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = React.useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });
  if (token.length < 20) return <Alert tone="danger" title="This link isn't valid">Open the link from your email again, or request a new one.</Alert>;
  async function onSubmit(v: z.infer<typeof resetSchema>) {
    setError(null);
    try { await unwrap(api.POST("/auth/reset-password", { body: { token, password: v.password } })); router.replace("/login?reset=1"); }
    catch (e) { setError(errorMessage(e, "This link has expired or was already used. Request a new one.")); }
  }
  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {error && <Alert tone="danger">{error} <Link href="/forgot-password" className="font-medium underline">Request a new link</Link></Alert>}
      <FormField label="New password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters with a letter and a number.">
        <PasswordField {...register("password")} {...describe("password", errors.password?.message, true)} autoComplete="new-password" />
      </FormField>
      <FormField label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
        <PasswordField {...register("confirm")} {...describe("confirm", errors.confirm?.message)} autoComplete="new-password" enterKeyHint="go" />
      </FormField>
      <Button type="submit" size="lg" loading={isSubmitting}>Set new password</Button>
    </form>
  );
}

/** Runs once on mount: the emailed link carries the token. Safe under StrictMode (the ref guards the double effect). */
export function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const { refresh } = useSessionActions();
  const [state, setState] = React.useState<"working" | "ok" | "bad">(token ? "working" : "bad");
  const started = React.useRef(false);
  React.useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    unwrap(api.POST("/auth/verify-email", { body: { token } })).then(() => { setState("ok"); refresh(); }).catch(() => setState("bad"));
  }, [token, refresh]);
  if (state === "working") return <p className="text-center text-sm text-muted-foreground" role="status">Verifying your email…</p>;
  return state === "ok" ? (
    <div className="grid gap-4 text-center">
      <CheckCircle2 className="mx-auto size-10 text-success" />
      <p className="font-medium">Email verified</p>
      <Button asChild><Link href="/account/bookings">Continue</Link></Button>
    </div>
  ) : (
    <div className="grid gap-4 text-center">
      <XCircle className="mx-auto size-10 text-destructive" />
      <p className="font-medium">This link has expired or isn&apos;t valid</p>
      <p className="text-sm text-muted-foreground">Sign in and use &ldquo;Resend verification&rdquo; to get a fresh one.</p>
      <Button asChild variant="outline"><Link href="/login">Sign in</Link></Button>
    </div>
  );
}
