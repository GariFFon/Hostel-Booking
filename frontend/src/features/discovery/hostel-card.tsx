"use client";
import * as React from "react";
import Link from "next/link";
import { MapPin, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RatingBadge } from "@/components/common/rating";
import { WishlistButton } from "@/features/wishlist/wishlist-button";
import { money } from "@/lib/format";
import type { SearchItem } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const GENDER: Record<string, string> = { MALE_ONLY: "Men only", FEMALE_ONLY: "Women only" };

/** Photos scroll natively with snap (the browser's physics beat a hand-rolled carousel); dots show position. */
/** `priority`: the likely LCP image (first card on the page) is fetched at high priority; every other card's first photo is lazy. */
function Photos({ urls, name, priority = false }: { urls: string[]; name: string; priority?: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [i, setI] = React.useState(0);
  const list = urls.length ? urls.slice(0, 6) : [];
  if (list.length === 0) return <div className="flex size-full items-center justify-center bg-muted text-muted-foreground"><MapPin className="size-8 opacity-40" aria-hidden /></div>;
  return (
    <>
      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground" aria-hidden><MapPin className="size-8 opacity-30" /></div>
      <div ref={ref} role="group" aria-label={`Photos of ${name}`} tabIndex={0} onScroll={(e) => { const el = e.currentTarget; setI(Math.round(el.scrollLeft / el.clientWidth)); }}
        className="relative flex size-full snap-x snap-mandatory overflow-x-auto focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {list.map((u, k) => (
           
          <img key={u} src={u} alt={k === 0 ? name : ""} loading={priority && k === 0 ? "eager" : "lazy"} fetchPriority={priority && k === 0 ? "high" : "auto"} decoding="async" draggable={false}
            className="size-full shrink-0 snap-center object-cover text-[0px] text-transparent" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
        ))}
      </div>
      {list.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1" aria-hidden>
          {list.map((_, k) => <span key={k} className={cn("size-1.5 rounded-full bg-white/60 shadow-sm transition-all duration-200", k === i && "w-3 bg-white")} />)}
        </div>
      )}
    </>
  );
}

export function HostelCard({ h, href, className, onHover, priority = false }: { h: SearchItem; href?: string; className?: string; onHover?: (id: string | null) => void; priority?: boolean }) {
  const dated = h.stayFromPricePaise !== null && h.stayFromPricePaise !== undefined;
  const link = href ?? `/hostels/${h.slug}`;
  return (
    <article className={cn("group relative", className)} onMouseEnter={() => onHover?.(h.id)} onMouseLeave={() => onHover?.(null)}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-muted">
        <Photos urls={h.photoUrls.length ? h.photoUrls : h.coverUrl ? [h.coverUrl] : []} name={h.name} priority={priority} />
        <div className="absolute top-2.5 right-2.5"><WishlistButton hostelId={h.id} /></div>
        <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap gap-1.5">
          {h.bookingMode === "INSTANT" && <Badge className="bg-background/90 text-foreground shadow-sm backdrop-blur-md"><Zap className="fill-current" />Instant</Badge>}
          {GENDER[h.genderPolicy] && <Badge className="bg-background/90 text-foreground shadow-sm backdrop-blur-md">{GENDER[h.genderPolicy]}</Badge>}
        </div>
      </div>
      <Link href={link} className="mt-3 block rounded-md outline-none after:absolute after:inset-0 after:z-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring [&>*]:relative">
        <div className="flex items-start justify-between gap-3">
          <h3 title={h.name} className="line-clamp-1 min-w-0 text-[15px] font-semibold [overflow-wrap:anywhere]">{h.name}</h3>
          <RatingBadge rating={h.avgRating} count={h.reviewCount} className="shrink-0" />
        </div>
        <p title={[h.locality, h.city].filter(Boolean).join(", ")} className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{[h.locality, h.city].filter(Boolean).join(", ")}{h.distanceKm !== null && h.distanceKm !== undefined ? ` · ${h.distanceKm.toFixed(h.distanceKm < 10 ? 1 : 0)} km away` : ""}</p>
        <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{h.propertyType === "PG" ? "PG" : "Hostel"}{h.roomKinds.length ? ` · ${h.roomKinds.map((k) => (k === "DORM" ? "Dorm beds" : "Private rooms")).join(" & ")}` : ""}</p>
        <p className="tnum mt-1.5 text-[15px]">
          {h.fromPricePaise === null ? <span className="text-muted-foreground">Price on request</span> : dated
            ? <><span className="font-semibold">{money(h.stayFromPricePaise)}</span><span className="text-muted-foreground"> total from</span></>
            : <><span className="text-muted-foreground">From </span><span className="font-semibold">{money(h.fromPricePaise)}</span><span className="text-muted-foreground"> / night</span></>}
        </p>
      </Link>
    </article>
  );
}

export function HostelCardSkeleton() {
  return (
    <div aria-hidden>
      <div className="aspect-[4/3] rounded-2xl bg-muted motion-safe:animate-pulse" />
      <div className="mt-3 h-4 w-3/4 rounded bg-muted motion-safe:animate-pulse" />
      <div className="mt-2 h-3.5 w-1/2 rounded bg-muted motion-safe:animate-pulse" />
      <div className="mt-2 h-4 w-1/3 rounded bg-muted motion-safe:animate-pulse" />
    </div>
  );
}
