"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Tag, TriangleAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangeField, GuestsField } from "@/features/discovery/stay-fields";
import { api, unwrapData } from "@/lib/api/client";
import { money, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBooking } from "./booking-context";
import { PriceBreakdown } from "./price-breakdown";

function Offers() {
  const b = useBooking();
  const { data } = useQuery({ queryKey: ["offers", b.hostel.slug], staleTime: 60_000, queryFn: () => unwrapData(api.GET("/hostels/{idOrSlug}/offers", { params: { path: { idOrSlug: b.hostel.slug } } })) });
  if (!data?.length) return null;
  return (
    <ul className="grid gap-1.5">
      {data.slice(0, 3).map((o) => (
        <li key={o.code}>
          <button type="button" onClick={() => b.applyCode(o.code)}
            className="pressable flex w-full items-start gap-2 rounded-lg border border-dashed bg-accent/50 px-3 py-2 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
            <Tag className="mt-0.5 size-3.5 shrink-0 text-primary" /><span><b className="font-mono tracking-wide">{o.code}</b><span className="block text-muted-foreground">{o.headline}</span></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The sticky booking panel (desktop) and the content of the bottom sheet (phones). */
export function BookingCard({ className }: { className?: string }) {
  const b = useBooking();
  const { hostel, dates, quote } = b;
  const q = quote.data;
  const approval = hostel.bookingMode === "APPROVAL";
  const couponMsg = q?.coupon && !q.coupon.valid ? q.coupon.message : null;
  return (
    <div className={cn("grid gap-4 rounded-2xl border bg-card p-5 shadow-lg", className)}>
      <div className="flex items-baseline justify-between gap-3">
        {q && dates ? <p className="tnum"><span className="text-2xl font-semibold">{money(q.totalPaise, { exact: true })}</span><span className="text-sm text-muted-foreground"> total · {plural(q.nights, "night")}</span></p>
          : <p className="tnum">{hostel.fromPricePaise !== null ? <><span className="text-sm text-muted-foreground">From </span><span className="text-2xl font-semibold">{money(hostel.fromPricePaise)}</span><span className="text-sm text-muted-foreground"> / night</span></> : <span className="text-muted-foreground">Price on request</span>}</p>}
      </div>

      <div className="rounded-xl border">
        <DateRangeField checkIn={dates?.checkIn} checkOut={dates?.checkOut} onChange={b.setDates} className="rounded-b-none" />
        <div className="h-px bg-border" />
        <GuestsField guests={b.guests} onChange={b.setGuests} className="rounded-t-none" />
      </div>

      {b.items.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {b.items.map((i) => <li key={i.roomTypeId} className="flex justify-between gap-3"><span className="min-w-0 truncate">{b.rooms.get(i.roomTypeId)?.name}</span><span className="tnum shrink-0 text-muted-foreground">× {i.units}</span></li>)}
        </ul>
      )}

      {b.issue && <Alert tone={quote.isError ? "warning" : "info"}>{b.issue}</Alert>}

      {q && b.items.length > 0 && !quote.isError && (
        <div className={cn("transition-opacity duration-150", quote.isFetching && "opacity-60")} aria-live="polite">
          <PriceBreakdown quote={q} />
        </div>
      )}
      {quote.isFetching && !q && b.items.length > 0 && !quote.isError && <div className="grid gap-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-6 w-full" /></div>}

      {(q || b.items.length > 0) && (
        <details className="group" open={!!b.coupon}>
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden"><Tag className="size-4" />Have a coupon?</summary>
          <div className="mt-2 grid gap-2">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); b.applyCoupon(); }}>
              <Input value={b.couponInput} onChange={(e) => b.setCouponInput(e.target.value.toUpperCase())} placeholder="Enter code" aria-label="Coupon code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={40} className="font-mono uppercase" />
              <Button type="submit" variant="outline" disabled={!b.couponInput.trim()}>Apply</Button>
            </form>
            {q?.coupon?.valid && <p className="flex items-center gap-1.5 text-sm text-success"><CheckCircle2 className="size-4" />{q.coupon.code} applied: you save {money(q.coupon.discountPaise)}</p>}
            {couponMsg && <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{couponMsg}</p>}
            <Offers />
          </div>
        </details>
      )}

      {b.canReserve ? (
        <Button asChild size="lg" className="w-full"><Link href={b.reserveHref}>{approval ? "Request to book" : "Reserve"} <ArrowRight /></Link></Button>
      ) : (
        <Button size="lg" className="w-full" disabled>{approval ? "Request to book" : "Reserve"}</Button>
      )}
      <p className="text-center text-xs text-muted-foreground">
        {approval ? "The host replies within 24 hours. You pay only if they accept." : "You won't be charged yet. Pay on the next step."}
      </p>
      {q && <p className="text-center text-xs text-muted-foreground">{q.cancellation.summary}</p>}
    </div>
  );
}
