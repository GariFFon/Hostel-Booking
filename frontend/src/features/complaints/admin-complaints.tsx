"use client";
import * as React from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { api, unwrap } from "@/lib/api/client";
import { titleCase } from "@/lib/format";
import { ComplaintCard, ComplaintDialog, STATUSES } from "./common";

/** Read-only oversight: admins can see every complaint but never act on one. */
export function AdminComplaints() {
  const qc = useQueryClient();
  const [status, setStatus] = React.useState("all");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["admin", "complaints", status], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/admin/complaints", { params: { query: { limit: 20, ...(status !== "all" ? { status: status as (typeof STATUSES)[number] } : {}), ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="grid gap-6">
      <PageHeader title="Complaints" description="Every complaint on the platform, for oversight. Owners and staff handle them."
        actions={<Select value={status} onValueChange={setStatus}><SelectTrigger className="h-10 w-auto min-w-40 md:h-9" aria-label="Filter by status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any status</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent></Select>} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={Wrench} title="No complaints" description="Nothing matches this filter." />
        : <ul className="grid gap-3">{items.map((c) => <ComplaintCard key={c.id} c={c} who="owner" onOpen={() => setOpenId(c.id)} />)}</ul>}
      <LoadMore query={q} />
      {openId && <ComplaintDialog id={openId} open onOpenChange={(o) => !o && setOpenId(null)} onChanged={() => qc.invalidateQueries({ queryKey: ["admin", "complaints"] })} />}
    </div>
  );
}
