"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Clock, CreditCard, Landmark, Smartphone, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { money } from "@/lib/format";
import type { Data, Item } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export type RentInvoice = Item<"/me/rent-invoices">;
type Order = Data<"/me/rent-invoices/{id}/payments", "post", 201>;
type Instrument = NonNullable<Order["checkout"]>["instruments"][number];
type Phase = "choose" | "processing" | "confirmed" | "failed" | "waiting";
const METHODS = [["UPI", "UPI", Smartphone], ["CARD", "Card", CreditCard], ["NETBANKING", "Net banking", Landmark], ["WALLET", "Wallet", Wallet]] as const;
const OUTCOMES: Record<string, { title: string; hint: string }> = {
  DEMO_SUCCESS: { title: "Pay successfully", hint: "The bank approves right away." },
  DEMO_PENDING: { title: "Takes a moment", hint: "Like UPI: confirmation arrives a few seconds later." },
  DEMO_FAIL: { title: "Payment fails", hint: "See what happens when the bank declines." },
  DEMO_TIMEOUT: { title: "Never completes", hint: "Nothing comes back from the bank." },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pays an invoice's balance with the demo gateway. Like a real gateway the "bank" reports back asynchronously, and the invoice
 * only becomes PAID when the server says so: this sheet never decides that a payment succeeded.
 */
/** What is being paid: a rent invoice's balance, or the security deposit of a stay (the same gateway and order endpoints serve both). */
interface Subject { key: string; ref: string; title: string; amountPaise: number; doneTitle: string; doneNote: string; start: () => Promise<Order> }
const forInvoice = (i: RentInvoice): Subject => ({ key: i.id, ref: i.number, title: `Pay ${i.number}`, amountPaise: i.balancePaise, doneTitle: "Rent paid", doneNote: `We've emailed your receipt for ${i.number}.`, start: () => unwrapData(api.POST("/me/rent-invoices/{id}/payments", { params: { path: { id: i.id } } })) });
const forDeposit = (d: { tenancyId: string; amountPaise: number; code: string }): Subject => ({ key: d.tenancyId, ref: d.code, title: "Pay the security deposit", amountPaise: d.amountPaise, doneTitle: "Deposit paid", doneNote: `Your deposit for stay ${d.code} is held safely until you move out.`, start: () => unwrapData(api.POST("/me/tenancies/{id}/deposit/payments", { params: { path: { id: d.tenancyId } } })) });

export function RentPaySheet({ invoice, deposit, open, onOpenChange }: { invoice?: RentInvoice; deposit?: { tenancyId: string; amountPaise: number; code: string }; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [phase, setPhase] = React.useState<Phase>("choose");
  const subject = React.useMemo(() => (invoice ? forInvoice(invoice) : forDeposit(deposit!)), [invoice, deposit]);
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) { setPhase("choose"); qc.invalidateQueries({ queryKey: ["me", "rent"] }); qc.invalidateQueries({ queryKey: ["me", "tenancy"] }); }
  };
  return (
    <ResponsiveDialog open={open} onOpenChange={close} title={phase === "confirmed" ? "Payment received" : subject.title} dismissible={phase !== "processing"} className="sm:max-w-md">
      <Body subject={subject} phase={phase} setPhase={setPhase} close={close} />
    </ResponsiveDialog>
  );
}

