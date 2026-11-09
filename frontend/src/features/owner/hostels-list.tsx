"use client";
import * as React from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { RatingBadge } from "@/components/common/rating";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrap } from "@/lib/api/client";
import { money, plural } from "@/lib/format";

const TABS = [["", "All"], ["APPROVED", "Live"], ["PENDING_REVIEW", "In review"], ["DRAFT", "Drafts"], ["REJECTED", "Rejected"], ["SUSPENDED", "Suspended"]] as const;

export function HostelsList() {
  const [status, setStatus] = React.useState<string>("");
  const q = useInfiniteQuery({
    queryKey: ["owner", "hostels", status], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/owner/hostels", { params: { query: { limit: 12, ...(status ? { status: status as "APPROVED" } : {}), ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="grid gap-6">
      <PageHeader title="Properties" description="Your hostels and PGs." actions={<Button asChild><Link href="/owner/hostels/new"><Plus />New property</Link></Button>} />
      <Tabs value={status} onValueChange={setStatus}><TabsList>{TABS.map(([v, l]) => <TabsTrigger key={v || "all"} value={v}>{l}</TabsTrigger>)}</TabsList></Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={Building2} title={status ? "Nothing here" : "No properties yet"} description="Create a listing, add rooms and photos, then submit it for review." action={<Button asChild><Link href="/owner/hostels/new"><Plus />Create a listing</Link></Button>} />
        : <ul className="grid gap-3">{items.map((h) => (
          <li key={h.id}>
            <Link href={`/owner/hostels/${h.id}`} className="pressable flex gap-4 rounded-2xl border bg-card p-3 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring sm:p-4">
              <div className="size-24 shrink-0 overflow-hidden rounded-xl bg-muted sm:size-28">{h.coverUrl ?   <img src={h.coverUrl} alt="" loading="lazy" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-muted-foreground"><Building2 className="size-7 opacity-40" /></div>}</div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h3 title={h.name} className="line-clamp-2 font-semibold [overflow-wrap:anywhere]">{h.name}</h3>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"><span className="min-w-0 truncate">{h.city}</span><StatusBadge status={h.status} /></p>
                <p className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"><span>{plural(h.roomTypeCount, "room type")}</span><span>{plural(h.mediaCount, "photo")}</span>{h.minPricePaise !== null && <span className="tnum">from {money(h.minPricePaise)}</span>}<RatingBadge rating={h.avgRating} count={h.reviewCount} /></p>
                {h.status === "REJECTED" && h.rejectionReason && <p className="line-clamp-1 text-xs text-destructive">Rejected: {h.rejectionReason}</p>}
              </div>
            </Link>
          </li>
        ))}</ul>}
      <LoadMore query={q} />
    </div>
  );
}
