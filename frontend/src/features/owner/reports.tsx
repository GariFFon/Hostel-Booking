"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileBarChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { api, unwrapData } from "@/lib/api/client";
import { downloadCsv } from "@/lib/csv";
import { fmtDate, money, plural } from "@/lib/format";
import { isLongTerm } from "@/lib/property";

const exact = { exact: true } as const;

/** Occupancy (which beds are lived in, leaving, reserved, free) and dues (who owes rent, and for how long). Each downloads as a CSV for a spreadsheet. */
export function OwnerReports() {
  const [tab, setTab] = React.useState<"occupancy" | "dues">("occupancy");
  const [hostelId, setHostelId] = React.useState("all");
  const hostels = useQuery({ queryKey: ["owner", "hostels", "options"], staleTime: 60_000, queryFn: () => unwrapData(api.GET("/owner/hostels", { params: { query: { limit: 50 } } })) });
  const longTerm = (hostels.data ?? []).filter((h) => isLongTerm(h.propertyType));
  const query = hostelId === "all" ? {} : { hostelId };
  return (
    <div className="grid gap-6">
      <PageHeader title="Reports" description="How full your properties are, and who owes rent."
        actions={longTerm.length > 1 ? <Select value={hostelId} onValueChange={setHostelId}><SelectTrigger className="h-10 w-auto min-w-44 md:h-9" aria-label="Filter by property"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All properties</SelectItem>{longTerm.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent></Select> : undefined} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}><TabsList><TabsTrigger value="occupancy">Occupancy</TabsTrigger><TabsTrigger value="dues">Rent dues</TabsTrigger></TabsList></Tabs>
      {tab === "occupancy" ? <Occupancy query={query} /> : <Dues query={query} />}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" }) {
  return <div className="rounded-2xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className={`tnum mt-1 text-2xl font-semibold ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p>{sub && <p className="tnum mt-0.5 text-xs text-muted-foreground">{sub}</p>}</div>;
}

function Occupancy({ query }: { query: { hostelId?: string } }) {
  const q = useQuery({ queryKey: ["owner", "reports", "occupancy", query], queryFn: () => unwrapData(api.GET("/owner/reports/occupancy", { params: { query } })) });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;
  const d = q.data;
  if (d.byHostel.length === 0) return <EmptyState icon={FileBarChart} title="No hostels or PGs yet" description="Occupancy is reported for long-term properties. Hotels take nightly bookings instead." />;
  const csv = () => downloadCsv(`occupancy-${d.asOf}.csv`, [["Property", "City", "Room", "Beds", "Lived in", "On notice", "Reserved", "Out of service", "Free"], ...d.byHostel.flatMap((h) => h.byRoom.map((r) => [h.name, h.city, r.name, r.units, r.occupied, r.onNotice, r.reserved, r.maintenance, r.vacant]))]);
  return (
    <div className="grid gap-6">
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Occupancy" value={`${d.totals.occupancyPct}%`} sub={`${d.totals.occupied + d.totals.onNotice} of ${d.totals.units - d.totals.maintenance} beds in service`} />
        <Tile label="Lived in" value={String(d.totals.occupied)} sub={`${d.totals.onNotice} leaving`} />
        <Tile label="Reserved" value={String(d.totals.reserved)} sub="not moved in yet" />
        <Tile label="Free" value={String(d.totals.vacant)} sub={d.totals.maintenance ? `${d.totals.maintenance} out of service` : "ready to let"} />
      </section>
      <div className="flex justify-end"><Button variant="outline" size="sm" onClick={csv}><Download />Download CSV</Button></div>
      <section aria-label="By property" className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Beds by state, per property and room</caption>
          <thead className="text-left text-xs text-muted-foreground"><tr><th scope="col" className="p-3 font-medium">Property / room</th><th scope="col" className="p-3 text-right font-medium">Beds</th><th scope="col" className="p-3 text-right font-medium">Lived in</th><th scope="col" className="p-3 text-right font-medium">Leaving</th><th scope="col" className="p-3 text-right font-medium">Reserved</th><th scope="col" className="p-3 text-right font-medium">Free</th></tr></thead>
          <tbody>{d.byHostel.map((h) => (
            <React.Fragment key={h.hostelId}>
              <tr className="border-t bg-muted/30"><th scope="row" className="p-3 text-left font-semibold">{h.name} <span className="font-normal text-muted-foreground">· {h.occupancyPct}% full</span></th><td className="tnum p-3 text-right">{h.units}</td><td className="tnum p-3 text-right">{h.occupied}</td><td className="tnum p-3 text-right">{h.onNotice}</td><td className="tnum p-3 text-right">{h.reserved}</td><td className="tnum p-3 text-right">{h.vacant}</td></tr>
              {h.byRoom.map((r) => <tr key={r.roomTypeId} className="border-t"><th scope="row" className="p-3 pl-6 text-left font-normal text-muted-foreground">{r.name}</th><td className="tnum p-3 text-right">{r.units}</td><td className="tnum p-3 text-right">{r.occupied}</td><td className="tnum p-3 text-right">{r.onNotice}</td><td className="tnum p-3 text-right">{r.reserved}</td><td className="tnum p-3 text-right">{r.vacant}</td></tr>)}
            </React.Fragment>))}</tbody>
        </table>
      </section>
      <section aria-label="Leaving soon" className="grid gap-2">
        <h2 className="text-lg font-semibold">Leaving soon</h2>
        {d.vacatingSoon.length === 0 ? <p className="text-sm text-muted-foreground">Nobody has given notice.</p>
          : <ul className="grid gap-2">{d.vacatingSoon.map((v) => <li key={v.tenancyId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3 text-sm"><span className="min-w-0 [overflow-wrap:anywhere]"><span className="font-medium">{v.tenant ?? "Tenant"}</span> · {v.hostel} · bed {v.unitLabel}</span><span className="tnum text-muted-foreground">{fmtDate(v.moveOutDate, "long")} · {v.daysLeft > 0 ? `in ${plural(v.daysLeft, "day")}` : "now"}</span></li>)}</ul>}
      </section>
    </div>
  );
}

function Dues({ query }: { query: { hostelId?: string } }) {
  const q = useQuery({ queryKey: ["owner", "reports", "dues", query], queryFn: () => unwrapData(api.GET("/owner/reports/dues", { params: { query } })) });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;
  const d = q.data;
  if (d.rows.length === 0) return <EmptyState icon={FileBarChart} title="Nobody owes rent" description="Every issued invoice is paid or cancelled." />;
  const csv = () => downloadCsv(`rent-dues-${d.asOf}.csv`, [["Tenant", "Email", "Property", "Bed", "Open invoices", "Owed (INR)", "Oldest due date", "Days overdue"], ...d.rows.map((r) => [r.tenant, r.email, r.hostel, r.unitLabel, r.invoices, r.owedPaise / 100, r.oldestDueDate, r.daysOverdue])]);
  return (
    <div className="grid gap-6">
      <section aria-label="By how overdue" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {d.buckets.map((b) => <Tile key={b.key} label={b.label} value={money(b.owedPaise, exact)} sub={plural(b.invoices, "invoice")} tone={b.key !== "NOT_DUE" && b.owedPaise > 0 ? "danger" : undefined} />)}
      </section>
      <p className="tnum text-sm text-muted-foreground">{plural(d.totals.tenants, "tenant")} owe {money(d.totals.owedPaise, exact)}, of which {money(d.totals.overduePaise, exact)} is overdue.</p>
      <div className="flex justify-end"><Button variant="outline" size="sm" onClick={csv}><Download />Download CSV</Button></div>
      <section aria-label="Who owes" className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Tenants who owe rent, longest overdue first</caption>
          <thead className="text-left text-xs text-muted-foreground"><tr><th scope="col" className="p-3 font-medium">Tenant</th><th scope="col" className="p-3 font-medium">Property · bed</th><th scope="col" className="p-3 text-right font-medium">Invoices</th><th scope="col" className="p-3 text-right font-medium">Owed</th><th scope="col" className="p-3 text-right font-medium">Overdue</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.tenancyId} className="border-t"><th scope="row" className="p-3 text-left font-medium [overflow-wrap:anywhere]">{r.tenant ?? r.email}</th><td className="p-3 [overflow-wrap:anywhere]">{r.hostel} · {r.unitLabel}</td><td className="tnum p-3 text-right">{r.invoices}</td><td className="tnum p-3 text-right">{money(r.owedPaise, exact)}</td><td className={`tnum p-3 text-right ${r.daysOverdue > 0 ? "font-medium text-destructive" : "text-muted-foreground"}`}>{r.daysOverdue > 0 ? `${r.daysOverdue} days` : "Not yet"}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}
