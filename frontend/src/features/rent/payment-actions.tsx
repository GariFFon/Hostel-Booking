"use client";
import * as React from "react";
import { FileDown, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";
import { FormField, describe } from "@/components/common/form-field";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { money } from "@/lib/format";
import type { Data } from "@/lib/api/types";
import { Actions, useSubmit } from "@/features/owner/form-utils";

export type PaymentRow = Data<"/me/rent-invoices/{id}">["payments"][number];
export type Who = "me" | "owner" | "admin";
const exact = { exact: true } as const;
/** How a payment was made, in words. */
export const payMethodLabel = (m: string) => (m === "ONLINE" ? "Online" : m === "DEPOSIT" ? "From deposit" : m)


/**
 * Opens the PDF receipt. The server hands out a five-minute signed link; the tab is opened first (inside the click, so pop-up
 * blockers allow it) and pointed at the PDF once the link arrives.
 */
export function ReceiptButton({ paymentId, who, className }: { paymentId: string; who: Who; className?: string }) {
  const [busy, setBusy] = React.useState(false);
  async function open() {
    const tab = window.open("", "_blank");
    setBusy(true);
    try {
      const body = who === "me" ? await unwrapData(api.POST("/me/rent-payments/{id}/receipt-link", { params: { path: { id: paymentId } } }))
        : who === "owner" ? await unwrapData(api.POST("/owner/rent-payments/{id}/receipt-link", { params: { path: { id: paymentId } } }))
        : await unwrapData(api.POST("/admin/rent-payments/{id}/receipt-link", { params: { path: { id: paymentId } } }));
      if (tab) tab.location.href = body.url; else window.location.href = body.url;
    } catch (e) { tab?.close(); toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <Button type="button" size="sm" variant="ghost" className={className} loading={busy} onClick={open}><FileDown />Receipt (PDF)</Button>;
}

/** Opens a rent invoice, or a stay's security-deposit receipt, as a PDF (same signed-link flow as a payment receipt). */
export function DocButton({ kind, id, who, label, className }: { kind: "invoice" | "deposit"; id: string; who: Who; label?: string; className?: string }) {
  const [busy, setBusy] = React.useState(false);
  async function open() {
    const tab = window.open("", "_blank");
    setBusy(true);
    try {
      const path = { path: { id } };
      const body = kind === "invoice"
        ? who === "me" ? await unwrapData(api.POST("/me/rent-invoices/{id}/pdf-link", { params: path })) : who === "owner" ? await unwrapData(api.POST("/owner/rent-invoices/{id}/pdf-link", { params: path })) : await unwrapData(api.POST("/admin/rent-invoices/{id}/pdf-link", { params: path }))
        : who === "me" ? await unwrapData(api.POST("/me/tenancies/{id}/deposit-receipt-link", { params: path })) : who === "owner" ? await unwrapData(api.POST("/owner/tenancies/{id}/deposit-receipt-link", { params: path })) : await unwrapData(api.POST("/admin/tenancies/{id}/deposit-receipt-link", { params: path }));
      if (tab) tab.location.href = body.url; else window.location.href = body.url;
    } catch (e) { tab?.close(); toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <Button type="button" size="sm" variant="ghost" className={className} loading={busy} onClick={open}><FileDown />{label ?? (kind === "invoice" ? "Invoice (PDF)" : "Deposit receipt (PDF)")}</Button>;
}

/** Pays part or all of an online payment back to the tenant. */
export function RefundDialog({ payment, who, open, onOpenChange, onDone }: { payment: PaymentRow; who: "owner" | "admin"; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [amount, setAmount] = React.useState(String(payment.refundablePaise / 100));
  const [reason, setReason] = React.useState("");
  const paise = Math.round(Number(amount) * 100);
  const f = useSubmit(() => {
    const body = { amountPaise: paise, reason: reason.trim() };
    return who === "owner" ? unwrapData(api.POST("/owner/rent-payments/{id}/refund", { params: { path: { id: payment.id } }, body })) : unwrapData(api.POST("/admin/rent-payments/{id}/refund", { params: { path: { id: payment.id } }, body }));
  }, () => { toast.success("Refund started"); onDone(); });
  const over = Number.isFinite(paise) && paise > payment.refundablePaise;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Refund this payment" description={`${payment.receiptNo} · paid ${money(payment.amountPaise, exact)} online. Up to ${money(payment.refundablePaise, exact)} can still be returned to the tenant's original payment method.`}>
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <Alert tone="info">The invoice will owe this money again. If you refund all of it, you can cancel the invoice afterwards.</Alert>
        <FormField label="Amount (₹)" htmlFor="rf-amt" error={f.fields.amountPaise ?? (over ? `At most ${money(payment.refundablePaise, exact)}` : undefined)} required><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} {...describe("rf-amt", f.fields.amountPaise)} /></FormField>
        <FormField label="Reason" htmlFor="rf-why" error={f.fields.reason} hint="The tenant is told why." required><Textarea id="rf-why" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} /></FormField>
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Refund" />
      </form>
    </ResponsiveDialog>
  );
}

/** What has been returned on a payment, in words. */
export function RefundNotes({ p }: { p: PaymentRow }) {
  if (p.refunds.length === 0) return null;
  return (
    <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
      {p.refunds.map((r) => <li key={r.id}><Undo2 className="mr-1 inline size-3" aria-hidden />{r.status === "PROCESSED" ? "Refunded" : r.status === "PENDING" ? "Refund on its way" : "Refund failed"} {money(r.amountPaise, exact)}: {r.reason}</li>)}
    </ul>
  );
}
