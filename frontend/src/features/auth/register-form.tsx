"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Building2, Backpack } from "lucide-react";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, describe } from "@/components/common/form-field";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { safeNext } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import { useSessionActions } from "@/lib/session/use-session";
import { PasswordField } from "./password-field";
import { registerSchema } from "./schemas";

type Values = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { reset } = useSessionActions();
  const [error, setError] = React.useState<string | null>(null);
  const { register, control, handleSubmit, setError: setFieldError, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", email: "", phone: "", password: "", role: params.get("as") === "host" ? "OWNER" : "GUEST" },
  });

  async function onSubmit(v: Values) {
    setError(null);
    try {
      const { data } = await unwrap(api.POST("/auth/register", { body: { fullName: v.fullName, email: v.email, password: v.password, role: v.role, ...(v.phone ? { phone: v.phone } : {}) } }));
      reset(data.user);
      toast.success("Account created. Check your email to verify your address.");
      router.replace(v.role === "OWNER" ? "/owner" : next);
      router.refresh();
    } catch (e) {
      if (isApiError(e) && e.status === 409) setFieldError("email", { message: "An account with this email already exists. Try signing in." });
      else if (isApiError(e) && Object.keys(e.fieldErrors).length) for (const [k, m] of Object.entries(e.fieldErrors)) setFieldError(k as keyof Values, { message: m });
      else setError(errorMessage(e));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <Controller control={control} name="role" render={({ field }) => (
        <div role="radiogroup" aria-label="I want to" className="grid grid-cols-2 gap-2">
          {([["GUEST", "Book stays", Backpack], ["OWNER", "List my property", Building2]] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" role="radio" aria-checked={field.value === value} onClick={() => field.onChange(value)}
              className={cn("pressable flex min-h-14 items-center gap-2.5 rounded-xl border px-3.5 text-left text-sm font-medium outline-none transition-[border-color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring", field.value === value ? "border-primary bg-accent text-accent-foreground" : "bg-card hover:bg-muted")}>
              <Icon className="size-5 shrink-0" /> <span>{label}</span>
            </button>
          ))}
        </div>
      )} />
      <FormField label="Full name" htmlFor="fullName" error={errors.fullName?.message}>
        <Input {...register("fullName")} {...describe("fullName", errors.fullName?.message)} autoComplete="name" enterKeyHint="next" />
      </FormField>
      <FormField label="Email" htmlFor="email" error={errors.email?.message}>
        <Input {...register("email")} {...describe("email", errors.email?.message)} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" enterKeyHint="next" />
      </FormField>
      <FormField label="Mobile number" htmlFor="phone" error={errors.phone?.message} hint="Optional. Hosts use it to reach you about a booking.">
        <Input {...register("phone")} {...describe("phone", errors.phone?.message, true)} type="tel" inputMode="tel" autoComplete="tel" placeholder="+919876543210" enterKeyHint="next" />
      </FormField>
      <FormField label="Password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters with a letter and a number.">
        <PasswordField {...register("password")} {...describe("password", errors.password?.message, true)} autoComplete="new-password" enterKeyHint="go" />
      </FormField>
      <Button type="submit" size="lg" loading={isSubmitting}>Create account</Button>
      <p className="text-center text-sm text-muted-foreground">Already have an account? <Link href={`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-primary underline-offset-4 hover:underline">Sign in</Link></p>
    </form>
  );
}
