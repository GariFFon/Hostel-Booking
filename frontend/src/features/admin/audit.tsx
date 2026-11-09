"use client";
import * as React from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { ChevronDown, ScrollText, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { FormField } from "@/components/common/form-field";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { count, fmtDateTime } from "@/lib/format";
import type { Item } from "@/lib/api/types";
import { cn } from "@/lib/utils";

type Entry = Item<"/admin/audit-logs">;
const TONE = { SUCCESS: "success", FAILURE: "danger", DENIED: "warning" } as const;

function Row({ e }: { e: Entry }) {
  const [open, setOpen] = React.useState(false);
  const detail = { before: e.before, after: e.after, metadata: e.metadata };
  const has = e.before != null || e.after != null || e.metadata != null;
  return (
    <li className="rounded-xl border bg-card">
      <button type="button" onClick={() => has && setOpen((o) => !o)} aria-expanded={open} disabled={!has} className={cn("flex w-full items-start gap-3 p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", has && "pressable")}>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-semibold">{e.action}</span><Badge tone={TONE[e.outcome]}>{e.outcome.toLowerCase()}</Badge></span>
          <span className="mt-0.5 block text-xs text-muted-foreground [overflow-wrap:anywhere]">{e.entityType}{e.entityId ? ` ${e.entityId.slice(0, 8)}…` : ""} · {e.actorRole ?? "system"}{e.actorId ? ` ${e.actorId.slice(0, 8)}…` : ""} · {e.ip ?? "no ip"}</span>
        </span>
        <span className="tnum shrink-0 text-xs text-muted-foreground">#{e.id} · {fmtDateTime(e.at, true)}</span>
        {has && <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />}
      </button>
      {open && <pre className="max-h-80 overflow-auto border-t bg-muted/50 p-3 font-mono text-xs leading-relaxed">{JSON.stringify(detail, null, 2)}</pre>}
    </li>
  );
}

export function AuditViewer() {
  const [f, setF] = React.useState({ action: "", entityType: "", entityId: "", actorId: "", outcome: "" });
  const [applied, setApplied] = React.useState(f);
  const clean = Object.fromEntries(Object.entries(applied).filter(([, v]) => v));
  const q = useInfiniteQuery({
    queryKey: ["admin", "audit", clean], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/admin/audit-logs", { params: { query: { limit: 30, ...clean, ...(pageParam ? { cursor: pageParam } : {}) } as never } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const verify = useMutation({ mutationFn: () => unwrapData(api.GET("/admin/audit-logs/verify")), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <div className="grid gap-6">
      <PageHeader title="Audit log" description="Every change, who made it and from where. Entries can't be edited or deleted; the log is hash-chained so tampering is detectable." actions={<Button variant="outline" loading={verify.isPending} onClick={() => verify.mutate()}><ShieldCheck />Verify chain</Button>} />
      {verify.data && (verify.data.intact ? <Alert tone="success" title="Chain intact">{count(verify.data.rowsChecked)} entries verified.</Alert> : <Alert tone="danger" title="Tampering detected">{verify.data.broken.length} entries failed. First: #{verify.data.broken[0]?.id} ({verify.data.broken[0]?.reason}).</Alert>)}
      <form onSubmit={(e) => { e.preventDefault(); setApplied(f); }} className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5" role="search" aria-label="Filter the audit log">
        <FormField label="Action starts with" htmlFor="a-action"><Input id="a-action" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="booking." autoCapitalize="none" /></FormField>
        <FormField label="Entity type" htmlFor="a-type"><Input id="a-type" value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value })} placeholder="hostel" autoCapitalize="none" /></FormField>
        <FormField label="Entity id" htmlFor="a-eid"><Input id="a-eid" value={f.entityId} onChange={(e) => setF({ ...f, entityId: e.target.value })} className="font-mono" autoCapitalize="none" /></FormField>
        <FormField label="Actor id" htmlFor="a-actor"><Input id="a-actor" value={f.actorId} onChange={(e) => setF({ ...f, actorId: e.target.value })} className="font-mono" autoCapitalize="none" /></FormField>
        <FormField label="Outcome" htmlFor="a-out"><Select value={f.outcome || "any"} onValueChange={(v) => setF({ ...f, outcome: v === "any" ? "" : v })}><SelectTrigger id="a-out"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any</SelectItem><SelectItem value="SUCCESS">Success</SelectItem><SelectItem value="FAILURE">Failure</SelectItem><SelectItem value="DENIED">Denied</SelectItem></SelectContent></Select></FormField>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5"><Button type="submit">Apply filters</Button><Button type="button" variant="ghost" onClick={() => { const e = { action: "", entityType: "", entityId: "", actorId: "", outcome: "" }; setF(e); setApplied(e); }}>Reset</Button></div>
      </form>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={ScrollText} title="No matching entries" />
        : <ul className="grid gap-2">{items.map((e) => <Row key={e.id} e={e} />)}</ul>}
      <LoadMore query={q} />
    </div>
  );
}
