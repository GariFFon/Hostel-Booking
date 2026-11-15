"use client";
import * as React from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { isLongTerm } from "@/lib/property";
import { ComplaintCard, ComplaintDialog, useOpenFromUrl } from "./common";

const TABS = [["new", "Needs assigning"], ["overdue", "Overdue"], ["active", "In progress"], ["done", "Resolved"], ["all", "All"]] as const;
type Tab = (typeof TABS)[number][0];

export function OwnerComplaints() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<Tab>("new");
  const [hostelId, setHostelId] = React.useState("all");
  const [openId, setOpenId] = useOpenFromUrl();
  const hostels = useQuery({ queryKey: ["owner", "hostels", "options"], staleTime: 60_000, queryFn: () => unwrapData(api.GET("/owner/hostels", { params: { query: { limit: 50 } } })) });
  const longTerm = (hostels.data ?? []).filter((h) => isLongTerm(h.propertyType));
  const q = useInfiniteQuery({
    queryKey: ["owner", "complaints", tab, hostelId], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/owner/complaints", { params: { query: {
      limit: 20, ...(hostelId !== "all" ? { hostelId } : {}), ...(pageParam ? { cursor: pageParam } : {}),
      ...(tab === "new" ? { unassigned: "true" as const } : tab === "overdue" ? { overdue: "true" as const } : tab === "done" ? { status: "RESOLVED" as const } : {}),
    } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const raw = q.data?.pages.flatMap((p) => p.data) ?? [];
  const items = tab === "active" ? raw.filter((c) => ["ASSIGNED", "IN_PROGRESS", "ON_HOLD", "REOPENED", "ACKNOWLEDGED", "OPEN"].includes(c.status)) : raw;
  const sync = () => qc.invalidateQueries({ queryKey: ["owner", "complaints"] });
  return (
    <div className="grid gap-6">
      <PageHeader title="Complaints" description="Problems your tenants report. Staff of the right trade get them automatically; anything left over waits here for you."
        actions={<div className="flex flex-wrap gap-2">
          {longTerm.length > 1 && <Select value={hostelId} onValueChange={setHostelId}><SelectTrigger className="h-10 w-auto min-w-44 md:h-9" aria-label="Filter by property"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All properties</SelectItem>{longTerm.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent></Select>}
          <Button asChild variant="outline" size="sm"><Link href="/owner/staff">Manage staff</Link></Button></div>} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}><TabsList>{TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}</TabsList></Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={Wrench} title={tab === "new" ? "Nothing waiting for you" : tab === "overdue" ? "Nothing overdue" : "No complaints here"} description={tab === "new" ? "New complaints that no staff member could take show up here." : "Complaints appear here as tenants report them."} />
        : <ul className="grid gap-3">{items.map((c) => <ComplaintCard key={c.id} c={c} who="owner" onOpen={() => setOpenId(c.id)} />)}</ul>}
      <LoadMore query={q} />
      {openId && <ComplaintDialog id={openId} open onOpenChange={(o) => !o && setOpenId(null)} onChanged={sync} />}
    </div>
  );
}
