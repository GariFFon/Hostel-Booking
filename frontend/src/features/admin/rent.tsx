"use client";
import * as React from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { fmtDate, localToday, money } from "@/lib/format";
import { DocButton, ReceiptButton, RefundDialog, RefundNotes, type PaymentRow, payMethodLabel } from "@/features/rent/payment-actions";

const TABS = [["overdue", "Overdue"], ["due", "Due"], ["partial", "Part paid"], ["paid", "Paid"], ["all", "All"]] as const;
type Tab = (typeof TABS)[number][0];
const exact = { exact: true } as const;

/** Rent across every property on the platform: totals, a list that can be filtered, and the support actions (receipts, refunds). */
export function AdminRent() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<Tab>("overdue");
  const [month, setMonth] = React.useState(localToday().slice(0, 7));
  const [hostelId, setHostelId] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const roll = useQuery({ queryKey: ["admin", "rent", "roll", month, hostelId], queryFn: () => unwrapData(api.GET("/admin/rent-roll", { params: { query: { month, ...(hostelId ? { hostelId } : {}) } } })) });
  const q = useInfiniteQuery({
    queryKey: ["admin", "rent", "list", tab, month, hostelId], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/admin/rent-invoices", { params: { query: {
      limit: 20, ...(tab === "all" || tab === "overdue" ? {} : { month }), ...(hostelId ? { hostelId } : {}), ...(pageParam ? { cursor: pageParam } : {}),
      ...(tab === "overdue" ? { overdue: "true" as const } : tab === "due" ? { status: "DUE" as const } : tab === "partial" ? { status: "PARTIALLY_PAID" as const } : tab === "paid" ? { status: "PAID" as const } : {}),
    } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const t = roll.data?.totals;
  const sync = () => qc.invalidateQueries({ queryKey: ["admin", "rent"] });
  const picked = roll.data?.byHostel.find((h) => h.hostelId === hostelId);

  return (
    <div className="grid gap-6">
      <PageHeader title="Rent" description="Every long-term property on the platform. Look into a tenant's invoice, open a receipt, or refund an online payment."
        actions={<div className="flex flex-wrap items-center gap-2"><Input type="month" aria-label="Month" className="h-10 w-auto md:h-9" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          {hostelId && <Button size="sm" variant="outline" onClick={() => setHostelId(null)}>{picked?.name ?? "One property"}<X /></Button>}</div>} />

      <section aria-label="Rent roll" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {roll.isPending ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />) : t ? <>
          <Stat label="Billed" value={money(t.invoicedPaise, exact)} sub={`${t.invoices} ${t.invoices === 1 ? "invoice" : "invoices"} · ${roll.data!.activeTenants} tenants`} />
          <Stat label="Collected" value={money(t.collectedPaise, exact)} sub={`${money(t.collectedOnlinePaise, exact)} online · ${money(t.collectedOfflinePaise, exact)} recorded`} />
          <Stat label="Still owed" value={money(t.outstandingPaise, exact)} sub="for this month's invoices" />
          <Stat label="Overdue" value={money(t.overduePaise, exact)} sub={`${t.overdueCount} ${t.overdueCount === 1 ? "invoice" : "invoices"}`} danger={t.overdueCount > 0} />
        </> : null}
      </section>

      {roll.data && roll.data.byHostel.length > 0 && !hostelId && (
        <section aria-label="By property" className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">Rent by property for the month</caption>
            <thead className="text-left text-xs text-muted-foreground"><tr><th scope="col" className="p-3 font-medium">Property</th><th scope="col" className="p-3 text-right font-medium">Billed</th><th scope="col" className="p-3 text-right font-medium">Collected</th><th scope="col" className="p-3 text-right font-medium">Owed</th><th scope="col" className="p-3 text-right font-medium">Overdue</th></tr></thead>
            <tbody>{roll.data.byHostel.map((h) => (
              <tr key={h.hostelId} className="border-t"><th scope="row" className="p-3 text-left font-medium"><button type="button" className="text-left underline-offset-2 hover:underline focus-visible:underline" onClick={() => setHostelId(h.hostelId)}>{h.name}</button></th>
                <td className="tnum p-3 text-right">{money(h.invoicedPaise, exact)}</td><td className="tnum p-3 text-right">{money(h.collectedPaise, exact)}</td><td className="tnum p-3 text-right">{money(h.outstandingPaise, exact)}</td>
                <td className={`tnum p-3 text-right ${h.overdueCount > 0 ? "font-medium text-destructive" : ""}`}>{money(h.overduePaise, exact)}</td></tr>))}</tbody>
          </table>
        </section>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}><TabsList>{TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}</TabsList></Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={Banknote} title={tab === "overdue" ? "Nothing overdue" : "No invoices here"} description="Nothing matches this filter." />
        : <ul className="grid gap-3">{items.map((i) => (
          <li key={i.id}><button type="button" onClick={() => setOpenId(i.id)} className="grid w-full gap-1.5 rounded-2xl border bg-card p-4 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex flex-wrap items-start justify-between gap-3">
              <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold [overflow-wrap:anywhere]">{i.tenant.name ?? i.tenant.email}</span><StatusBadge status={i.status} />{i.overdue.isOverdue && <Badge tone="danger">{i.overdue.days}d overdue</Badge>}</span>
                <span className="block text-sm text-muted-foreground">{i.hostel.name} · bed {i.tenancy.unitLabel}</span>
                <span className="tnum block text-xs text-muted-foreground">{fmtDate(i.periodStart)} to {fmtDate(i.periodEnd)} · due {fmtDate(i.dueDate)} · <span className="font-mono">{i.number}</span></span></span>
              <span className="tnum text-lg font-semibold">{money(i.totalPaise, exact)}</span>
            </span>
          </button></li>))}</ul>}
      <LoadMore query={q} />
      {openId && <InvoiceDialog id={openId} open onOpenChange={(o) => !o && setOpenId(null)} onChanged={sync} />}
    </div>
  );
}