function Body({ subject, phase, setPhase, close }: { subject: Subject; phase: Phase; setPhase: (p: Phase) => void; close: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [instrument, setInstrument] = React.useState<Instrument>("DEMO_SUCCESS");
  const [method, setMethod] = React.useState<(typeof METHODS)[number][0]>("UPI");
  const [error, setError] = React.useState<string | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Asking again with a new `nonce` creates a fresh order (a failed order is final); otherwise the open order is resumed.
  const [nonce, setNonce] = React.useState(0);
  const order = useQuery({
    queryKey: ["me", "rent", "order", subject.key, nonce], staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false,
    queryFn: () => subject.start(),
  });
  const o: Order | null = order.data ?? null;
  const shownError = error ?? (order.isError ? errorMessage(order.error) : null);

  async function pay() {
    if (!o) return;
    setPhase("processing"); setError(null);
    try {
      await unwrapData(api.POST("/me/rent-orders/{id}/demo-checkout", { params: { path: { id: o.id } }, body: { instrument, method } }));
      const deadline = Date.now() + 40_000;
      while (alive.current && Date.now() < deadline) {
        await sleep(1100);
        const s = await unwrapData(api.GET("/me/rent-orders/{id}", { params: { path: { id: o.id } } }));
        if (s.status === "CAPTURED") { qc.invalidateQueries({ queryKey: ["me", "rent"] }); qc.invalidateQueries({ queryKey: ["me", "tenancy"] }); setPhase("confirmed"); toast.success(subject.doneTitle); return; }
        if (s.status === "FAILED") { setError(s.failureReason ?? "The bank declined this payment."); setPhase("failed"); setNonce((n) => n + 1); return; }
      }
      if (alive.current) setPhase("waiting");
    } catch (e) { setError(errorMessage(e)); setPhase("failed"); setNonce((n) => n + 1); }
  }

  const instruments = o?.checkout?.instruments ?? [];
  return (
    <div className="grid gap-5" aria-live="polite">
      {phase === "confirmed" ? (
        <div className="grid justify-items-center gap-3 py-4 text-center">
          <CheckCircle2 className="size-14 text-success motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300" />
          <p className="text-lg font-semibold">{subject.doneTitle}</p>
          <p className="text-sm text-muted-foreground">{subject.doneNote}</p>
          <Button className="mt-2 w-full" onClick={() => close(false)}>Done</Button>
        </div>
      ) : phase === "processing" ? (
        <div className="grid justify-items-center gap-3 py-8 text-center">
          <span className="size-10 animate-spin rounded-full border-[3px] border-muted border-t-primary" aria-hidden />
          <p className="font-medium">Confirming with the bank…</p>
          <p className="text-sm text-muted-foreground">Please don&apos;t close this window.</p>
        </div>
      ) : phase === "waiting" ? (
        <div className="grid justify-items-center gap-3 py-6 text-center">
          <Clock className="size-10 text-warning" />
          <p className="font-medium">Still waiting for the bank</p>
          <p className="text-sm text-muted-foreground">You haven&apos;t been charged twice. Your invoice updates when the payment arrives.</p>
          <div className="mt-2 flex w-full gap-2"><Button variant="outline" className="flex-1" onClick={() => close(false)}>Close</Button></div>
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3 rounded-xl bg-muted p-4"><span className="text-sm text-muted-foreground">Amount to pay</span><span className="tnum text-2xl font-semibold">{money(subject.amountPaise, { exact: true })}</span></div>
          <Alert tone="info" title="Demo payment">No real money moves. Pick how the &ldquo;bank&rdquo; should respond so you can see every outcome.</Alert>
          {shownError && <Alert tone="danger" title={phase === "failed" ? "Payment didn't go through" : undefined}>{shownError}</Alert>}
          <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-semibold">Pay with</legend>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map(([v, label, Icon]) => <button key={v} type="button" role="radio" aria-checked={method === v} onClick={() => setMethod(v)} className={cn("pressable flex min-h-12 items-center gap-2 rounded-xl border px-3 text-sm font-medium", method === v ? "border-primary bg-accent" : "hover:bg-muted")}><Icon className="size-4" />{label}</button>)}
            </div>
          </fieldset>
          <fieldset className="grid gap-2"><legend className="mb-1 flex items-center gap-2 text-sm font-semibold">Simulate <Badge tone="outline">demo</Badge></legend>
            <RadioGroup value={instrument} onValueChange={(v) => setInstrument(v as Instrument)}>
              {(instruments.length ? instruments : (["DEMO_SUCCESS", "DEMO_PENDING", "DEMO_FAIL", "DEMO_TIMEOUT"] as Instrument[])).map((i) => (
                <Label key={i} htmlFor={`rent-inst-${i}`} className={cn("flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors", instrument === i ? "border-primary bg-accent" : "hover:bg-muted")}>
                  <RadioGroupItem id={`rent-inst-${i}`} value={i} className="mt-0.5" /><span><span className="block text-sm font-medium">{OUTCOMES[i]?.title ?? i}</span><span className="block text-xs font-normal text-muted-foreground">{OUTCOMES[i]?.hint}</span></span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
          <Button size="lg" onClick={pay} disabled={!o} loading={order.isFetching}>Pay {money(subject.amountPaise, { exact: true })}</Button>
        </>
      )}
      {phase === "choose" && !o && !order.isFetching && shownError && <p className="flex items-center gap-2 text-sm text-destructive"><CircleAlert className="size-4" />{shownError}</p>}
    </div>
  );
}
