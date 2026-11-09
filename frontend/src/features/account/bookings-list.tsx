"use client";
import * as React from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CalendarX2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { useNow } from "@/hooks/use-now";
import { api, unwrap } from "@/lib/api/client";
import { countdown, fmtRange, money, plural } from "@/lib/format";
import type { BookingSummary } from "@/lib/api/types";

export function BookingCard({ b, now }: { b: BookingSummary; now: number | null }) {
  const left = b.holdExpiresAt && now ? countdown(b.holdExpiresAt, now) : null;
  const awaiting = b.status === "PENDING_PAYMENT" && left;
  return (
    <Link href={`/account/bookings/${b.id}${awaiting ? "?pay=1" : ""}`} className="pressable group flex gap-4 rounded-2xl border bg-card p-3 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring sm:p-4">
      <div className="size-24 shrink-0 overflow-hidden rounded-xl bg-muted sm:size-28">{b.hostel.coverUrl &&   <img src={b.hostel.coverUrl} alt="" loading="lazy" className="size-full object-cover" />}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 title={b.hostel.name} className="line-clamp-2 font-semibold [overflow-wrap:anywhere]">{b.hostel.name}</h3>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"><span className="min-w-0 truncate">{b.hostel.city}</span><StatusBadge status={b.status} /></p>
        <p className="tnum text-sm">{fmtRange(b.checkIn, b.checkOut)} · {plural(b.nights, "night")} · {plural(b.guestsCount, "guest")}</p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="font-mono text-xs text-muted-foreground">{b.code}</span>
          {awaiting ? <span className="tnum inline-flex items-center gap-1 text-xs font-medium text-warning"><Clock className="size-3.5" />Pay within {left}</span> : <span className="tnum text-sm font-semibold">{money(b.totalPaise, { exact: true })}</span>}
        </div>
      </div>
    </Link>
  );
}

const TABS = [["upcoming", "Upcoming"], ["past", "Past"], ["all", "All"]] as const;

export function BookingsList() {
  const [when, setWhen] = React.useState<"upcoming" | "past" | "all">("upcoming");
  const now = useNow();
  const q = useInfiniteQuery({
    queryKey: ["bookings", "mine", when], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/bookings", { params: { query: { when, limit: 12, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="grid gap-6">
      <PageHeader title="Your trips" description="Everything you've booked, in one place." actions={<Button asChild variant="outline"><Link href="/search">Find a stay</Link></Button>} />
      <Tabs value={when} onValueChange={(v) => setWhen(v as typeof when)}><TabsList>{TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}</TabsList></Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={CalendarX2} title={when === "upcoming" ? "No upcoming trips" : when === "past" ? "No past trips yet" : "No bookings yet"} description="When you book a stay it will show up here, with its status and everything you need on the day." action={<Button asChild><Link href="/search">Explore stays</Link></Button>} />
        : <div className="grid gap-3">{items.map((b) => <BookingCard key={b.id} b={b} now={now} />)}</div>}
      <LoadMore query={q} />
    </div>
  );
}
