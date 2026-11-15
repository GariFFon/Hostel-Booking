"use client";
import * as React from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { fmtDateTime, titleCase } from "@/lib/format";

const AREAS = [["all", "Everything"], ["tenancy.", "Stays and move-outs"], ["rent.", "Rent and refunds"], ["deposit.", "Deposits"], ["complaint.", "Complaints"], ["staff.", "Staff"], ["unit.", "Beds and rooms"], ["hostel.", "Listings"], ["booking.", "Bookings"]] as const;
const dayStart = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();
/** "tenancy.notice.give" -> "Tenancy notice give": readable enough, and exact enough to search for. */
const label = (action: string) => titleCase(action.replace(/\./g, " "));

/** Everything that changed at the owner's properties: who did it, when, and the before and after. Their own properties only. */
export function OwnerAudit() {
  const [hostelId, setHostelId] = React.useState("all");
  const [area, setArea] = React.useState<string>("all");
  const [outcome, setOutcome] = React.useState<"all" | "FAILURE" | "DENIED">("all");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const hostels = useQuery({ queryKey: ["owner", "hostels", "options"], staleTime: 60_000, queryFn: () => unwrapData(api.GET("/owner/hostels", { params: { query: { limit: 50 } } })) });
  const q = useInfiniteQuery({
    queryKey: ["owner", "audit", hostelId, area, outcome, from, to], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/owner/audit-logs", { params: { query: {
      limit: 30, ...(hostelId !== "all" ? { hostelId } : {}), ...(area !== "all" ? { action: area } : {}), ...(outcome !== "all" ? { outcome } : {}),
      ...(from ? { from: dayStart(from) } : {}), ...(to ? { to: dayEnd(to) } : {}), ...(pageParam ? { cursor: pageParam } : {}),
    } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const sel = "h-10 w-auto min-w-40 md:h-9";
  return (
    <div className="grid gap-6">
      <PageHeader title="Activity log" description="Everything that changed at your properties: who did it and when. Entries cannot be edited or deleted." />
      <div className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter the activity log">
        <Select value={hostelId} onValueChange={setHostelId}><SelectTrigger className={sel} aria-label="Property"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All properties</SelectItem>{(hostels.data ?? []).map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent></Select>
        <Select value={area} onValueChange={setArea}><SelectTrigger className={sel} aria-label="What happened"><SelectValue /></SelectTrigger><SelectContent>{AREAS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select>
        <Select value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)}><SelectTrigger className={sel} aria-label="Result"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any result</SelectItem><SelectItem value="FAILURE">Failed</SelectItem><SelectItem value="DENIED">Refused</SelectItem></SelectContent></Select>
        <label className="grid gap-1 text-xs text-muted-foreground">From<Input type="date" className="h-10 w-auto md:h-9" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">To<Input type="date" className="h-10 w-auto md:h-9" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={ScrollText} title="Nothing here" description="Changes to your properties show up here as they happen." />
        : <ol className="grid gap-2" aria-label="Activity">{items.map((r) => (
          <li key={r.id} className="rounded-xl border bg-card p-3 text-sm">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="font-medium">{label(r.action)}</span>
                {r.outcome !== "SUCCESS" && <Badge tone="danger">{r.outcome === "DENIED" ? "Refused" : "Failed"}</Badge>}
                <span className="text-muted-foreground">by {r.actor.name ?? (r.actor.role === "SYSTEM" || !r.actor.id ? "the system" : titleCase(r.actor.role ?? "someone"))}</span>
                {r.hostel && <span className="text-muted-foreground [overflow-wrap:anywhere]">· {r.hostel.name}</span>}
                <time dateTime={r.at} className="tnum ml-auto text-xs text-muted-foreground">{fmtDateTime(r.at, true)}</time>
              </summary>
              <dl className="mt-3 grid gap-2 text-xs">
                <div><dt className="text-muted-foreground">Action</dt><dd className="font-mono">{r.action}{r.entityId ? ` · ${r.entityType} ${r.entityId}` : ` · ${r.entityType}`}</dd></div>
                {(["before", "after", "metadata"] as const).map((k) => r[k] != null && <div key={k}><dt className="text-muted-foreground">{titleCase(k)}</dt><dd><pre className="max-h-48 overflow-auto rounded-lg bg-muted/60 p-2 font-mono [overflow-wrap:anywhere] whitespace-pre-wrap">{JSON.stringify(r[k], null, 2)}</pre></dd></div>)}
              </dl>
            </details>
          </li>))}</ol>}
      <LoadMore query={q} />
    </div>
  );
}
