"use client";
import * as React from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { FormField, describe } from "@/components/common/form-field";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { fmtDate, localToday, money } from "@/lib/format";
import { isLongTerm } from "@/lib/property";
import type { Data } from "@/lib/api/types";
import { Actions, useSubmit } from "./form-utils";
import { DocButton, ReceiptButton, RefundDialog, RefundNotes, type PaymentRow, payMethodLabel } from "@/features/rent/payment-actions";

type Method = "CASH" | "UPI" | "BANK";
const TABS = [["overdue", "Overdue"], ["due", "Due"], ["partial", "Part paid"], ["paid", "Paid"], ["all", "All"]] as const;
type Tab = (typeof TABS)[number][0];
const rupees = (s: string) => Math.round(Number(s) * 100);
const exact = { exact: true } as const;

export function OwnerRent() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<Tab>("overdue");
  const [month, setMonth] = React.useState(localToday().slice(0, 7));
  const [hostelId, setHostelId] = React.useState("all");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const hostels = useQuery({ queryKey: ["owner", "hostels", "options"], staleTime: 60_000, queryFn: () => unwrapData(api.GET("/owner/hostels", { params: { query: { limit: 50 } } })) });
  const longTerm = (hostels.data ?? []).filter((h) => isLongTerm(h.propertyType));
  const roll = useQuery({ queryKey: ["owner", "rent", "roll", month, hostelId], queryFn: () => unwrapData(api.GET("/owner/rent-roll", { params: { query: { month, ...(hostelId !== "all" ? { hostelId } : {}) } } })) });
  const q = useInfiniteQuery({
    queryKey: ["owner", "rent", "list", tab, month, hostelId], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/owner/rent-invoices", { params: { query: {
      limit: 15, ...(tab === "all" || tab === "overdue" ? {} : { month }), ...(hostelId !== "all" ? { hostelId } : {}), ...(pageParam ? { cursor: pageParam } : {}),
      ...(tab === "overdue" ? { overdue: "true" as const } : tab === "due" ? { status: "DUE" as const } : tab === "partial" ? { status: "PARTIALLY_PAID" as const } : tab === "paid" ? { status: "PAID" as const } : {}),
    } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const sync = () => qc.invalidateQueries({ queryKey: ["owner", "rent"] });
  const t = roll.data?.totals;

  return (
    <div className="grid gap-6">
      <PageHeader title="Rent" description="Invoices are issued automatically a week before they are due. Record what you receive in cash, UPI or by bank transfer."
        actions={<div className="flex flex-wrap gap-2"><Input type="month" aria-label="Month" className="h-10 w-auto md:h-9" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          {longTerm.length > 1 && <Select value={hostelId} onValueChange={setHostelId}><SelectTrigger className="h-10 w-auto min-w-44 md:h-9" aria-label="Filter by property"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All properties</SelectItem>{longTerm.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent></Select>}</div>} />
      {hostels.isSuccess && longTerm.length === 0 && <Alert tone="info">Rent applies to hostels and PGs. Create a Hostel or PG listing and add tenants first.</Alert>}

      <section aria-label="Rent roll" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {roll.isPending ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />) : t ? <>
          <Stat label="Billed" value={money(t.invoicedPaise, exact)} sub={`${t.invoices} ${t.invoices === 1 ? "invoice" : "invoices"} · ${roll.data!.activeTenants} tenants`} />
          <Stat label="Collected" value={money(t.collectedPaise, exact)} sub={`${money(t.collectedOnlinePaise, exact)} online · ${money(t.collectedOfflinePaise, exact)} recorded`} />
          <Stat label="Still owed" value={money(t.outstandingPaise, exact)} sub="for this month's invoices" />
          <Stat label="Overdue" value={money(t.overduePaise, exact)} sub={`${t.overdueCount} ${t.overdueCount === 1 ? "invoice" : "invoices"}`} tone={t.overdueCount > 0 ? "danger" : undefined} />
        </> : null}
      </section>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}><TabsList>{TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}</TabsList></Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={Banknote} title={tab === "overdue" ? "Nothing overdue" : "No invoices here"} description={tab === "overdue" ? "Every tenant is paid up or still within the grace period." : "Invoices appear here once a tenant has moved in."} />
        : <ul className="grid gap-3">{items.map((i) => (
          <li key={i.id}><button type="button" onClick={() => setOpenId(i.id)} className="grid w-full gap-2 rounded-2xl border bg-card p-4 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex flex-wrap items-start justify-between gap-3">
              <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold [overflow-wrap:anywhere]">{i.tenant.name ?? i.tenant.email}</span><StatusBadge status={i.status} />{i.overdue.isOverdue && <Badge tone="danger">{i.overdue.days}d overdue</Badge>}</span>
                <span className="block text-sm text-muted-foreground">{i.hostel.name} · bed {i.tenancy.unitLabel}</span>
                <span className="tnum block text-xs text-muted-foreground">{fmtDate(i.periodStart)} to {fmtDate(i.periodEnd)} · due {fmtDate(i.dueDate)} · <span className="font-mono">{i.number}</span></span></span>
              <span className="text-right"><span className="tnum block text-lg font-semibold">{money(i.totalPaise, exact)}</span>{i.balancePaise > 0 && i.status !== "VOID" && i.paidPaise > 0 && <span className="tnum block text-xs text-muted-foreground">{money(i.balancePaise, exact)} left</span>}</span>
            </span>
          </button></li>
        ))}</ul>}
      <LoadMore query={q} />
      {openId && <InvoiceDialog id={openId} open onOpenChange={(o) => !o && setOpenId(null)} onChanged={sync} />}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "danger" }) {
  return <div className="rounded-2xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className={`tnum mt-1 text-2xl font-semibold ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p><p className="tnum mt-0.5 text-xs text-muted-foreground">{sub}</p></div>;
}

