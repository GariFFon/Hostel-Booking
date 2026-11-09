"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, CalendarClock, Percent, ReceiptText, Undo2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/error-state";
import { FormField } from "@/components/common/form-field";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { api, unwrapData } from "@/lib/api/client";
import { addDays, localToday, money, plural } from "@/lib/format";

export function EarningsView() {
  const today = localToday();
  const [from, setFrom] = React.useState(addDays(today, -90));
  const [to, setTo] = React.useState(today);
  const ok = from && to && from <= to;
  const q = useQuery({ queryKey: ["owner", "earnings", from, to], enabled: !!ok, queryFn: () => unwrapData(api.GET("/owner/earnings", { params: { query: { from, to } } })) });
  const d = q.data;
  return (
    <div className="grid gap-6">
      <PageHeader title="Earnings" description="From completed stays, after commission. GST is collected for the tax authority and isn't your income." />
      <div className="grid max-w-md grid-cols-2 gap-3"><FormField label="From" htmlFor="e-from"><Input id="e-from" type="date" max={to} value={from} onChange={(e) => setFrom(e.target.value)} /></FormField><FormField label="To" htmlFor="e-to"><Input id="e-to" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></FormField></div>
      {!ok ? <p className="text-sm text-destructive">Pick a start date on or before the end date.</p> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : !d ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div> : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="You earned" value={money(d.settled.ownerPayablePaise)} icon={Banknote} hint={plural(d.settled.bookings, "completed stay")} />
              <StatCard label="Still to come" value={money(d.upcoming.expectedOwnerPaise)} icon={CalendarClock} hint={plural(d.upcoming.bookings, "confirmed booking")} />
              <StatCard label="Commission" value={money(d.settled.commissionPaise)} icon={Percent} hint="Platform fee on these stays" />
              <StatCard label="GST collected" value={money(d.settled.taxPaise)} icon={ReceiptText} hint="For the tax authority" />
            </div>
            {d.settled.refundedPaise > 0 && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Undo2 className="size-4" />{money(d.settled.refundedPaise)} was refunded to guests in this period.</p>}
            <Card><CardHeader><CardTitle>By property</CardTitle></CardHeader><CardContent>
              {d.byHostel.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No completed stays in this period.</p> : (
                <ul className="divide-y">{d.byHostel.map((h) => <li key={h.hostelId} className="flex items-center justify-between gap-4 py-3"><span className="min-w-0"><span className="block truncate font-medium">{h.name}</span><span className="text-xs text-muted-foreground">{plural(h.bookings, "stay")}</span></span><span className="tnum shrink-0 font-semibold">{money(h.ownerPayablePaise)}</span></li>)}</ul>
              )}
            </CardContent></Card>
            <p className="text-xs text-muted-foreground">Payouts are simulated in this demo: earnings are computed from the ledger, but no money is transferred.</p>
          </>
        )}
    </div>
  );
}
