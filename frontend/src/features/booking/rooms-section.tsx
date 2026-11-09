"use client";
import * as React from "react";
import { BedDouble, DoorOpen, Minus, Plus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBooking } from "./booking-context";

const REASON: Record<string, string> = { MIN_STAY: "Doesn't meet the minimum stay", MAX_STAY: "Over the maximum stay", SOLD_OUT: "Sold out for these dates" };

/** The rooms table doubles as the picker: each row shows live availability and price for the chosen dates. */
export function RoomsSection() {
  const { hostel, dates, nights, avail, availability, sel, setUnits } = useBooking();
  const rooms = hostel.roomTypes;
  if (rooms.length === 0) return <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">This property has no rooms open for booking right now.</p>;
  return (
    <div className="grid gap-3" id="rooms">
      {!dates && <p className="rounded-xl bg-accent px-4 py-3 text-sm text-accent-foreground">Add your dates to see what&apos;s available and the final price.</p>}
      {rooms.map((r) => {
        const a = avail.get(r.id);
        const units = sel[r.id] ?? 0;
        const loading = !!dates && availability.isPending;
        const unavailable = !!dates && !!a && !a.eligible;
        const max = a?.availableUnits ?? r.capacity;
        const perNight = a?.avgNightlyPaise ?? r.fromPricePaise;
        const photo = r.media[0]?.cardUrl;
        return (
          <article key={r.id} className={cn("flex gap-4 rounded-2xl border bg-card p-3 transition-[border-color,box-shadow] duration-200 sm:p-4", units > 0 && "border-primary shadow-[0_0_0_1px_var(--primary)]", unavailable && "opacity-60")}>
            <div className="hidden size-28 shrink-0 overflow-hidden rounded-xl bg-muted sm:block">
              {photo ?   <img src={photo} alt="" loading="lazy" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-muted-foreground">{r.kind === "DORM" ? <BedDouble className="size-7 opacity-40" /> : <DoorOpen className="size-7 opacity-40" />}</div>}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="font-semibold [overflow-wrap:anywhere]">{r.name}</h3>
                <Badge tone="outline">{r.kind === "DORM" ? "Dorm bed" : "Private room"}</Badge>
                {r.gender !== "MIXED" && <Badge tone="primary">{r.gender === "FEMALE" ? "Women only" : "Men only"}</Badge>}
              </div>
              {r.description && <p className="line-clamp-2 text-sm text-muted-foreground">{r.description}</p>}
              <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{r.kind === "DORM" ? "1 per bed" : `Sleeps ${r.maxOccupancyPerUnit}`}</span>
                {r.minStayNights > 1 && <span>Min {plural(r.minStayNights, "night")}</span>}
                {r.priceUnit === "MONTH" && <span>Billed per night (monthly rent ÷ 30)</span>}
              </p>
              <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-1">
                <div className="tnum">
                  {loading ? <Skeleton className="h-5 w-24" /> : unavailable ? <span className="text-sm text-muted-foreground">{REASON[a!.reason ?? "SOLD_OUT"]}</span> : (
                    <>
                      <span className="text-lg font-semibold">{money(perNight)}</span><span className="text-sm text-muted-foreground"> / night{dates && a?.avgNightlyPaise ? " avg" : ""}</span>
                      {dates && a?.stayPerUnitPaise != null && nights > 0 && <span className="block text-xs text-muted-foreground">{money(a.stayPerUnitPaise)} for {plural(nights, "night")}, before GST</span>}
                    </>
                  )}
                </div>
                {!unavailable && (
                  <div className="flex items-center gap-2.5">
                    {dates && a && a.availableUnits <= 5 && a.availableUnits > 0 && <span className="text-xs font-medium text-warning">Only {a.availableUnits} left</span>}
                    <div className="flex items-center gap-2" role="group" aria-label={`${r.name} quantity`}>
                      <Button variant="outline" size="icon" className="rounded-full" onClick={() => setUnits(r.id, units - 1)} disabled={units <= 0} aria-label={`Remove one ${r.kind === "DORM" ? "bed" : "room"}`}><Minus /></Button>
                      <span className="tnum w-6 text-center font-medium" aria-live="polite">{units}</span>
                      <Button variant={units === 0 ? "default" : "outline"} size="icon" className="rounded-full" onClick={() => setUnits(r.id, units + 1)} disabled={loading || units >= max} aria-label={`Add one ${r.kind === "DORM" ? "bed" : "room"}`}><Plus /></Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
