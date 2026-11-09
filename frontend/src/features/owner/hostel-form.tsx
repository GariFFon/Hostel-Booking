"use client";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/input";
import { FormField, describe } from "@/components/common/form-field";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { DEFAULTS, hostelFormSchema, type HostelFormValues } from "./hostel-schema";
import { LocationPicker } from "./location-picker";

function Choice<T extends string>({ value, onChange, options, label, cols = 2 }: { value: T; onChange: (v: T) => void; label: string; cols?: 2 | 3; options: { v: T; title: string; desc?: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-2", cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={cn("pressable rounded-xl border p-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", value === o.v ? "border-primary bg-accent/60" : "bg-card hover:bg-muted")}>
          <span className="block text-sm font-medium">{o.title}</span>{o.desc && <span className="mt-0.5 block text-xs text-muted-foreground">{o.desc}</span>}
        </button>
      ))}
    </div>
  );
}
const Section = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => <section className="grid gap-4"><div><h2 className="text-lg font-semibold">{title}</h2>{desc && <p className="text-sm text-muted-foreground">{desc}</p>}</div>{children}</section>;

/** Create and edit share this form. Backend validation messages are mapped back onto the fields they belong to. */
export function HostelForm({ initial, submitLabel, onSubmit }: { initial?: HostelFormValues; submitLabel: string; onSubmit: (v: HostelFormValues) => Promise<unknown> }) {
  const amenities = useQuery({ queryKey: ["amenities"], staleTime: 3600_000, queryFn: () => unwrapData(api.GET("/amenities")) });
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<HostelFormValues>({ resolver: zodResolver(hostelFormSchema), defaultValues: (initial ?? DEFAULTS) as HostelFormValues });
  const { register, control, handleSubmit, setValue, setError: setFieldError, reset, formState: { errors, isSubmitting, isDirty } } = form;
  React.useEffect(() => { if (initial) reset(initial); }, [initial, reset]);
  const lat = useWatch({ control, name: "latitude" }), lng = useWatch({ control, name: "longitude" });

  async function submit(v: HostelFormValues) {
    setError(null);
    try { await onSubmit(v); }
    catch (e) {
      if (isApiError(e) && Object.keys(e.fieldErrors).length) { for (const [k, m] of Object.entries(e.fieldErrors)) setFieldError(k as keyof HostelFormValues, { message: m }); setError("Please fix the highlighted fields."); }
      else setError(errorMessage(e));
    }
  }
  const onInvalid = () => setError("Some details need attention. They're highlighted below.");

  return (
    <form onSubmit={handleSubmit(submit, onInvalid)} noValidate className="grid gap-10">
      {error && <Alert tone="danger">{error}</Alert>}
      <Section title="The basics">
        <FormField label="Property name" htmlFor="name" error={errors.name?.message} required><Input {...register("name")} {...describe("name", errors.name?.message)} maxLength={100} placeholder="e.g. Palolem Beach Nomads" /></FormField>
        <FormField label="Type"><Controller control={control} name="propertyType" render={({ field }) => <Choice label="Type" value={field.value} onChange={field.onChange} options={[{ v: "HOSTEL", title: "Hostel", desc: "Dorm beds and private rooms for travellers" }, { v: "PG", title: "PG", desc: "Paying-guest accommodation, usually longer stays" }]} />} /></FormField>
        <FormField label="Description" htmlFor="description" error={errors.description?.message} hint="What makes it special? Vibe, neighbourhood, what's nearby." required><Textarea {...register("description")} {...describe("description", errors.description?.message, true)} rows={6} maxLength={4000} /></FormField>
      </Section>

      <Section title="Location" desc="Guests use the pin to find you. Search an address, then drag the pin to the exact spot.">
        <LocationPicker lat={Number.isFinite(lat) ? lat : undefined} lng={Number.isFinite(lng) ? lng : undefined} onPick={(p) => {
          setValue("latitude", p.latitude, { shouldDirty: true, shouldValidate: true }); setValue("longitude", p.longitude, { shouldDirty: true, shouldValidate: true });
          if (p.city) setValue("city", p.city, { shouldDirty: true }); if (p.state) setValue("state", p.state, { shouldDirty: true });
          if (p.postalCode && /^\d{6}$/.test(p.postalCode)) setValue("postalCode", p.postalCode, { shouldDirty: true }); if (p.locality) setValue("locality", p.locality, { shouldDirty: true });
          if (p.addressLine1 && !form.getValues("addressLine1")) setValue("addressLine1", p.addressLine1, { shouldDirty: true });
        }} />
        {(errors.latitude || errors.longitude) && <p role="alert" className="text-[13px] text-destructive">{errors.latitude?.message ?? errors.longitude?.message}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField className="sm:col-span-2" label="Street address" htmlFor="addressLine1" error={errors.addressLine1?.message} required><Input {...register("addressLine1")} {...describe("addressLine1", errors.addressLine1?.message)} autoComplete="address-line1" /></FormField>
          <FormField label="Address line 2" htmlFor="addressLine2"><Input {...register("addressLine2")} id="addressLine2" autoComplete="address-line2" /></FormField>
          <FormField label="Area / locality" htmlFor="locality"><Input {...register("locality")} id="locality" /></FormField>
          <FormField label="City" htmlFor="city" error={errors.city?.message} required><Input {...register("city")} {...describe("city", errors.city?.message)} autoComplete="address-level2" /></FormField>
          <FormField label="State" htmlFor="state" error={errors.state?.message} required><Input {...register("state")} {...describe("state", errors.state?.message)} autoComplete="address-level1" /></FormField>
          <FormField label="PIN code" htmlFor="postalCode" error={errors.postalCode?.message} required><Input {...register("postalCode")} {...describe("postalCode", errors.postalCode?.message)} inputMode="numeric" maxLength={6} autoComplete="postal-code" /></FormField>
        </div>
      </Section>

      <Section title="Booking rules">
        <FormField label="How guests book"><Controller control={control} name="bookingMode" render={({ field }) => <Choice label="How guests book" value={field.value} onChange={field.onChange} options={[{ v: "INSTANT", title: "Instant booking", desc: "Guests book and pay straight away. Most popular." }, { v: "APPROVAL", title: "Request to book", desc: "You approve each request. Guests pay only after you accept." }]} />} /></FormField>
        <FormField label="Cancellation policy"><Controller control={control} name="cancellationPolicy" render={({ field }) => <Choice cols={3} label="Cancellation policy" value={field.value} onChange={field.onChange} options={[{ v: "FLEXIBLE", title: "Flexible", desc: "Full refund until 24 hours before check-in" }, { v: "MODERATE", title: "Moderate", desc: "Full refund 5+ days out, 50% until 24 hours" }, { v: "STRICT", title: "Strict", desc: "50% refund until 7 days before check-in" }]} />} /></FormField>
        <FormField label="Who can stay"><Controller control={control} name="genderPolicy" render={({ field }) => <Choice cols={3} label="Who can stay" value={field.value} onChange={field.onChange} options={[{ v: "MIXED", title: "Everyone" }, { v: "FEMALE_ONLY", title: "Women only" }, { v: "MALE_ONLY", title: "Men only" }]} />} /></FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Check-in from" htmlFor="checkInTime" error={errors.checkInTime?.message}><Input {...register("checkInTime")} {...describe("checkInTime", errors.checkInTime?.message)} type="time" /></FormField>
          <FormField label="Check-out by" htmlFor="checkOutTime" error={errors.checkOutTime?.message}><Input {...register("checkOutTime")} {...describe("checkOutTime", errors.checkOutTime?.message)} type="time" /></FormField>
        </div>
        <FormField label="House rules" htmlFor="houseRules" error={errors.houseRules?.message} hint="Quiet hours, ID requirements, visitor policy…"><Textarea {...register("houseRules")} {...describe("houseRules", errors.houseRules?.message, true)} rows={4} maxLength={3000} /></FormField>
      </Section>

      <Section title="Amenities" desc="Guests filter by these. Only tick what you really offer.">
        <Controller control={control} name="amenityCodes" render={({ field }) => (
          <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
            {(amenities.data ?? []).map((a) => (
              <label key={a.code} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm">
                <Checkbox checked={field.value.includes(a.code)} onCheckedChange={(c) => field.onChange(c ? [...field.value, a.code] : field.value.filter((x) => x !== a.code))} />{a.label}
              </label>
            ))}
          </div>
        )} />
      </Section>

      <Section title="Contact and tax" desc="Your phone is shown to guests only after a booking is confirmed.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Property phone" htmlFor="phone" error={errors.phone?.message}><Input {...register("phone")} {...describe("phone", errors.phone?.message)} type="tel" inputMode="tel" placeholder="+919800000000" /></FormField>
          <FormField label="Contact email" htmlFor="contactEmail" error={errors.contactEmail?.message}><Input {...register("contactEmail")} {...describe("contactEmail", errors.contactEmail?.message)} type="email" inputMode="email" /></FormField>
          <FormField label="GSTIN" htmlFor="gstin" error={errors.gstin?.message} hint="Optional. Appears on invoices."><Input {...register("gstin")} {...describe("gstin", errors.gstin?.message, true)} maxLength={15} className="font-mono uppercase" autoCapitalize="characters" /></FormField>
        </div>
      </Section>

      <div className="safe-bottom sticky bottom-0 z-20 -mx-4 flex items-center justify-between gap-3 border-t bg-background/90 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <p className="hidden text-sm text-muted-foreground sm:block">{isDirty ? "You have unsaved changes." : "Everything is saved."}</p>
        <Button type="submit" size="lg" loading={isSubmitting} disabled={!isDirty && !!initial} className="ml-auto"><Zap className="hidden" />{submitLabel}</Button>
      </div>
    </form>
  );
}
