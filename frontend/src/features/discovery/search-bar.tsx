"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toSearchString, type SearchFilters } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { PlaceInput } from "./place-input";
import { DateRangeField, GuestsField } from "./stay-fields";

/** Where · When · Who. On the home page it navigates to /search; on /search it edits the live filters (pass onSubmit). */
export function SearchBar({ initial, onSubmit, className, compact }: { initial?: Partial<SearchFilters>; onSubmit?: (f: SearchFilters) => void; className?: string; compact?: boolean }) {
  const router = useRouter();
  const [f, setF] = React.useState<SearchFilters>({ guests: 1, amenities: [], view: "list", ...initial });

  function nearMe() {
    if (!navigator.geolocation) { toast.error("Your browser can't share a location."); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setF((c) => ({ ...c, city: undefined, q: undefined, lat: Number(p.coords.latitude.toFixed(4)), lng: Number(p.coords.longitude.toFixed(4)), radiusKm: 25, sort: "distance" })),
      () => toast.error("We couldn't get your location. Allow access, or type a city."),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (onSubmit) onSubmit(f); else router.push(`/search${toSearchString(f)}`);
  }
  return (
    <form onSubmit={submit} role="search" aria-label="Search stays" className={cn("rounded-2xl border bg-card p-1.5 shadow-lg md:flex md:items-stretch md:rounded-full md:p-1.5", className)}>
      <PlaceInput className="md:min-w-0 md:flex-[1.3]" value={{ city: f.city, q: f.q, near: f.lat !== undefined }} onNearMe={nearMe}
        onChange={(p) => setF((c) => ({ ...c, city: p.city, q: p.q, ...(p.city || p.q ? { lat: undefined, lng: undefined } : {}) }))} />
      <div className="mx-3 my-0.5 h-px bg-border md:mx-0 md:my-2 md:h-auto md:w-px" aria-hidden />
      <DateRangeField className="md:flex-1" checkIn={f.checkIn} checkOut={f.checkOut} onChange={(r) => setF((c) => ({ ...c, ...r }))} />
      <div className="mx-3 my-0.5 h-px bg-border md:mx-0 md:my-2 md:h-auto md:w-px" aria-hidden />
      <GuestsField className="md:flex-[0.8]" guests={f.guests} onChange={(guests) => setF((c) => ({ ...c, guests }))} />
      <Button type="submit" size="lg" className={cn("mt-1.5 w-full md:mt-0 md:ml-1 md:w-auto md:rounded-full", compact ? "md:px-4" : "md:px-6")}><Search /> <span className={cn(compact && "md:sr-only")}>Search</span></Button>
    </form>
  );
}