function InvoiceDialog({ id, open, onOpenChange, onChanged }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const q = useQuery({ queryKey: ["owner", "rent", "invoice", id], queryFn: () => unwrapData(api.GET("/owner/rent-invoices/{id}", { params: { path: { id } } })) });
  const [sub, setSub] = React.useState<"pay" | "line" | "void" | { reverse: string } | { refund: PaymentRow } | null>(null);
  const qc = useQueryClient();
  const refreshed = () => { qc.invalidateQueries({ queryKey: ["owner", "rent"] }); onChanged(); setSub(null); };
  const i = q.data;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={i ? `Invoice ${i.number}` : "Invoice"} description={i ? `${i.tenant.name ?? i.tenant.email} · ${i.hostel.name} · bed ${i.tenancy.unitLabel}` : undefined} className="sm:max-w-lg">
      {!i ? <Skeleton className="h-48" /> : (
        <div className="grid max-h-[65dvh] gap-4 overflow-y-auto overscroll-contain p-0.5 text-sm">
          <p className="flex flex-wrap items-center gap-2"><StatusBadge status={i.status} />{i.overdue.isOverdue && <Badge tone="danger">{i.overdue.days}d overdue</Badge>}<span className="tnum text-muted-foreground">{fmtDate(i.periodStart)} to {fmtDate(i.periodEnd)} · due {fmtDate(i.dueDate)}</span></p>
          {i.openOrder && <Alert tone="info">The tenant is paying this invoice online right now. You can record payments or change it again in a few minutes.</Alert>}
          <ul className="grid gap-1 rounded-xl bg-muted/50 p-3">{i.lines.map((l) => <li key={l.id} className="flex justify-between gap-3"><span className="min-w-0 [overflow-wrap:anywhere]">{l.description}</span><span className="tnum shrink-0">{money(l.amountPaise, exact)}</span></li>)}
            {i.taxPaise > 0 && <li className="flex justify-between gap-3"><span>GST ({i.gstRateBps / 100}% on rent)</span><span className="tnum">{money(i.taxPaise, exact)}</span></li>}
            <li className="mt-1 flex justify-between gap-3 border-t pt-2 font-semibold"><span>Total</span><span className="tnum">{money(i.totalPaise, exact)}</span></li>
            <li className="flex justify-between gap-3"><span>Paid</span><span className="tnum">{money(i.paidPaise, exact)}</span></li>
            <li className="flex justify-between gap-3 font-semibold"><span>Balance</span><span className="tnum">{money(i.balancePaise, exact)}</span></li></ul>
          {i.payments.length > 0 && <div><p className="mb-1 font-semibold">Payments</p><ul className="grid gap-2">{i.payments.map((p) => (
            <li key={p.id} className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 ${p.reversed ? "text-muted-foreground" : ""}`}>
              <span className="min-w-0"><span className={`tnum block ${p.reversed ? "line-through" : ""}`}>{money(p.amountPaise, exact)} · {payMethodLabel(p.method)} · {fmtDate(p.receivedOn)}</span><span className="block font-mono text-xs">{p.receiptNo}{p.reference ? ` · ${p.reference}` : ""}{p.reversed ? ` · reversed: ${p.reverseReason}` : ""}</span><RefundNotes p={p} /></span>
              <span className="flex shrink-0 flex-wrap justify-end gap-1">
                {!p.reversed && <ReceiptButton paymentId={p.id} who="owner" />}
                {p.canReverse && <Button size="sm" variant="ghost" onClick={() => setSub({ reverse: p.id })}><Undo2 />Reverse</Button>}
                {p.canRefund && <Button size="sm" variant="ghost" onClick={() => setSub({ refund: p })}><Undo2 />Refund</Button>}
              </span>
            </li>))}</ul></div>}
          <div className="flex flex-wrap gap-2 border-t pt-3"><DocButton kind="invoice" id={i.id} who="owner" /></div>
          {i.actions.length > 0 && <div className="flex flex-wrap gap-2">
            {i.actions.includes("record_payment") && <Button size="sm" onClick={() => setSub("pay")}><Banknote />Record payment</Button>}
            {i.actions.includes("add_line") && <Button size="sm" variant="outline" onClick={() => setSub("line")}><Plus />Add charge or credit</Button>}
            {i.actions.includes("void") && <Button size="sm" variant="ghost" onClick={() => setSub("void")}>Cancel invoice</Button>}
          </div>}
        </div>
      )}
      {i && sub === "pay" && <RecordDialog i={i} open onOpenChange={(o) => !o && setSub(null)} onDone={() => { refreshed(); toast.success("Payment recorded"); }} />}
      {i && sub === "line" && <LineDialog i={i} open onOpenChange={(o) => !o && setSub(null)} onDone={() => { refreshed(); toast.success("Invoice updated"); }} />}
      <ConfirmDialog open={sub === "void"} onOpenChange={(o) => !o && setSub(null)} title="Cancel this invoice?" description="Nothing will be due for this period, and it is not billed again." confirmLabel="Cancel invoice" destructive reason={{ label: "Reason", required: true }}
        onConfirm={async (reason) => { await unwrapData(api.POST("/owner/rent-invoices/{id}/void", { params: { path: { id } }, body: { reason } })); refreshed(); toast.success("Invoice cancelled"); }} />
      {sub && typeof sub === "object" && "refund" in sub && <RefundDialog payment={sub.refund} who="owner" open onOpenChange={(o) => !o && setSub(null)} onDone={() => { refreshed(); }} />}
      <ConfirmDialog open={typeof sub === "object" && sub !== null && "reverse" in sub} onOpenChange={(o) => !o && setSub(null)} title="Reverse this payment?" description="Use this only for a payment you recorded by mistake. The amount becomes owed again and the tenant is told." confirmLabel="Reverse" destructive reason={{ label: "Reason", required: true }}
        onConfirm={async (reason) => { await unwrapData(api.POST("/owner/rent-payments/{id}/reverse", { params: { path: { id: (sub as { reverse: string }).reverse } }, body: { reason } })); refreshed(); toast.success("Payment reversed"); }} />
    </ResponsiveDialog>
  );
}

function RecordDialog({ i, open, onOpenChange, onDone }: { i: Data<"/owner/rent-invoices/{id}">; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [amount, setAmount] = React.useState(String(i.balancePaise / 100));
  const [method, setMethod] = React.useState<Method>("UPI");
  const [reference, setReference] = React.useState("");
  const [receivedOn, setReceivedOn] = React.useState(localToday());
  const f = useSubmit(() => unwrapData(api.POST("/owner/rent-invoices/{id}/payments", { params: { path: { id: i.id } }, body: { amountPaise: rupees(amount), method, receivedOn, ...(reference ? { reference } : {}) } })), onDone);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Record payment" description={`${money(i.balancePaise, exact)} is still owed. Enter what you actually received.`}>
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <FormField label="Amount (₹)" htmlFor="rp-amt" error={f.fields.amountPaise} required><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} {...describe("rp-amt", f.fields.amountPaise)} /></FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Paid by" htmlFor="rp-m"><Select value={method} onValueChange={(v) => setMethod(v as Method)}><SelectTrigger id="rp-m"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UPI">UPI</SelectItem><SelectItem value="CASH">Cash</SelectItem><SelectItem value="BANK">Bank transfer</SelectItem></SelectContent></Select></FormField>
          <FormField label="Received on" htmlFor="rp-d" error={f.fields.receivedOn}><Input type="date" max={localToday()} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} {...describe("rp-d", f.fields.receivedOn)} /></FormField>
        </div>
        <FormField label="Reference" htmlFor="rp-ref" hint="Optional: UTR, receipt number…"><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} {...describe("rp-ref", undefined, true)} /></FormField>
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Record" />
      </form>
    </ResponsiveDialog>
  );
}

function LineDialog({ i, open, onOpenChange, onDone }: { i: Data<"/owner/rent-invoices/{id}">; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [type, setType] = React.useState<"ELECTRICITY" | "MAINTENANCE" | "ADJUSTMENT" | "CREDIT">("ELECTRICITY");
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const f = useSubmit(() => unwrapData(api.POST("/owner/rent-invoices/{id}/lines", { params: { path: { id: i.id } }, body: { type, description, amountPaise: rupees(amount) } })), onDone);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Add a charge or credit" description="Charges raise what the tenant owes. A credit lowers it. The tenant is told.">
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <FormField label="Type" htmlFor="ln-t"><Select value={type} onValueChange={(v) => setType(v as typeof type)}><SelectTrigger id="ln-t"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ELECTRICITY">Electricity</SelectItem><SelectItem value="MAINTENANCE">Maintenance</SelectItem><SelectItem value="ADJUSTMENT">Other charge</SelectItem><SelectItem value="CREDIT">Credit (discount)</SelectItem></SelectContent></Select></FormField>
        <FormField label="Description" htmlFor="ln-d" error={f.fields.description} required><Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={120} placeholder="e.g. Electricity for March" {...describe("ln-d", f.fields.description)} /></FormField>
        <FormField label="Amount (₹)" htmlFor="ln-a" error={f.fields.amountPaise} required><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} {...describe("ln-a", f.fields.amountPaise)} /></FormField>
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Add" />
      </form>
    </ResponsiveDialog>
  );
}
