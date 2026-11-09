"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, CheckCircle2, LogOut, MailWarning } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { FormField, describe } from "@/components/common/form-field";
import { PageHeader } from "@/components/common/page-header";
import { PasswordField } from "@/features/auth/password-field";
import { passwordField, phoneField } from "@/features/auth/schemas";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { uploadToCloudinary } from "@/lib/upload";
import { useSessionActions, useUser } from "@/lib/session/use-session";

const profileSchema = z.object({ fullName: z.string().trim().min(2, "Enter your full name").max(100), phone: z.union([z.literal(""), phoneField]) });
const passwordSchema = z.object({ currentPassword: z.string().min(1, "Enter your current password"), newPassword: passwordField }).refine((v) => v.currentPassword !== v.newPassword, { path: ["newPassword"], message: "Choose a different password" });

function AvatarSection() {
  const { user } = useUser();
  const { setUser } = useSessionActions();
  const [progress, setProgress] = React.useState<number | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      setProgress(0);
      const { publicId } = await uploadToCloudinary(file, "AVATAR", { onProgress: setProgress });
      setUser(await unwrapData(api.PUT("/me/avatar", { body: { publicId } })));
      toast.success("Profile photo updated");
    } catch (e) { toast.error(errorMessage(e)); }
    finally { setProgress(null); if (input.current) input.current.value = ""; }
  }
  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar src={user?.avatarUrl} name={user?.fullName ?? user?.email} className="size-20 text-2xl" />
        {progress !== null && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/80 text-xs font-medium tnum">{progress}%</span>}
      </div>
      <div className="grid gap-1.5">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="avatar-file" aria-label="Upload a profile photo" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button variant="outline" size="sm" loading={progress !== null} onClick={() => input.current?.click()}><Camera />Change photo</Button>
        <p className="text-xs text-muted-foreground">JPG, PNG or WebP, up to 3 MB.</p>
      </div>
    </div>
  );
}

function ProfileForm() {
  const { user } = useUser();
  const { setUser } = useSessionActions();
  const f = useForm<z.infer<typeof profileSchema>>({ resolver: zodResolver(profileSchema), values: { fullName: user?.fullName ?? "", phone: user?.phone ?? "" } });
  const save = useMutation({
    mutationFn: (v: z.infer<typeof profileSchema>) => unwrapData(api.PATCH("/me", { body: { fullName: v.fullName, phone: v.phone || null } })),
    onSuccess: (u) => { setUser(u); toast.success("Profile saved"); },
    onError: (e) => { if (isApiError(e)) for (const [k, m] of Object.entries(e.fieldErrors)) f.setError(k as "fullName", { message: m }); else toast.error(errorMessage(e)); },
  });
  const { register, handleSubmit, formState: { errors, isDirty } } = f;
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-4">
      <FormField label="Full name" htmlFor="fullName" error={errors.fullName?.message}><Input {...register("fullName")} {...describe("fullName", errors.fullName?.message)} autoComplete="name" /></FormField>
      <FormField label="Mobile number" htmlFor="phone" error={errors.phone?.message} hint="Used by hosts to reach you about a booking."><Input {...register("phone")} {...describe("phone", errors.phone?.message, true)} type="tel" inputMode="tel" autoComplete="tel" placeholder="+919876543210" /></FormField>
      <div><Button type="submit" loading={save.isPending} disabled={!isDirty}>Save changes</Button></div>
    </form>
  );
}

function EmailStatus() {
  const { user } = useUser();
  const [sent, setSent] = React.useState(false);
  const resend = useMutation({ mutationFn: () => unwrapData(api.POST("/auth/resend-verification", { body: { email: user!.email } })), onSuccess: () => { setSent(true); toast.success("Verification email sent"); }, onError: (e) => toast.error(errorMessage(e)) });
  if (!user) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5">
      <div className="min-w-0"><p className="text-sm text-muted-foreground">Email</p><p className="font-medium [overflow-wrap:anywhere]">{user.email}</p></div>
      {user.emailVerified ? <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success"><CheckCircle2 className="size-4" />Verified</span>
        : <Button variant="outline" size="sm" loading={resend.isPending} disabled={sent} onClick={() => resend.mutate()}><MailWarning />{sent ? "Sent" : "Verify email"}</Button>}
    </div>
  );
}