function Stat({ label, value, sub, danger }: { label: string; value: string; sub: string; danger?: boolean }) {
  return <div className="rounded-2xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className={`tnum mt-1 text-2xl font-semibold ${danger ? "text-destructive" : ""}`}>{value}</p><p className="tnum mt-0.5 text-xs text-muted-foreground">{sub}</p></div>;
}

function InvoiceDialog({ id, open, onOpenChange, onChanged }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "rent", "invoice", id], queryFn: () => unwrapData(api.GET("/admin/rent-invoices/{id}", { params: { path: { id } } })) });
  const [refund, setRefund] = React.useState<PaymentRow | null>(null);
  const i = q.data;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={i ? `Invoice ${i.number}` : "Invoice"} description={i ? `${i.tenant.name ?? i.tenant.email} · ${i.hostel.name} · bed ${i.tenancy.unitLabel}` : undefined} className="sm:max-w-lg">
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !i ? <Skeleton className="h-48" /> : (
        <div className="grid max-h-[65dvh] gap-4 overflow-y-auto overscroll-contain p-0.5 text-sm">
          <p className="flex flex-wrap items-center gap-2"><StatusBadge status={i.status} />{i.overdue.isOverdue && <Badge tone="danger">{i.overdue.days}d overdue</Badge>}<span className="tnum text-muted-foreground">{fmtDate(i.periodStart)} to {fmtDate(i.periodEnd)} · due {fmtDate(i.dueDate)}</span></p>
          <ul className="grid gap-1 rounded-xl bg-muted/50 p-3">{i.lines.map((l) => <li key={l.id} className="flex justify-between gap-3"><span className="min-w-0 [overflow-wrap:anywhere]">{l.description}</span><span className="tnum shrink-0">{money(l.amountPaise, exact)}</span></li>)}
            {i.taxPaise > 0 && <li className="flex justify-between gap-3"><span>GST ({i.gstRateBps / 100}% on rent)</span><span className="tnum">{money(i.taxPaise, exact)}</span></li>}
            <li className="mt-1 flex justify-between gap-3 border-t pt-2 font-semibold"><span>Total</span><span className="tnum">{money(i.totalPaise, exact)}</span></li>
            <li className="flex justify-between gap-3"><span>Paid</span><span className="tnum">{money(i.paidPaise, exact)}</span></li>
            <li className="flex justify-between gap-3 font-semibold"><span>Balance</span><span className="tnum">{money(i.balancePaise, exact)}</span></li></ul>
          <div><DocButton kind="invoice" id={i.id} who="admin" /></div>
          {i.payments.length === 0 ? <p className="text-muted-foreground">No payments yet.</p> : <div><p className="mb-1 font-semibold">Payments</p><ul className="grid gap-2">{i.payments.map((p) => (
            <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2.5 ${p.reversed ? "text-muted-foreground" : ""}`}>
              <span className="min-w-0"><span className={`tnum block ${p.reversed ? "line-through" : ""}`}>{money(p.amountPaise, exact)} · {payMethodLabel(p.method)} · {fmtDate(p.receivedOn)}</span><span className="block font-mono text-xs">{p.receiptNo}{p.reference ? ` · ${p.reference}` : ""}{p.reversed ? ` · reversed: ${p.reverseReason}` : ""}</span><RefundNotes p={p} /></span>
              <span className="flex shrink-0 flex-wrap justify-end gap-1">{!p.reversed && <ReceiptButton paymentId={p.id} who="admin" />}{p.canRefund && <Button size="sm" variant="ghost" onClick={() => setRefund(p)}>Refund</Button>}</span>
            </li>))}</ul></div>}
        </div>
      )}
      {refund && <RefundDialog payment={refund} who="admin" open onOpenChange={(o) => !o && setRefund(null)} onDone={() => { setRefund(null); qc.invalidateQueries({ queryKey: ["admin", "rent"] }); onChanged(); }} />}
    </ResponsiveDialog>
  );
}
