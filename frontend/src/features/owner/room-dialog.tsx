"use client";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField, describe } from "@/components/common/form-field";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/errors";
import type { RoomType } from "./rooms-tab";

const int = (min: number, max: number, msg: string) => z.string().trim().regex(/^\d+$/, msg).refine((v) => Number(v) >= min && Number(v) <= max, msg);
const schema = z.object({
  name: z.string().trim().min(2, "Give it a name").max(100),
  description: z.string().trim().max(1000).optional(),
  kind: z.enum(["DORM", "PRIVATE"]),
  gender: z.enum(["MIXED", "MALE", "FEMALE"]),
  totalUnits: int(1, 500, "Enter a number from 1 to 500"),
  maxOccupancyPerUnit: int(1, 10, "Enter a number from 1 to 10"),
  priceRupees: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter a price like 850 or 850.50").refine((v) => Number(v) >= 1 && Number(v) <= 100000, "Price must be between ₹1 and ₹1,00,000"),
  priceUnit: z.enum(["NIGHT", "MONTH"]),
  minStayNights: int(1, 365, "Enter 1 to 365"),
  maxStayNights: int(1, 365, "Enter 1 to 365"),
}).superRefine((v, ctx) => {
  if (v.kind === "DORM" && v.maxOccupancyPerUnit !== "1") ctx.addIssue({ code: "custom", path: ["maxOccupancyPerUnit"], message: "A dorm unit is a single bed" });
  if (v.kind === "PRIVATE" && v.gender !== "MIXED") ctx.addIssue({ code: "custom", path: ["gender"], message: "Only dorm beds can be gender-specific" });
  if (Number(v.maxStayNights) < Number(v.minStayNights)) ctx.addIssue({ code: "custom", path: ["maxStayNights"], message: "Must be at least the minimum stay" });
});
type V = z.infer<typeof schema>;

export function RoomDialog({ hostelId, room, open, onOpenChange, onSaved }: { hostelId: string; room: RoomType | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [error, setError] = React.useState<string | null>(null);
  const f = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: room ? { name: room.name, description: room.description ?? "", kind: room.kind, gender: room.gender, totalUnits: String(room.totalUnits), maxOccupancyPerUnit: String(room.maxOccupancyPerUnit), priceRupees: String(room.basePricePaise / 100), priceUnit: room.priceUnit, minStayNights: String(room.minStayNights), maxStayNights: String(room.maxStayNights) }
      : { name: "", description: "", kind: "DORM", gender: "MIXED", totalUnits: "6", maxOccupancyPerUnit: "1", priceRupees: "", priceUnit: "NIGHT", minStayNights: "1", maxStayNights: "30" },
  });
  const { register, control, handleSubmit, setValue, setError: setFieldError, formState: { errors, isSubmitting } } = f;
  const kind = useWatch({ control, name: "kind" });
  async function submit(v: V) {
    setError(null);
    const body = { name: v.name, description: v.description || null, kind: v.kind, gender: v.gender, totalUnits: Number(v.totalUnits), maxOccupancyPerUnit: Number(v.maxOccupancyPerUnit), basePricePaise: Math.round(Number(v.priceRupees) * 100), priceUnit: v.priceUnit, minStayNights: Number(v.minStayNights), maxStayNights: Number(v.maxStayNights) };
    try {
      if (room) await unwrapData(api.PATCH("/owner/room-types/{id}", { params: { path: { id: room.id } }, body }));
      else await unwrapData(api.POST("/owner/hostels/{id}/room-types", { params: { path: { id: hostelId } }, body }));
      onSaved(); onOpenChange(false);
    } catch (e) {
      if (isApiError(e) && Object.keys(e.fieldErrors).length) { for (const [k, m] of Object.entries(e.fieldErrors)) setFieldError((k === "basePricePaise" ? "priceRupees" : k) as keyof V, { message: m }); }
      else setError(errorMessage(e));
    }
  }
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={room ? "Edit room type" : "Add a room type"} className="sm:max-w-lg" dismissible={!isSubmitting}>
      <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4">
        <div className="grid max-h-[60dvh] gap-4 overflow-y-auto overscroll-contain p-0.5">
          {error && <Alert tone="danger">{error}</Alert>}
          <FormField label="Name" htmlFor="rname" error={errors.name?.message} required><Input {...register("name")} {...describe("rname", errors.name?.message)} placeholder="e.g. 8-bed mixed dorm" /></FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Type" htmlFor="rkind"><Controller control={control} name="kind" render={({ field }) => (
              <Select value={field.value} onValueChange={(v) => { field.onChange(v); if (v === "DORM") setValue("maxOccupancyPerUnit", "1"); if (v === "PRIVATE") setValue("gender", "MIXED"); }}><SelectTrigger id="rkind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="DORM">Dorm bed</SelectItem><SelectItem value="PRIVATE">Private room</SelectItem></SelectContent></Select>
            )} /></FormField>
            <FormField label="Who can book" htmlFor="rgender" error={errors.gender?.message}><Controller control={control} name="gender" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={kind === "PRIVATE"}><SelectTrigger id="rgender"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MIXED">Anyone</SelectItem><SelectItem value="FEMALE">Women only</SelectItem><SelectItem value="MALE">Men only</SelectItem></SelectContent></Select>
            )} /></FormField>
            <FormField label={kind === "DORM" ? "Number of beds" : "Number of rooms"} htmlFor="units" error={errors.totalUnits?.message}><Input {...register("totalUnits")} {...describe("units", errors.totalUnits?.message)} inputMode="numeric" /></FormField>
            {kind === "PRIVATE" && <FormField label="Sleeps (per room)" htmlFor="occ" error={errors.maxOccupancyPerUnit?.message}><Input {...register("maxOccupancyPerUnit")} {...describe("occ", errors.maxOccupancyPerUnit?.message)} inputMode="numeric" /></FormField>}
            <FormField label="Price (₹, before GST)" htmlFor="price" error={errors.priceRupees?.message} required><Input {...register("priceRupees")} {...describe("price", errors.priceRupees?.message)} inputMode="decimal" placeholder="850" /></FormField>
            <FormField label="Priced per" htmlFor="punit"><Controller control={control} name="priceUnit" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}><SelectTrigger id="punit"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NIGHT">Night</SelectItem><SelectItem value="MONTH">Month (PG rent)</SelectItem></SelectContent></Select>
            )} /></FormField>
            <FormField label="Minimum stay (nights)" htmlFor="minstay" error={errors.minStayNights?.message}><Input {...register("minStayNights")} {...describe("minstay", errors.minStayNights?.message)} inputMode="numeric" /></FormField>
            <FormField label="Maximum stay (nights)" htmlFor="maxstay" error={errors.maxStayNights?.message}><Input {...register("maxStayNights")} {...describe("maxstay", errors.maxStayNights?.message)} inputMode="numeric" /></FormField>
          </div>
          <FormField label="Description" htmlFor="rdesc" error={errors.description?.message}><Textarea {...register("description")} {...describe("rdesc", errors.description?.message)} rows={3} maxLength={1000} placeholder="Bed type, bathroom, what's included…" /></FormField>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button><Button type="submit" loading={isSubmitting}>{room ? "Save changes" : "Add room type"}</Button></div>
      </form>
    </ResponsiveDialog>
  );
}
