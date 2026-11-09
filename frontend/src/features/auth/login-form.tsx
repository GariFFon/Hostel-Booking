"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, describe } from "@/components/common/form-field";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { safeNext } from "@/lib/safe-redirect";
import { useSessionActions } from "@/lib/session/use-session";
import { PasswordField } from "./password-field";
import { loginSchema } from "./schemas";

type Values = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { reset } = useSessionActions();
  const [error, setError] = React.useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  async function onSubmit(values: Values) {
    setError(null);
    try {
      const { data } = await unwrap(api.POST("/auth/login", { body: values }));
      reset(data.user);
      toast.success(`Welcome back${data.user.fullName ? `, ${data.user.fullName.split(" ")[0]}` : ""}`);
      router.replace(next);
      router.refresh();
    } catch (e) {
      setError(isApiError(e) && e.status === 401 ? "That email and password don't match. Check them and try again." : errorMessage(e));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {params.get("reset") && <Alert tone="success">Password updated. Sign in with your new password.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <FormField label="Email" htmlFor="email" error={errors.email?.message}>
        <Input {...register("email")} {...describe("email", errors.email?.message)} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" enterKeyHint="next" placeholder="you@example.com" />
      </FormField>
      <FormField label="Password" htmlFor="password" error={errors.password?.message}>
        <PasswordField {...register("password")} {...describe("password", errors.password?.message)} autoComplete="current-password" enterKeyHint="go" />
      </FormField>
      <div className="-mt-1 text-right"><Link href="/forgot-password" className="text-sm text-primary underline-offset-4 hover:underline">Forgot password?</Link></div>
      <Button type="submit" size="lg" loading={isSubmitting}>Sign in</Button>
      <p className="text-center text-sm text-muted-foreground">New here? <Link href={`/register${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-primary underline-offset-4 hover:underline">Create an account</Link></p>
    </form>
  );
}
