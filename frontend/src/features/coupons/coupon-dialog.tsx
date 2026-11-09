"use client";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FormField, describe } from "@/components/common/form-field";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { localToday } from "@/lib/format";
import type { Item } from "@/lib/api/types";

export type Coupon = Item<"/owner/coupons">;
type Role = "OWNER" | "ADMIN";

const num = (msg: string) => z.string().trim().regex(/^\d+(\.\d{1,2})?$/, msg);
const schema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{3,19}$/, "4-20 characters: letters, digits, - or _"),
  description: z.string().trim().max(200).optional(),
  discountType: z.enum(["PERCENT", "FLAT"]),
  value: num("Enter a number"),
  maxDiscount: z.union([z.literal(""), num("Enter an amount in ₹")]).optional(),
  minBooking: z.union([z.literal(""), num("Enter an amount in ₹")]).optional(),
  hostelId: z.string().optional(),
  validFrom: z.string().min(1, "Choose a start date"),
  validTo: z.string().min(1, "Choose an end date"),
  usageLimit: z.union([z.literal(""), z.string().regex(/^\d+$/, "Whole number")]).optional(),
  perUserLimit: z.string().regex(/^\d+$/, "Whole number"),
  isPublic: z.boolean(), isActive: z.boolean(),
}).superRefine((v, ctx) => {
  const n = Number(v.value);
  if (v.discountType === "PERCENT" && !(n >= 1 && n <= 100)) ctx.addIssue({ code: "custom", path: ["value"], message: "Between 1% and 100%" });
  if (v.discountType === "FLAT" && !(n >= 1 && n <= 50000)) ctx.addIssue({ code: "custom", path: ["value"], message: "Between ₹1 and ₹50,000" });
  if (v.validTo < v.validFrom) ctx.addIssue({ code: "custom", path: ["validTo"], message: "Must be after the start date" });
  if (v.usageLimit !== "" && v.usageLimit !== undefined && Number(v.usageLimit) < 1) ctx.addIssue({ code: "custom", path: ["usageLimit"], message: "At least 1, or leave empty" });
  if (Number(v.perUserLimit) < 1) ctx.addIssue({ code: "custom", path: ["perUserLimit"], message: "At least 1" });
});
type V = z.infer<typeof schema>;
const rp = (rupees?: string) => (rupees ? Math.round(Number(rupees) * 100) : undefined);
const day = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST calendar date

