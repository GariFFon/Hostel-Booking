"use client";
import * as React from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { api, unwrap } from "@/lib/api/client";
import { AdminResolveDialog } from "@/features/tenancy/settlement";
import { fmtDate, money } from "@/lib/format";

const STATUSES = ["INVITED", "PENDING_MOVE_IN", "ACTIVE", "NOTICE", "ENDED", "CANCELLED"] as const;

export function AdminTenancies() {
  const [status, setStatus] = React.useState<string>("all");
  const q = useInfiniteQuery({
    queryKey: ["admin", "tenancies", status], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/admin/tenancies", { params: { query: { limit: 20, ...(status !== "all" ? { status: status as (typeof STATUSES)[number] } : {}), ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const qc = useQueryClient();
  const [resolve, setResolve] = React.useState<(typeof items)[number] | null>(null);
  return (
    <div className="grid gap-6">
      <PageHeader title="Stays" description="Long-term tenancies across the platform, for oversight." actions={
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="h-10 w-auto min-w-40 md:h-9" aria-label="Filter by status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any status</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}><StatusBadge status={s} /></SelectItem>)}</SelectContent></Select>} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={Users} title="No stays yet" description="Tenancies appear here once owners approve requests or add tenants." />
        : <ul className="grid gap-3">{items.map((t) => (
          <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-card p-4">
            <div className="min-w-0"><p className="flex flex-wrap items-center gap-2"><span className="font-semibold [overflow-wrap:anywhere]">{t.tenant?.name ?? t.tenant?.email ?? t.inviteEmail}</span><StatusBadge status={t.status} /></p>
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{t.hostel.name}, {t.hostel.city} · {t.roomType.name} · bed {t.unit.label}</p>
              <p className="tnum text-xs text-muted-foreground">From {fmtDate(t.startDate)} · <span className="font-mono">{t.code}</span></p></div>
            <div className="grid justify-items-end gap-2">
              <p className="tnum text-lg font-semibold">{money(t.rentPaise)}<span className="text-sm font-normal text-muted-foreground"> / month</span></p>
              {t.settlement && <Button size="sm" variant={t.settlement.status === "DISPUTED" ? "default" : "outline"} onClick={() => setResolve(t)}>{t.settlement.status === "DISPUTED" ? "Resolve dispute" : `Deposit: ${t.settlement.status.toLowerCase()}`}</Button>}
            </div>
          </li>
        ))}</ul>}
      <LoadMore query={q} />
      {resolve && <AdminResolveDialog tenancyId={resolve.id} tenant={resolve.tenant?.name ?? resolve.tenant?.email ?? "Tenant"} open onOpenChange={(o) => !o && setResolve(null)} onDone={() => qc.invalidateQueries({ queryKey: ["admin", "tenancies"] })} />}
    </div>
  );
}
