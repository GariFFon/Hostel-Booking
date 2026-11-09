"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarX2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { fmtDateTime, fmtRange, money, plural, titleCase } from "@/lib/format";

export function AdminBookings() {
  const [when, setWhen] = React.useState<"all" | "upcoming" | "past">("all");
  const q = useInfiniteQuery({
    queryKey: ["admin", "bookings", when], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/admin/bookings", { params: { query: { when, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="grid gap-6">
      <PageHeader title="Bookings" description="Every booking on the platform." />
      <Tabs value={when} onValueChange={(v) => setWhen(v as typeof when)}><TabsList><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="past">Past</TabsTrigger></TabsList></Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3"><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-20 rounded-2xl" /></div>
        : items.length === 0 ? <EmptyState icon={CalendarX2} title="No bookings" />
        : <ul className="grid gap-3">{items.map((b) => <li key={b.id}><Link href={`/admin/bookings/${b.id}`} className="pressable flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold [overflow-wrap:anywhere]">{b.hostel.name}</span><StatusBadge status={b.status} /></span><span className="tnum block text-sm text-muted-foreground">{b.guestName ?? "Guest"} · {fmtRange(b.checkIn, b.checkOut)} · {plural(b.guestsCount, "guest")} · <span className="font-mono text-xs">{b.code}</span></span></span><span className="tnum text-lg font-semibold">{money(b.totalPaise, { exact: true })}</span></Link></li>)}</ul>}
      <LoadMore query={q} />
    </div>
  );
}

export function AdminBookingDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const b = useQuery({ queryKey: ["admin", "booking", id], queryFn: () => unwrapData(api.GET("/admin/bookings/{id}", { params: { path: { id } } })) });
  const ledger = useQuery({ queryKey: ["admin", "ledger", id], queryFn: () => unwrapData(api.GET("/admin/bookings/{id}/ledger", { params: { path: { id } } })) });
  const cancel = useMutation({ mutationFn: (reason: string) => unwrapData(api.POST("/admin/bookings/{id}/cancel", { params: { path: { id } }, body: { reason } })), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); toast.success("Cancelled. The guest is refunded in full."); } });
  if (b.isError) return <ErrorState error={b.error} onRetry={() => b.refetch()} />;
  const d = b.data;
  if (!d) return <div className="grid gap-4"><Skeleton className="h-9 w-72" /><Skeleton className="h-72" /></div>;
  const money0 = (n: number) => money(n, { exact: true });
  return (
    <div className="grid max-w-4xl gap-6">
      <Link href="/admin/bookings" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Bookings</Link>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3">{d.hostel.name}<StatusBadge status={d.status} /></span>} description={`${d.code} · ${fmtRange(d.checkIn, d.checkOut)} · ${plural(d.nights, "night")} · ${plural(d.guestsCount, "guest")}`} actions={(d.actions as string[]).includes("cancel") ? <Button variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}>Cancel and refund</Button> : undefined} />
      <div className="grid gap-6 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Guest</CardTitle></CardHeader><CardContent className="grid gap-1 text-sm"><p className="font-medium">{d.guest?.name ?? "—"}</p><p className="text-muted-foreground">{d.guest?.email}</p><p className="text-muted-foreground">{d.guest?.phone}</p></CardContent></Card>
        <Card><CardHeader><CardTitle>Amounts</CardTitle></CardHeader><CardContent className="grid gap-1.5 text-sm"><Row l="Room charges" v={money0(d.pricing.subtotalPaise)} />{d.pricing.discountPaise > 0 && <Row l={`Discount (${d.pricing.couponCode ?? ""})`} v={`−${money0(d.pricing.discountPaise)}`} />}<Row l="GST" v={money0(d.pricing.taxPaise)} /><div className="flex justify-between border-t pt-2 font-semibold"><span>Total</span><span className="tnum">{money0(d.pricing.totalPaise)}</span></div>{d.ownerShare && <Row l="Host earns (after commission)" v={money0(d.ownerShare.ownerNetPaise)} />}</CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Money trail</CardTitle></CardHeader><CardContent className="grid gap-4">
        {ledger.isPending ? <Skeleton className="h-32" /> : ledger.isError ? <ErrorState compact error={ledger.error} /> : !ledger.data.entries.length ? <p className="text-sm text-muted-foreground">No money has moved for this booking.</p> : (
          <>
            <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[34rem] text-sm"><thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">From → To</th><th className="px-3 py-2 font-medium">Memo</th><th className="px-3 py-2 text-right font-medium">Amount</th></tr></thead>
              <tbody className="divide-y">{ledger.data.entries.map((e) => <tr key={e.id}><td className="tnum px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDateTime(e.createdAt)}</td><td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{titleCase(e.from)} → {titleCase(e.to)}</td><td className="px-3 py-2 [overflow-wrap:anywhere]">{e.memo}</td><td className="tnum px-3 py-2 text-right font-medium">{money0(e.amountPaise)}</td></tr>)}</tbody></table></div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">{Object.entries(ledger.data.balances).map(([k, v]) => <div key={k} className="rounded-lg border p-2.5"><dt className="text-xs text-muted-foreground">{titleCase(k)}</dt><dd className="tnum font-semibold">{money0(v as number)}</dd></div>)}</dl>
            <p className="text-xs text-muted-foreground">Escrow returns to ₹0 once a booking is settled or fully refunded.</p>
          </>
        )}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Timeline</CardTitle></CardHeader><CardContent><ol className="relative grid gap-4 border-l pl-5">{d.timeline.map((t, i) => <li key={i} className="relative"><span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-primary ring-4 ring-card" /><StatusBadge status={t.status} /><p className="mt-0.5 text-xs text-muted-foreground">{fmtDateTime(t.at, true)}{t.actorRole ? ` · ${t.actorRole.toLowerCase()}` : ""}{t.reason ? ` · ${t.reason}` : ""}</p></li>)}</ol></CardContent></Card>
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} destructive title="Cancel on behalf of the platform?" confirmLabel="Cancel and refund" description="The guest receives a full refund, and the host is not paid for this booking." reason={{ label: "Reason (shown to the guest)", required: true, max: 500 }} onConfirm={(r) => cancel.mutateAsync(r)} />
    </div>
  );
}
const Row = ({ l, v }: { l: string; v: string }) => <div className="flex justify-between gap-3"><span className="text-muted-foreground">{l}</span><span className="tnum">{v}</span></div>;