export function CouponDialog({ role, coupon, hostels, open, onOpenChange, onSaved }: { role: Role; coupon: Coupon | null; hostels: { id: string; name: string }[]; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const editing = !!coupon;
  const [error, setError] = React.useState<string | null>(null);
  const today = localToday();
  const f = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: coupon ? {
      code: coupon.code, description: coupon.description ?? "", discountType: coupon.discountType, value: String(coupon.discountType === "PERCENT" ? (coupon.percentBps ?? 0) / 100 : (coupon.flatPaise ?? 0) / 100),
      maxDiscount: coupon.maxDiscountPaise ? String(coupon.maxDiscountPaise / 100) : "", minBooking: coupon.minBookingPaise ? String(coupon.minBookingPaise / 100) : "", hostelId: coupon.hostel?.id ?? "",
      validFrom: day(coupon.validFrom), validTo: day(coupon.validTo), usageLimit: coupon.usageLimit ? String(coupon.usageLimit) : "", perUserLimit: String(coupon.perUserLimit), isPublic: coupon.isPublic, isActive: coupon.isActive,
    } : { code: "", description: "", discountType: "PERCENT", value: "10", maxDiscount: "", minBooking: "", hostelId: hostels[0]?.id ?? "", validFrom: today, validTo: "", usageLimit: "", perUserLimit: "1", isPublic: false, isActive: true },
  });
  const { register, control, handleSubmit, setError: setFieldError, formState: { errors, isSubmitting } } = f;
  const type = useWatch({ control, name: "discountType" });
  const validFromValue = useWatch({ control, name: "validFrom" });
  const moderateOnly = role === "ADMIN" && !!coupon?.hostel; // admins moderate host coupons; they don't rewrite them

  async function submit(v: V) {
    setError(null);
    const validFrom = `${v.validFrom}T00:00:00+05:30`, validTo = `${v.validTo}T23:59:59+05:30`;
    try {
      if (editing) {
        const base = moderateOnly ? { isActive: v.isActive, isPublic: v.isPublic } : {
          description: v.description || null, ...(type === "PERCENT" ? { percentBps: Math.round(Number(v.value) * 100), maxDiscountPaise: rp(v.maxDiscount) ?? null } : { flatPaise: rp(v.value) }),
          minBookingPaise: rp(v.minBooking) ?? 0, validFrom, validTo, usageLimit: v.usageLimit ? Number(v.usageLimit) : null, perUserLimit: Number(v.perUserLimit), isActive: v.isActive, isPublic: v.isPublic,
        };
        if (role === "ADMIN") await unwrapData(api.PATCH("/admin/coupons/{id}", { params: { path: { id: coupon!.id } }, body: base }));
        else await unwrapData(api.PATCH("/owner/coupons/{id}", { params: { path: { id: coupon!.id } }, body: base }));
      } else {
        const body = {
          code: v.code, ...(v.description ? { description: v.description } : {}), discountType: v.discountType,
          ...(type === "PERCENT" ? { percentBps: Math.round(Number(v.value) * 100), ...(rp(v.maxDiscount) ? { maxDiscountPaise: rp(v.maxDiscount) } : {}) } : { flatPaise: rp(v.value) }),
          minBookingPaise: rp(v.minBooking) ?? 0, validFrom, validTo, ...(v.usageLimit ? { usageLimit: Number(v.usageLimit) } : {}), perUserLimit: Number(v.perUserLimit), isActive: v.isActive, isPublic: v.isPublic,
        };
        if (role === "ADMIN") await unwrapData(api.POST("/admin/coupons", { body }));
        else await unwrapData(api.POST("/owner/coupons", { body: { ...body, hostelId: v.hostelId! } }));
      }
      onSaved(); onOpenChange(false);
    } catch (e) {
      if (isApiError(e) && Object.keys(e.fieldErrors).length) {
        const map: Record<string, keyof V> = { percentBps: "value", flatPaise: "value", maxDiscountPaise: "maxDiscount", minBookingPaise: "minBooking" };
        for (const [k, m] of Object.entries(e.fieldErrors)) setFieldError((map[k] ?? k) as keyof V, { message: m });
      } else setError(errorMessage(e));
    }
  }
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={editing ? (moderateOnly ? "Moderate coupon" : "Edit coupon") : "New coupon"} description={role === "ADMIN" ? "Platform coupons are paid for by the platform; hosts are paid in full." : "Paid for by you: the discount reduces your payout."} className="sm:max-w-lg" dismissible={!isSubmitting}>
      <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
        <div className="grid max-h-[60dvh] gap-4 overflow-y-auto overscroll-contain p-0.5">
          {error && <Alert tone="danger">{error}</Alert>}
          {moderateOnly && <Alert tone="info">This is a host&apos;s coupon. You can switch it off or unlist it, but the host controls its terms.</Alert>}
          <FormField label="Code" htmlFor="cp-code" error={errors.code?.message} hint={editing ? "The code can't be changed." : "Guests type this at checkout. Letters and digits only."} required><Input {...register("code")} {...describe("cp-code", errors.code?.message, true)} disabled={editing} className="font-mono uppercase" autoCapitalize="characters" maxLength={20} /></FormField>
          {!moderateOnly && <>
            {role === "OWNER" && !editing && <FormField label="Property" htmlFor="cp-h" required><Controller control={control} name="hostelId" render={({ field }) => <Select value={field.value} onValueChange={field.onChange}><SelectTrigger id="cp-h"><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent>{hostels.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent></Select>} /></FormField>}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Discount" htmlFor="cp-type"><Controller control={control} name="discountType" render={({ field }) => <Select value={field.value} onValueChange={field.onChange} disabled={editing}><SelectTrigger id="cp-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PERCENT">Percentage off</SelectItem><SelectItem value="FLAT">Flat amount off</SelectItem></SelectContent></Select>} /></FormField>
              <FormField label={type === "PERCENT" ? "Percent off" : "Amount off (₹)"} htmlFor="cp-val" error={errors.value?.message} required><Input {...register("value")} {...describe("cp-val", errors.value?.message)} inputMode="decimal" /></FormField>
              {type === "PERCENT" && <FormField label="Maximum discount (₹)" htmlFor="cp-max" error={errors.maxDiscount?.message} hint="Optional cap."><Input {...register("maxDiscount")} {...describe("cp-max", errors.maxDiscount?.message, true)} inputMode="decimal" /></FormField>}
              <FormField label="Minimum booking (₹)" htmlFor="cp-min" error={errors.minBooking?.message} hint="Before GST."><Input {...register("minBooking")} {...describe("cp-min", errors.minBooking?.message, true)} inputMode="decimal" /></FormField>
              <FormField label="Valid from" htmlFor="cp-from" error={errors.validFrom?.message}><Input {...register("validFrom")} {...describe("cp-from", errors.validFrom?.message)} type="date" /></FormField>
              <FormField label="Valid until (inclusive)" htmlFor="cp-to" error={errors.validTo?.message}><Input {...register("validTo")} {...describe("cp-to", errors.validTo?.message)} type="date" min={validFromValue || today} /></FormField>
              <FormField label="Total uses" htmlFor="cp-use" error={errors.usageLimit?.message} hint="Empty = unlimited."><Input {...register("usageLimit")} {...describe("cp-use", errors.usageLimit?.message, true)} inputMode="numeric" /></FormField>
              <FormField label="Uses per guest" htmlFor="cp-pu" error={errors.perUserLimit?.message}><Input {...register("perUserLimit")} {...describe("cp-pu", errors.perUserLimit?.message)} inputMode="numeric" /></FormField>
            </div>
            <FormField label="Description" htmlFor="cp-d" error={errors.description?.message}><Input {...register("description")} {...describe("cp-d", errors.description?.message)} maxLength={200} placeholder="Shown with the offer, e.g. Early bird" /></FormField>
          </>}
          <div className="grid gap-3 rounded-xl border p-3.5">
            <label className="flex items-center justify-between gap-4 text-sm"><span><span className="block font-medium">Show on the property page</span><span className="block text-xs text-muted-foreground">Otherwise it&apos;s a private code you share yourself.</span></span><Controller control={control} name="isPublic" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} /></label>
            <label className="flex items-center justify-between gap-4 text-sm"><span className="font-medium">Active</span><Controller control={control} name="isActive" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} /></label>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button><Button type="submit" loading={isSubmitting}>{editing ? "Save changes" : "Create coupon"}</Button></div>
      </form>
    </ResponsiveDialog>
  );
}