function PasswordSection() {
  const { user } = useUser();
  const { setUser } = useSessionActions();
  const [error, setError] = React.useState<string | null>(null);
  const f = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema) });
  const change = useMutation({
    mutationFn: (v: z.infer<typeof passwordSchema>) => unwrapData(api.POST("/me/password", { body: v })),
    onSuccess: (r) => { setUser(r.user); f.reset(); setError(null); toast.success("Password changed. Other devices were signed out."); },
    onError: (e) => setError(isApiError(e) && e.status === 401 ? "Your current password isn't right." : errorMessage(e)),
  });
  if (user && !user.hasPassword) return <p className="text-sm text-muted-foreground">You sign in with Google, so there&apos;s no password to change.</p>;
  const { register, handleSubmit, formState: { errors } } = f;
  return (
    <form onSubmit={handleSubmit((v) => { setError(null); change.mutate(v); })} noValidate className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <FormField label="Current password" htmlFor="cur" error={errors.currentPassword?.message}><PasswordField {...register("currentPassword")} {...describe("cur", errors.currentPassword?.message)} autoComplete="current-password" /></FormField>
      <FormField label="New password" htmlFor="new" error={errors.newPassword?.message} hint="At least 8 characters with a letter and a number."><PasswordField {...register("newPassword")} {...describe("new", errors.newPassword?.message, true)} autoComplete="new-password" /></FormField>
      <div><Button type="submit" variant="outline" loading={change.isPending}>Change password</Button></div>
    </form>
  );
}

function Preferences() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notification-preferences"], queryFn: () => unwrapData(api.GET("/me/notification-preferences")) });
  const save = useMutation({
    mutationFn: (patch: Partial<NonNullable<typeof q.data>>) => unwrapData(api.PATCH("/me/notification-preferences", { body: patch })),
    onMutate: async (patch) => { await qc.cancelQueries({ queryKey: ["notification-preferences"] }); const prev = qc.getQueryData(["notification-preferences"]); qc.setQueryData(["notification-preferences"], (c: object | undefined) => ({ ...c, ...patch })); return { prev }; },
    onError: (e, _p, ctx) => { qc.setQueryData(["notification-preferences"], ctx?.prev); toast.error(errorMessage(e)); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
  if (q.isPending) return <div className="grid gap-3"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>;
  if (q.isError) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  const p = q.data;
  const rows = [
    ["inAppBookings", "Booking updates in the app", "Confirmations, payments, refunds and reminders in your inbox."],
    ["inAppReviews", "Review activity in the app", "Review requests, new reviews and host replies."],
    ["emailBookings", "Pre-stay reminder emails", "A note the day before check-in. Confirmations and receipts are always emailed."],
    ["emailMarketing", "Tips and offers by email", "Occasional deals. Off unless you turn it on."],
  ] as const;
  return (
    <ul className="grid gap-1">
      {rows.map(([k, title, desc]) => (
        <li key={k} className="flex items-center justify-between gap-4 rounded-xl px-1 py-2.5">
          <label htmlFor={k} className="min-w-0 cursor-pointer"><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{desc}</span></label>
          <Switch id={k} checked={p[k]} onCheckedChange={(v) => save.mutate({ [k]: v })} />
        </li>
      ))}
    </ul>
  );
}

export function ProfileView() {
  const router = useRouter();
  const { user, hasRole } = useUser();
  const { reset } = useSessionActions();
  const becomeOwner = useMutation({ mutationFn: () => unwrapData(api.POST("/me/become-owner")), onSuccess: () => { toast.success("You're now a host."); router.push("/owner"); router.refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const logoutAll = useMutation({
    mutationFn: () => unwrapData(api.POST("/auth/logout-all")),
    onSuccess: () => { reset(null); router.push("/"); router.refresh(); toast.success("Signed out everywhere"); }, onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title="Account settings" />
      <Card><CardHeader><CardTitle>Profile</CardTitle></CardHeader><CardContent className="grid gap-5"><AvatarSection /><EmailStatus /><ProfileForm /></CardContent></Card>
      <Card><CardHeader><CardTitle>Password</CardTitle><CardDescription>Changing it signs you out on your other devices.</CardDescription></CardHeader><CardContent><PasswordSection /></CardContent></Card>
      <Card id="notifications" className="scroll-mt-24"><CardHeader><CardTitle>Notifications</CardTitle><CardDescription>Account and security messages can&apos;t be turned off.</CardDescription></CardHeader><CardContent><Preferences /></CardContent></Card>
      <Card><CardHeader><CardTitle>Hosting</CardTitle></CardHeader><CardContent className="flex flex-wrap items-center justify-between gap-3">
        {hasRole("OWNER") ? <><p className="text-sm text-muted-foreground">You&apos;re a host. Manage your properties and bookings.</p><Button asChild><Link href="/owner">Host dashboard</Link></Button></>
          : <><p className="text-sm text-muted-foreground">List your own hostel or PG and start receiving bookings.</p><Button loading={becomeOwner.isPending} onClick={() => becomeOwner.mutate()} disabled={!user}>Become a host</Button></>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Sessions</CardTitle></CardHeader><CardContent className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Sign out of this and every other device.</p><Button variant="outline" loading={logoutAll.isPending} onClick={() => logoutAll.mutate()}><LogOut />Sign out everywhere</Button></CardContent></Card>
    </div>
  );
}
