"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { api, unwrapData } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { SearchFilters } from "@/lib/search-params";

function Chips<T extends string | number | undefined>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={String(o.v ?? "any")} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={cn("pressable min-h-11 rounded-full border px-4 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring md:min-h-9", value === o.v ? "border-primary bg-accent text-accent-foreground" : "bg-card hover:bg-muted")}>{o.label}</button>
      ))}
    </div>
  );
}

const rupees = (paise?: number) => (paise === undefined ? "" : String(Math.round(paise / 100)));
const toPaise = (v: string) => { const n = Number(v.replace(/[^\d]/g, "")); return v.trim() === "" || !Number.isFinite(n) ? undefined : n * 100; };

export function FiltersDialog({ open, onOpenChange, filters, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; filters: SearchFilters; onApply: (patch: Partial<SearchFilters>) => void }) {
  return <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Filters" className="sm:max-w-xl"><Body onOpenChange={onOpenChange} filters={filters} onApply={onApply} /></ResponsiveDialog>;
}

/** The draft lives here and only exists while the dialog is open, so it always starts from the current filters. */
function Body({ onOpenChange, filters, onApply }: { onOpenChange: (o: boolean) => void; filters: SearchFilters; onApply: (patch: Partial<SearchFilters>) => void }) {
  const [d, setD] = React.useState(filters);
  const { data: amenities } = useQuery({ queryKey: ["amenities"], staleTime: 3600_000, queryFn: async () => unwrapData(api.GET("/amenities")) });
  const priceBad = d.minPrice !== undefined && d.maxPrice !== undefined && d.minPrice > d.maxPrice;
  const set = <K extends keyof SearchFilters>(k: K, v: SearchFilters[K]) => setD((c) => ({ ...c, [k]: v }));
  const toggleAmenity = (code: string) => set("amenities", d.amenities.includes(code) ? d.amenities.filter((a) => a !== code) : [...d.amenities, code]);
  const clear = () => setD((c) => ({ ...c, minPrice: undefined, maxPrice: undefined, amenities: [], propertyType: undefined, roomKind: undefined, gender: undefined, minRating: undefined, instantBook: undefined }));

  return (
    <>
      <div className="grid gap-6 md:max-h-[60dvh] md:overflow-y-auto md:pr-1">
        <section className="grid gap-2.5">
          <h3 className="text-sm font-semibold">Price per night</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="min-price" className="text-xs text-muted-foreground">Minimum (₹)</Label><Input id="min-price" inputMode="numeric" placeholder="0" value={rupees(d.minPrice)} onChange={(e) => set("minPrice", toPaise(e.target.value))} aria-invalid={priceBad || undefined} /></div>
            <div className="grid gap-1.5"><Label htmlFor="max-price" className="text-xs text-muted-foreground">Maximum (₹)</Label><Input id="max-price" inputMode="numeric" placeholder="Any" value={rupees(d.maxPrice)} onChange={(e) => set("maxPrice", toPaise(e.target.value))} aria-invalid={priceBad || undefined} /></div>
          </div>
          {priceBad && <p role="alert" className="text-[13px] text-destructive">Minimum can&apos;t be more than maximum.</p>}
        </section>
        <section className="grid gap-2.5"><h3 className="text-sm font-semibold">Type of place</h3>
          <Chips label="Type of place" value={d.propertyType} onChange={(v) => set("propertyType", v)} options={[{ v: undefined, label: "Any" }, { v: "HOSTEL", label: "Hostel" }, { v: "PG", label: "PG" }]} /></section>
        <section className="grid gap-2.5"><h3 className="text-sm font-semibold">Bed or room</h3>
          <Chips label="Bed or room" value={d.roomKind} onChange={(v) => set("roomKind", v)} options={[{ v: undefined, label: "Any" }, { v: "DORM", label: "Dorm bed" }, { v: "PRIVATE", label: "Private room" }]} /></section>
        <section className="grid gap-2.5"><h3 className="text-sm font-semibold">Who is staying</h3>
          <Chips label="Who is staying" value={d.gender} onChange={(v) => set("gender", v)} options={[{ v: undefined, label: "Anyone" }, { v: "FEMALE", label: "Women" }, { v: "MALE", label: "Men" }]} /></section>
        <section className="grid gap-2.5"><h3 className="text-sm font-semibold">Guest rating</h3>
          <Chips label="Guest rating" value={d.minRating} onChange={(v) => set("minRating", v)} options={[{ v: undefined, label: "Any" }, { v: 3, label: "3+" }, { v: 4, label: "4+" }, { v: 4.5, label: "4.5+" }]} /></section>
        <section className="flex items-center justify-between gap-4 rounded-xl border p-3.5">
          <div><Label htmlFor="instant" className="text-sm font-semibold"><Zap className="size-4 text-primary" /> Instant booking</Label><p className="mt-1 text-sm text-muted-foreground">Skip the wait: no host approval needed.</p></div>
          <Switch id="instant" checked={!!d.instantBook} onCheckedChange={(v) => set("instantBook", v || undefined)} />
        </section>
        <section className="grid gap-2.5"><h3 className="text-sm font-semibold">Amenities</h3>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {(amenities ?? []).map((a) => (
              <label key={a.code} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm">
                <Checkbox checked={d.amenities.includes(a.code)} onCheckedChange={() => toggleAmenity(a.code)} /> {a.label}
              </label>
            ))}
          </div>
        </section>
      </div>
      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <Button variant="ghost" onClick={clear}>Clear all</Button>
        <Button disabled={priceBad} onClick={() => { onApply({ minPrice: d.minPrice, maxPrice: d.maxPrice, amenities: d.amenities, propertyType: d.propertyType, roomKind: d.roomKind, gender: d.gender, minRating: d.minRating, instantBook: d.instantBook }); onOpenChange(false); }}>Show results</Button>
      </div>
    </>
  );
}
