"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { List, Map as MapIcon, SearchX, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { api, unwrap } from "@/lib/api/client";
import { fmtRange, plural } from "@/lib/format";
import { SORT_OPTIONS, activeFilterCount, parseFilters, toApiQuery, toSearchString, type SearchFilters, type SortValue } from "@/lib/search-params";
import type { SearchItem } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { FiltersDialog } from "./filters-dialog";
import { HostelCard, HostelCardSkeleton } from "./hostel-card";
import { HostelMap, type MapMarker } from "./hostel-map";
import { SearchBar } from "./search-bar";

const toMarker = (h: SearchItem): MapMarker => ({ id: h.id, slug: h.slug, name: h.name, lat: h.location.latitude, lng: h.location.longitude, pricePaise: h.stayFromPricePaise ?? h.fromPricePaise, rating: h.avgRating, reviews: h.reviewCount, cover: h.coverUrl, city: h.city });

export function SearchView() {
  const router = useRouter();
  const sp = useSearchParams();
  const spKey = sp.toString();
  const filters = React.useMemo(() => parseFilters(new URLSearchParams(spKey)), [spKey]);
  const [showFilters, setShowFilters] = React.useState(false);
  const [hover, setHover] = React.useState<string | null>(null);
  const [moved, setMoved] = React.useState<string | null>(null);
  const apiQuery = React.useMemo(() => toApiQuery(filters), [filters]);
  const qKey = JSON.stringify(apiQuery);

  const update = React.useCallback((patch: Partial<SearchFilters>) => {
    router.replace(`/search${toSearchString({ ...filters, bbox: undefined, ...patch })}`, { scroll: false });
    setMoved(null);
  }, [filters, router]);

  const results = useInfiniteQuery({
    queryKey: ["search", qKey],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/hostels", { params: { query: { ...apiQuery, limit: 18, ...(pageParam ? { cursor: pageParam } : {}) } as never } })),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const items = React.useMemo(() => results.data?.pages.flatMap((p) => p.data) ?? [], [results.data]);
  const total = results.data?.pages[0]?.meta.total;

  // Map markers: everything loaded so far, plus whatever is in the viewport once the user pans (up to 150 per area).
  const mapQ = useQuery({
    queryKey: ["search-map", qKey, moved], enabled: !!moved, staleTime: 60_000,
    queryFn: async () => (await unwrap(api.GET("/hostels/map", { params: { query: { ...apiQuery, bbox: moved! } as never } }))).data,
  });
  const markers = React.useMemo(() => {
    const m = new Map<string, MapMarker>();
    for (const h of items) m.set(h.id, toMarker(h));
    for (const h of mapQ.data ?? []) m.set(h.id, { id: h.id, slug: h.slug, name: h.name, lat: h.latitude, lng: h.longitude, pricePaise: h.fromPricePaise, rating: h.avgRating, reviews: h.reviewCount });
    return [...m.values()];
  }, [items, mapQ.data]);

  const { fetchNextPage, error: searchError } = results;
  const nextPageFailed = results.isFetchNextPageError;
  const sentinel = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el || !results.hasNextPage) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && !results.isFetchingNextPage) results.fetchNextPage(); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [results.hasNextPage, results.isFetchingNextPage, results.fetchNextPage, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const where = filters.lat !== undefined ? "near you" : filters.city ? `in ${filters.city}` : filters.q ? `for “${filters.q}”` : "across India";
  const nFilters = activeFilterCount(filters);
  const mapOnly = filters.view === "map";
  const fitKey = `${qKey}|${items.length > 0}`;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 sm:px-6">
      <div className="sticky top-16 z-30 -mx-4 border-b bg-background/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="hidden md:block"><SearchBar key={spKey} compact initial={{ city: filters.city, q: filters.q, checkIn: filters.checkIn, checkOut: filters.checkOut, guests: filters.guests, lat: filters.lat, lng: filters.lng }} onSubmit={(f) => update({ city: f.city, q: f.q, checkIn: f.checkIn, checkOut: f.checkOut, guests: f.guests, lat: f.lat, lng: f.lng, radiusKm: f.radiusKm, sort: f.sort ?? filters.sort })} /></div>
        <div className="md:hidden">
          <details className="group rounded-2xl border bg-card shadow-sm">
            <summary className="pressable flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1 truncate font-medium">{filters.city ?? filters.q ?? (filters.lat !== undefined ? "Near me" : "Anywhere")}<span className="font-normal text-muted-foreground"> · {filters.checkIn && filters.checkOut ? fmtRange(filters.checkIn, filters.checkOut) : "Any dates"} · {plural(filters.guests, "guest")}</span></span>
              <span className="text-primary group-open:hidden">Edit</span>
            </summary>
            <div className="border-t p-2"><SearchBar key={spKey} className="border-0 p-0 shadow-none" initial={{ city: filters.city, q: filters.q, checkIn: filters.checkIn, checkOut: filters.checkOut, guests: filters.guests }} onSubmit={(f) => { update({ city: f.city, q: f.q, checkIn: f.checkIn, checkOut: f.checkOut, guests: f.guests, lat: f.lat, lng: f.lng, radiusKm: f.radiusKm }); (document.activeElement as HTMLElement | null)?.closest("details")?.removeAttribute("open"); }} /></div>
          </details>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(true)} className="rounded-full"><SlidersHorizontal /> Filters{nFilters > 0 && <Badge tone="primary" className="ml-0.5 px-1.5">{nFilters}</Badge>}</Button>
          <Select value={filters.sort ?? "recommended"} onValueChange={(v) => update({ sort: v as SortValue })}>
            <SelectTrigger className="h-10 w-auto min-w-40 rounded-full text-sm md:h-8" aria-label="Sort results"><SelectValue /></SelectTrigger>
            <SelectContent>{SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value} disabled={o.value === "distance" && filters.lat === undefined}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="ml-auto rounded-full lg:hidden" onClick={() => update({ view: mapOnly ? "list" : "map" })}>{mapOnly ? <><List /> List</> : <><MapIcon /> Map</>}</Button>
        </div>
      </div>

      <FiltersDialog open={showFilters} onOpenChange={setShowFilters} filters={filters} onApply={update} />

      <div className={cn("grid gap-6 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]")}>
        <section className={cn("min-h-[70vh]", mapOnly && "hidden lg:block")} aria-live="polite" aria-busy={results.isFetching}>
          <p className="mb-4 text-sm text-muted-foreground">
            {results.isPending ? "Searching…" : <><span className="font-semibold text-foreground">{total !== undefined ? plural(total, "stay") : plural(items.length, "stay")}</span> {where}{filters.bbox ? " in this map area" : ""}</>}
            {filters.bbox && <button className="ml-2 text-primary underline-offset-4 hover:underline" onClick={() => update({ bbox: undefined })}>Clear map area</button>}
          </p>
          {results.isError ? <ErrorState error={results.error} onRetry={() => results.refetch()} />
            : results.isPending ? <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2">{Array.from({ length: 6 }, (_, i) => <HostelCardSkeleton key={i} />)}</div>
            : items.length === 0 ? (
              <EmptyState icon={SearchX} title="No stays match these filters" description={nFilters || filters.checkIn ? "Try removing a filter or changing your dates." : "Try a different place, or search the whole country."}
                action={<div className="flex gap-2"><Button variant="outline" onClick={() => update({ minPrice: undefined, maxPrice: undefined, amenities: [], propertyType: undefined, roomKind: undefined, gender: undefined, minRating: undefined, instantBook: undefined, bbox: undefined })}>Clear filters</Button><Button onClick={() => update({ city: undefined, q: undefined, lat: undefined, lng: undefined })}>Search everywhere</Button></div>} />
            ) : (
              <>
                <div className="grid gap-x-5 gap-y-9 sm:grid-cols-2">{items.map((h, i) => <HostelCard key={h.id} h={h} onHover={setHover} priority={i === 0} />)}</div>
                <div ref={sentinel} className="h-px" aria-hidden />
                {results.isFetchingNextPage && <div className="mt-8 grid gap-x-5 sm:grid-cols-2"><HostelCardSkeleton /><HostelCardSkeleton /></div>}
                {results.hasNextPage && !results.isFetchingNextPage && <div className="mt-8 text-center"><Button variant="outline" onClick={() => results.fetchNextPage()}>Show more stays</Button></div>}
                {nextPageFailed && <ErrorState compact className="mt-6" error={searchError} onRetry={() => fetchNextPage()} />}
              </>
            )}
        </section>

        <aside className={cn("relative h-[calc(100dvh-14rem)] overflow-hidden rounded-2xl border lg:sticky lg:top-44 lg:block lg:h-[calc(100dvh-12.5rem)]", mapOnly ? "block" : "hidden")} aria-label="Map">
          <HostelMap markers={markers} highlightId={hover} fitKey={fitKey} onMoved={(b) => setMoved(b)} />
          {moved && !filters.bbox && (
            <div className="absolute top-3 left-1/2 z-[1000] -translate-x-1/2">
              <Button size="sm" className="rounded-full shadow-lg" onClick={() => update({ bbox: moved })}>Search this area</Button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
