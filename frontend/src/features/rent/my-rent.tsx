"use client";
import { DocButton, ReceiptButton, RefundNotes, payMethodLabel } from "./payment-actions";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Receipt } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrapData } from "@/lib/api/client";
import { fmtDate, money } from "@/lib/format";
import { RentPaySheet, type RentInvoice } from "./rent-pay-sheet";

/** The tenant's rent: what is owed, what was paid, and a way to pay. Hidden until they have been billed. */
export function MyRent() {
  const q = useQuery({ queryKey: ["me", "rent", "invoices"], queryFn: () => unwrapData(api.GET("/me/rent-invoices", { params: { query: { limit: 24 } } })) });
  const [paying, setPaying] = React.useState<RentInvoice | null>(null);
  if (q.isPending) return <Skeleton className="h-28 rounded-2xl" />;
  if (q.isError || q.data.length === 0) return null;
  const owed = q.data.filter((i) => i.status === "DUE" || i.status === "PARTIALLY_PAID");
  const total = owed.reduce((n, i) => n + i.balancePaise, 0);
  return (
    <section aria-label="Rent" className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Rent</h2>{total > 0 && <p className="tnum text-sm text-muted-foreground">Total due <b className="text-foreground">{money(total, { exact: true })}</b></p>}</div>
      {owed.some((i) => i.overdue.isOverdue) && <Alert tone="warning">You have overdue rent. Pay it soon to avoid late fees.</Alert>}
      <ul className="grid gap-3">{q.data.map((i) => <InvoiceCard key={i.id} i={i} onPay={() => setPaying(i)} />)}</ul>
      {paying && <RentPaySheet invoice={paying} open onOpenChange={(o) => !o && setPaying(null)} />}
    </section>
  );
}

function InvoiceCard({ i, onPay }: { i: RentInvoice; onPay: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <li className="grid gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{fmtDate(i.periodStart)} to {fmtDate(i.periodEnd)}</span><StatusBadge status={i.status} />{i.overdue.isOverdue && <Badge tone="danger">{i.overdue.days}d overdue</Badge>}</p>
          <p className="font-mono text-xs text-muted-foreground">{i.number} · due {fmtDate(i.dueDate)}</p>
        </div>
        <div className="text-right"><p className="tnum text-lg font-semibold">{money(i.totalPaise, { exact: true })}</p>{i.status !== "PAID" && i.status !== "VOID" && i.paidPaise > 0 && <p className="tnum text-xs text-muted-foreground">{money(i.balancePaise, { exact: true })} left</p>}</div>
      </div>
      {i.actions.includes("pay") && <div><Button size="sm" onClick={onPay}>Pay {money(i.balancePaise, { exact: true })}</Button></div>}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><Receipt className="size-4" />Details and receipts<ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} /></button>
      {open && (
        <div className="grid gap-3 border-t pt-3 text-sm">
          <ul className="grid gap-1">{i.lines.map((l) => <li key={l.id} className="flex justify-between gap-3"><span className="min-w-0 [overflow-wrap:anywhere]">{l.description}</span><span className="tnum shrink-0">{money(l.amountPaise, { exact: true })}</span></li>)}
            {i.taxPaise > 0 && <li className="flex justify-between gap-3"><span>GST ({i.gstRateBps / 100}%)</span><span className="tnum">{money(i.taxPaise, { exact: true })}</span></li>}</ul>
          {i.payments.length > 0 && <ul className="grid gap-1 border-t pt-2">{i.payments.map((p) => <li key={p.id} className={`flex justify-between gap-3 ${p.reversed ? "text-muted-foreground line-through" : ""}`}><span>{fmtDate(p.receivedOn)} · {payMethodLabel(p.method)} · <span className="font-mono text-xs">{p.receiptNo}</span>{p.reversed ? " (reversed)" : ""}</span><span className="tnum shrink-0">{money(p.amountPaise, { exact: true })}</span></li>)}</ul>}
          <div><DocButton kind="invoice" id={i.id} who="me" /></div>
          {i.payments.filter((p) => !p.reversed).length > 0 && <ul className="grid gap-0.5 border-t pt-2">{i.payments.filter((p) => !p.reversed).map((p) => <li key={`r-${p.id}`} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0"><span className="font-mono text-xs">{p.receiptNo}</span><RefundNotes p={p} /></span><ReceiptButton paymentId={p.id} who="me" /></li>)}</ul>}
        </div>
      )}
    </li>
  );
}
