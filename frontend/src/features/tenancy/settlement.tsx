"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/error-state";
import { FileDrop } from "@/components/common/file-drop";
import { FormField } from "@/components/common/form-field";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { fmtDateTime, money, titleCase } from "@/lib/format";
import { uploadToCloudinary } from "@/lib/upload";
import type { Data } from "@/lib/api/types";
import { Actions, useSubmit } from "@/features/owner/form-utils";

export type Settlement = Data<"/owner/tenancies/{id}/settlement">;
type Line = { key: string; type: Settlement["deductions"][number]["type"]; description: string; amount: string; invoiceId: string };
const exact = { exact: true } as const;
const TYPES = [["DAMAGE", "Damage"], ["CLEANING", "Cleaning"], ["UTILITIES", "Utilities"], ["OTHER", "Other"], ["UNPAID_RENT", "Unpaid rent"]] as const;
const paise = (s: string) => Math.round(Number(s) * 100);
const newKey = () => Math.random().toString(36).slice(2);
const toLines = (s: Settlement): Line[] => s.deductions.map((d) => ({ key: d.id, type: d.type, description: d.description, amount: String(d.amountPaise / 100), invoiceId: d.invoiceId ?? "" }));
const toInput = (lines: Line[]) => lines.map((l) => ({ type: l.type, description: l.description.trim(), amountPaise: paise(l.amount), ...(l.type === "UNPAID_RENT" && l.invoiceId ? { invoiceId: l.invoiceId } : {}) }));

const STATUS_NOTE: Record<Settlement["status"], string> = {
  DRAFT: "The owner is still working on it.", PROPOSED: "Waiting for the tenant to accept or dispute it.", DISPUTED: "The tenant disputed it.",
  AGREED: "Agreed. The refund is being paid.", COMPLETED: "Settled.",
};

/** What is deducted and what comes back, for anyone looking at a settlement. */
export function SettlementSummary({ s }: { s: Settlement }) {
  return (
    <div className="grid gap-4 text-sm">
      <p className="flex flex-wrap items-center gap-2"><StatusBadge status={s.status === "AGREED" ? "APPLICATION_APPROVED" : s.status === "PROPOSED" ? "REQUESTED" : s.status} /><span className="text-muted-foreground">{STATUS_NOTE[s.status]}</span></p>
      <ul className="grid gap-1 rounded-xl bg-muted/50 p-3" aria-label="Deposit settlement">
        <li className="flex justify-between gap-3"><span>Deposit held</span><span className="tnum">{money(s.depositPaise, exact)}</span></li>
        {s.deductions.map((d) => <li key={d.id} className="flex justify-between gap-3 text-muted-foreground"><span className="min-w-0 [overflow-wrap:anywhere]">− {d.description} <span className="text-xs">({titleCase(d.type)})</span></span><span className="tnum shrink-0">{money(d.amountPaise, exact)}</span></li>)}
        <li className="mt-1 flex justify-between gap-3 border-t pt-2 font-semibold"><span>Comes back to the tenant</span><span className="tnum">{money(s.refundPaise, exact)}</span></li>
      </ul>
      {s.note && <p className="[overflow-wrap:anywhere]"><span className="text-muted-foreground">Owner&apos;s note: </span>{s.note}</p>}
      {s.disputeNote && <Alert tone="warning" title="The tenant says">{s.disputeNote}</Alert>}
      {s.proofs.length > 0 && <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Photos">{s.proofs.map((p, i) => <li key={p.id}><a href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">{ }<img src={p.url} alt={`Evidence photo ${i + 1}`} loading="lazy" className="aspect-square size-full object-cover" /></a></li>)}</ul>}
      {s.status === "PROPOSED" && s.respondBy && <p className="text-muted-foreground">The tenant can respond until {fmtDateTime(s.respondBy, true)}. Silence counts as acceptance.</p>}
      {s.autoAgreed && <p className="text-muted-foreground">Accepted automatically: no answer within 7 days.</p>}
      {s.status === "COMPLETED" && <p className="font-medium">{s.refundPaise === 0 ? "Nothing was due back." : s.payout.online ? `${money(s.refundPaise, exact)} was refunded to the original payment method.` : `${money(s.refundPaise)} was returned by ${s.payout.method ? titleCase(s.payout.method) : "the owner"}${s.payout.reference ? ` (${s.payout.reference})` : ""}.`}</p>}
    </div>
  );
}

