"use client";
import * as React from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrap } from "@/lib/api/client";
import { money, plural, timeAgo } from "@/lib/format";

const TABS = ["PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED", "DRAFT"] as const;
const LABEL: Record<string, string> = { PENDING_REVIEW: "In review", APPROVED: "Live", REJECTED: "Rejected", SUSPENDED: "Suspended", DRAFT: "Drafts" };

export function HostelsQueue() {
  const [status, setStatus] = React.useState<(typeof TABS)[number]>("PENDING_REVIEW");
  const q = useInfiniteQuery({
    queryKey: ["admin", "hostels", status, "list"], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/admin/hostels", { params: { query: { status, limit: 15, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="grid gap-6">
      <PageHeader title="Listings" description="Review new properties before they go live. The queue is oldest first." />
      <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)}><TabsList>{TABS.map((t) => <TabsTrigger key={t} value={t}>{LABEL[t]}</TabsTrigger>)}</TabsList></Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>
        : items.length === 0 ? <EmptyState icon={Building2} title="Nothing here" description={status === "PENDING_REVIEW" ? "The queue is empty. Nice." : "No listings with this status."} />
        : <ul className="grid gap-3">{items.map((h) => (
          <li key={h.id}><Link href={`/admin/hostels/${h.id}`} className="pressable flex gap-4 rounded-2xl border bg-card p-3 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring sm:p-4">
            <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-muted sm:size-24">{h.coverUrl &&   <img src={h.coverUrl} alt="" loading="lazy" className="size-full object-cover" />}</div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-start justify-between gap-2"><h3 className="line-clamp-2 min-w-0 font-semibold [overflow-wrap:anywhere]">{h.name}</h3><StatusBadge status={h.status} /></div>
              <p className="truncate text-sm text-muted-foreground">{h.city} · {h.propertyType === "PG" ? "PG" : "Hostel"} · {h.owner.ownerProfile?.businessName ?? h.owner.profile?.fullName ?? h.owner.email}</p>
              <p className="mt-auto text-xs text-muted-foreground">{plural(h.roomTypeCount, "room type")} · {plural(h.mediaCount, "photo")}{h.minPricePaise !== null ? ` · from ${money(h.minPricePaise)}` : ""} · updated {timeAgo(h.updatedAt)}</p>
            </div>
          </Link></li>
        ))}</ul>}
      <LoadMore query={q} />
    </div>
  );
}
