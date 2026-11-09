"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import { LocateFixed, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";

const Map = dynamic(() => import("./location-map-inner"), { ssr: false, loading: () => <Skeleton className="size-full rounded-none" /> });
export interface Picked { latitude: number; longitude: number; city?: string | null; state?: string | null; postalCode?: string | null; locality?: string | null; addressLine1?: string }

/** Search an address (OpenStreetMap), then fine-tune the pin. Reverse-geocodes after each drag to fill city, state and PIN. */
export function LocationPicker({ lat, lng, onPick }: { lat?: number; lng?: number; onPick: (p: Picked) => void }) {
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<Awaited<ReturnType<typeof search>>>([]);
  async function search(text: string) { return unwrapData(api.GET("/geo/search", { params: { query: { q: text, limit: 5 } } })); }

  async function find(e?: React.FormEvent) {
    e?.preventDefault();
    if (q.trim().length < 3) return;
    setBusy(true);
    try { const r = await search(q.trim()); setResults(r); if (r.length === 0) toast("No match. Try the area or city, or drop the pin on the map."); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  }
  async function picked(latitude: number, longitude: number) {
    onPick({ latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) });
    try {
      const place = await unwrapData(api.GET("/geo/reverse", { params: { query: { lat: latitude, lng: longitude } } }));
      if (place) onPick({ latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)), city: place.city, state: place.state, postalCode: place.postalCode, locality: place.locality });
    } catch { /* the pin is still set; address fields can be typed */ }
  }
  function here() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => picked(p.coords.latitude, p.coords.longitude), () => toast.error("We couldn't get your location."), { timeout: 8000 });
  }
  return (
    <div className="grid gap-3">
      <form onSubmit={find} className="flex gap-2" role="search" aria-label="Find the address">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the address, e.g. Palolem Beach Road, Goa" aria-label="Search address" enterKeyHint="search" />
        <Button type="submit" variant="outline" loading={busy}><Search /><span className="sr-only sm:not-sr-only">Find</span></Button>
        <Button type="button" variant="outline" size="icon" onClick={here} aria-label="Use my location"><LocateFixed /></Button>
      </form>
      {results.length > 0 && (
        <ul className="grid gap-1 rounded-xl border bg-card p-1.5">{results.map((r) => (
          <li key={`${r.latitude},${r.longitude}`}><button type="button" onClick={() => { onPick({ latitude: r.latitude, longitude: r.longitude, city: r.city, state: r.state, postalCode: r.postalCode, locality: r.locality, addressLine1: r.label.split(",")[0] }); setResults([]); }} className="pressable flex min-h-11 w-full items-center rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><span className="line-clamp-2">{r.label}</span></button></li>
        ))}</ul>
      )}
      <div className="h-72 overflow-hidden rounded-2xl border"><Map lat={lat} lng={lng} onPick={picked} /></div>
      <p className="text-xs text-muted-foreground">{typeof lat === "number" && typeof lng === "number" ? `Pinned at ${lat.toFixed(5)}, ${lng.toFixed(5)}. Drag the pin to adjust.` : "Click the map to drop a pin."}</p>
    </div>
  );
}