/** Rows of deductions with a running total. Unpaid rent is picked from the stay's open invoices. */
function DeductionsEditor({ lines, setLines, s }: { lines: Line[]; setLines: (l: Line[]) => void; s: Settlement }) {
  const total = lines.reduce((n, l) => n + (Number.isFinite(paise(l.amount)) ? paise(l.amount) : 0), 0);
  const set = (key: string, p: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const over = total > s.depositPaise;
  return (
    <div className="grid gap-3">
      <ul className="grid gap-3">{lines.map((l, i) => (
        <li key={l.key} className="grid gap-2 rounded-xl border p-3">
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr_8rem_auto]">
            <Select value={l.type} onValueChange={(v) => set(l.key, { type: v as Line["type"], invoiceId: "" })}><SelectTrigger aria-label={`Type of deduction ${i + 1}`}><SelectValue /></SelectTrigger><SelectContent>{TYPES.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent></Select>
            <Input aria-label={`What deduction ${i + 1} is for`} placeholder="What it is for" value={l.description} maxLength={200} onChange={(e) => set(l.key, { description: e.target.value })} />
            <Input aria-label={`Amount of deduction ${i + 1} in rupees`} inputMode="decimal" placeholder="₹" value={l.amount} onChange={(e) => set(l.key, { amount: e.target.value })} />
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove deduction ${i + 1}`} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 /></Button>
          </div>
          {l.type === "UNPAID_RENT" && (
            <Select value={l.invoiceId} onValueChange={(v) => { const inv = s.openInvoices.find((x) => x.id === v); set(l.key, { invoiceId: v, ...(inv && !l.amount ? { amount: String(inv.balancePaise / 100) } : {}), ...(inv && !l.description ? { description: `Unpaid rent, invoice ${inv.number}` } : {}) }); }}>
              <SelectTrigger aria-label={`Invoice for deduction ${i + 1}`}><SelectValue placeholder="Which invoice is this rent from?" /></SelectTrigger>
              <SelectContent>{s.openInvoices.map((x) => <SelectItem key={x.id} value={x.id}>{x.number} · {money(x.balancePaise, exact)} owed</SelectItem>)}</SelectContent>
            </Select>
          )}
        </li>))}</ul>
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setLines([...lines, { key: newKey(), type: "DAMAGE", description: "", amount: "", invoiceId: "" }])}><Plus />Add a deduction</Button>
      <p className={`tnum flex flex-wrap justify-between gap-2 rounded-xl p-3 text-sm ${over ? "bg-destructive/10 text-destructive" : "bg-muted/50"}`} role={over ? "alert" : undefined}>
        <span>Deductions {money(total, exact)} of {money(s.depositPaise, exact)} held</span><span className="font-semibold">{over ? "More than the deposit" : `Back to tenant ${money(s.depositPaise - total, exact)}`}</span>
      </p>
    </div>
  );
}

/** The owner's working screen for a stay's deposit: itemise, add evidence, send; then record the refund once it is agreed. */
export function OwnerSettlementDialog({ tenancyId, tenant, open, onOpenChange, onChanged }: { tenancyId: string; tenant: string; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const key = ["owner", "settlement", tenancyId];
  const q = useQuery({ queryKey: key, queryFn: () => unwrapData(api.GET("/owner/tenancies/{id}/settlement", { params: { path: { id: tenancyId } } })) });
  const s = q.data;
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); onChanged(); };
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Deposit settlement" description={`${tenant}: what is deducted from the deposit, and what goes back.`} className="sm:max-w-2xl">
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !s ? <Skeleton className="h-64" /> : <OwnerBody key={`${s.id}-${s.version}`} s={s} tenancyId={tenancyId} refresh={refresh} close={() => onOpenChange(false)} />}
    </ResponsiveDialog>
  );
}

function OwnerBody({ s, tenancyId, refresh, close }: { s: Settlement; tenancyId: string; refresh: () => void; close: () => void }) {
  const editable = s.actions.includes("edit");
  const [lines, setLines] = React.useState<Line[]>(() => toLines(s));
  const [note, setNote] = React.useState(s.note ?? "");
  const [busyPhoto, setBusyPhoto] = React.useState(false);
  const [retract, setRetract] = React.useState(false);
  const [method, setMethod] = React.useState<"CASH" | "UPI" | "BANK">("UPI");
  const [reference, setReference] = React.useState("");

  const bad = lines.find((l) => l.description.trim().length < 3 || !(paise(l.amount) > 0) || (l.type === "UNPAID_RENT" && !l.invoiceId));
  const save = async () => unwrapData(api.PUT("/owner/tenancies/{id}/settlement", { params: { path: { id: tenancyId } }, body: { deductions: toInput(lines), note: note.trim() || undefined } }));
  const draft = useSubmit(async () => { if (bad) throw new Error("Fill in what each deduction is for, its amount, and the invoice for unpaid rent"); await save(); }, () => { toast.success("Saved"); refresh(); });
  const send = useSubmit(async () => { if (bad) throw new Error("Fill in what each deduction is for, its amount, and the invoice for unpaid rent"); await save(); await unwrapData(api.POST("/owner/tenancies/{id}/settlement/propose", { params: { path: { id: tenancyId } } })); }, () => { toast.success("Sent to the tenant"); refresh(); });
  const payout = useSubmit(() => unwrapData(api.POST("/owner/tenancies/{id}/settlement/payout", { params: { path: { id: tenancyId } }, body: { method, ...(reference.trim() ? { reference: reference.trim() } : {}) } })), () => { toast.success("Refund recorded. The deposit is settled."); refresh(); });

  async function onFiles(files: File[]) {
    setBusyPhoto(true);
    try {
      for (const file of files.slice(0, 10 - s.proofs.length)) {
        try { const { publicId } = await uploadToCloudinary(file, "DEPOSIT_PROOF", { tenancyId }); await unwrapData(api.POST("/owner/tenancies/{id}/settlement/proofs", { params: { path: { id: tenancyId } }, body: { publicId } })); }
        catch (e) { toast.error(`${file.name}: ${errorMessage(e)}`); }
      }
    } finally { setBusyPhoto(false); refresh(); }
  }

  return (
    <div className="grid max-h-[70dvh] gap-5 overflow-y-auto overscroll-contain p-0.5">
      {editable ? (
        <>
          {s.status === "DISPUTED" && <Alert tone="warning" title="The tenant disputed this">{s.disputeNote}. Change what is needed and send it again, or ask support to decide.</Alert>}
          <DeductionsEditor lines={lines} setLines={setLines} s={s} />
          <FormField label="Note to the tenant" htmlFor="st-note" hint="Optional. Say how you counted."><Textarea id="st-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} /></FormField>
          <section aria-label="Evidence photos" className="grid gap-2">
            <p className="text-sm font-medium">Evidence photos <span className="font-normal text-muted-foreground">(optional, up to 10)</span></p>
            {s.proofs.length > 0 && <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">{s.proofs.map((p, i) => (
              <li key={p.id} className="relative overflow-hidden rounded-xl border">{ }<img src={p.url} alt={`Evidence photo ${i + 1}`} className="aspect-square size-full object-cover" />
                <Button type="button" size="icon-sm" variant="secondary" className="absolute top-1 right-1" aria-label={`Remove photo ${i + 1}`} onClick={async () => { try { await unwrapData(api.DELETE("/owner/tenancies/{id}/settlement/proofs/{proofId}", { params: { path: { id: tenancyId, proofId: p.id } } })); refresh(); } catch (e) { toast.error(errorMessage(e)); } }}><Trash2 /></Button></li>))}</ul>}
            {s.proofs.length < 10 && <FileDrop accept="image/jpeg,image/png,image/webp" multiple disabled={busyPhoto} onFiles={onFiles} label={busyPhoto ? "Uploading…" : "Add photos"} hint="JPG, PNG or WebP" className="py-4" />}
            {s.proofs.length === 0 && <p className="flex items-center gap-2 text-xs text-muted-foreground"><ImageIcon className="size-3.5" aria-hidden />Photos of damage make a dispute much less likely.</p>}
          </section>
          {(draft.error || send.error) && <Alert tone="danger">{draft.error ?? send.error}</Alert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={close}>Close</Button>
            <Button type="button" variant="outline" loading={draft.busy} onClick={draft.submit}>Save draft</Button>
            <Button type="button" loading={send.busy} onClick={send.submit}>Send to the tenant</Button>
          </div>
        </>
      ) : (
        <>
          <SettlementSummary s={s} />
          {s.actions.includes("retract") && <Button variant="outline" className="w-fit" onClick={() => setRetract(true)}>Take it back to edit</Button>}
          {s.actions.includes("record_payout") && (
            <form onSubmit={payout.submit} className="grid gap-3 rounded-xl border p-3" noValidate>
              <p className="font-medium">Record the refund you paid</p>
              <p className="text-sm text-muted-foreground">The tenant paid the deposit in cash, UPI or by bank, so you pay {money(s.refundPaise, exact)} back yourself. Tell us how.</p>
              {payout.error && <Alert tone="danger">{payout.error}</Alert>}
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Paid by" htmlFor="po-m"><Select value={method} onValueChange={(v) => setMethod(v as typeof method)}><SelectTrigger id="po-m"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UPI">UPI</SelectItem><SelectItem value="CASH">Cash</SelectItem><SelectItem value="BANK">Bank transfer</SelectItem></SelectContent></Select></FormField>
                <FormField label="Reference" htmlFor="po-r" hint="Optional: UTR, receipt…"><Input id="po-r" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} /></FormField>
              </div>
              <Actions busy={payout.busy} onCancel={close} label="Record refund" />
            </form>
          )}
        </>
      )}
      <ConfirmDialog open={retract} onOpenChange={setRetract} title="Take this back?" description="The tenant no longer sees it, and you can change it and send it again." confirmLabel="Take it back"
        onConfirm={async () => { await unwrapData(api.POST("/owner/tenancies/{id}/settlement/retract", { params: { path: { id: tenancyId } } })); refresh(); toast.success("Taken back"); }} />
    </div>
  );
}

/** The tenant's side: read it, then accept or dispute. */
export function TenantSettlement({ tenancyId }: { tenancyId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["me", "tenancy", "settlement", tenancyId], queryFn: () => unwrapData(api.GET("/me/tenancies/{id}/settlement", { params: { path: { id: tenancyId } } })) });
  const [dispute, setDispute] = React.useState(false);
  const sync = () => { qc.invalidateQueries({ queryKey: ["me", "tenancy"] }); };
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-40 rounded-2xl" />;
  const s = q.data;
  return (
    <section aria-label="Deposit settlement" className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-5">
      <h3 className="text-base font-semibold">Your deposit</h3>
      <SettlementSummary s={s} />
      {s.actions.includes("accept") && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button onClick={async () => { try { await unwrapData(api.POST("/me/tenancies/{id}/settlement/accept", { params: { path: { id: tenancyId } } })); sync(); toast.success("Accepted"); } catch (e) { toast.error(errorMessage(e)); } }}>Accept</Button>
          <Button variant="outline" onClick={() => setDispute(true)}>Dispute</Button>
        </div>
      )}
      <ConfirmDialog open={dispute} onOpenChange={setDispute} title="Dispute this settlement?" description="Tell the owner what is wrong. They can change it and send it again, or ask support to decide." confirmLabel="Send dispute" reason={{ label: "What is wrong?", required: true, max: 1000 }}
        onConfirm={async (note) => { await unwrapData(api.POST("/me/tenancies/{id}/settlement/dispute", { params: { path: { id: tenancyId } }, body: { note } })); sync(); toast.success("The owner has been told"); }} />
    </section>
  );
}

/** Support decides a disputed settlement: the lines they enter are final. */
export function AdminResolveDialog({ tenancyId, tenant, open, onOpenChange, onDone }: { tenancyId: string; tenant: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const q = useQuery({ queryKey: ["admin", "settlement", tenancyId], queryFn: () => unwrapData(api.GET("/admin/tenancies/{id}/settlement", { params: { path: { id: tenancyId } } })) });
  const s = q.data;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Deposit settlement" description={tenant} className="sm:max-w-2xl">
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !s ? <Skeleton className="h-48" /> : <AdminBody s={s} tenancyId={tenancyId} done={onDone} close={() => onOpenChange(false)} />}
    </ResponsiveDialog>
  );
}

function AdminBody({ s, tenancyId, done, close }: { s: Settlement; tenancyId: string; done: () => void; close: () => void }) {
  const [lines, setLines] = React.useState<Line[]>(() => toLines(s));
  const [note, setNote] = React.useState("");
  const f = useSubmit(async () => {
    if (note.trim().length < 5) throw new Error("Explain your decision (at least a few words)");
    return unwrapData(api.POST("/admin/tenancies/{id}/settlement/resolve", { params: { path: { id: tenancyId } }, body: { deductions: toInput(lines), note: note.trim() } }));
  }, () => { toast.success("Decided. The refund is being paid."); done(); close(); });
  if (!s.actions.includes("resolve")) return <div className="grid gap-4"><SettlementSummary s={s} /><Button variant="outline" onClick={close}>Close</Button></div>;
  const adminView = { ...s, openInvoices: s.openInvoices };
  return (
    <form onSubmit={f.submit} className="grid max-h-[70dvh] gap-4 overflow-y-auto p-0.5" noValidate>
      <SettlementSummary s={s} />
      <p className="font-medium">Your decision</p>
      <DeductionsEditor lines={lines} setLines={setLines} s={adminView} />
      <FormField label="Why" htmlFor="ar-note" required><Textarea id="ar-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} /></FormField>
      {f.error && <Alert tone="danger">{f.error}</Alert>}
      <Actions busy={f.busy} onCancel={close} label="Decide" />
    </form>
  );
}
