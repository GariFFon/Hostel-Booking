"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Clock, Landmark, Smartphone, CreditCard, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { money } from "@/lib/format";
import type { BookingDetail, Data } from "@/lib/api/types";
import { cn } from "@/lib/utils";

type Payment = Data<"/bookings/{id}/payments", "post", 201>;
type Instrument = NonNullable<Payment["checkout"]>["instruments"][number];
type Phase = "choose" | "processing" | "confirmed" | "failed" | "waiting";
const METHODS = [["UPI", "UPI", Smartphone], ["CARD", "Card", CreditCard], ["NETBANKING", "Net banking", Landmark], ["WALLET", "Wallet", Wallet]] as const;
const OUTCOMES: Record<string, { title: string; hint: string }> = {
  DEMO_SUCCESS: { title: "Pay successfully", hint: "The bank approves right away." },
  DEMO_PENDING: { title: "Takes a moment", hint: "Like UPI: confirmation arrives a few seconds later." },
  DEMO_FAIL: { title: "Payment fails", hint: "See what happens when the bank declines." },
  DEMO_TIMEOUT: { title: "Never completes", hint: "Nothing comes back from the bank." },
};
const sentence = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The demo payment sheet. Mirrors a real gateway: we start an order, the "bank" reports back asynchronously by signed webhook,
 * and the booking only turns CONFIRMED when the server says so. The page never decides that a payment succeeded.
 */
export function PaymentSheet({ booking, open, onOpenChange }: { booking: BookingDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [phase, setPhase] = React.useState<Phase>("choose");
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) { setPhase("choose"); qc.invalidateQueries({ queryKey: ["booking", booking.id] }); qc.invalidateQueries({ queryKey: ["bookings"] }); }
  };
  return (
    <ResponsiveDialog open={open} onOpenChange={close} title={phase === "confirmed" ? "Payment received" : "Complete your payment"} dismissible={phase !== "processing"} className="sm:max-w-md">
      <Body booking={booking} phase={phase} setPhase={setPhase} close={close} />
    </ResponsiveDialog>
  );
}

/** Mounted only while the sheet is open, so every opening starts a fresh payment order. */
function Body({ booking, phase, setPhase, close }: { booking: BookingDetail; phase: Phase; setPhase: (p: Phase) => void; close: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [instrument, setInstrument] = React.useState<Instrument>("DEMO_SUCCESS");
  const [method, setMethod] = React.useState<(typeof METHODS)[number][0]>("UPI");
  const [error, setError] = React.useState<string | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // The payment order. Asking again with a new `nonce` creates a fresh one (a failed order is final); otherwise the open order is resumed.
  const [nonce, setNonce] = React.useState(0);
  const order = useQuery({
    queryKey: ["payment-order", booking.id, nonce], staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false,
    queryFn: async () => {
      try { return await unwrapData(api.POST("/bookings/{id}/payments", { params: { path: { id: booking.id } } })); }
      catch (e) { if (isApiError(e) && e.status === 409) qc.invalidateQueries({ queryKey: ["booking", booking.id] }); throw e; }
    },
  });
  const payment: Payment | null = order.data ?? null;
  const starting = order.isFetching;
  const shownError = error ?? (order.isError ? errorMessage(order.error) : null);

  async function pay() {
    if (!payment) return;
    setPhase("processing"); setError(null);
    try {
      await unwrapData(api.POST("/payments/{id}/demo-checkout", { params: { path: { id: payment.id } }, body: { instrument, method } }));
      // Confirmation comes from the server by webhook: poll the booking until it says so (or the payment fails).
      const deadline = Date.now() + 40_000;
      while (alive.current && Date.now() < deadline) {
        await sleep(1100);
        const b = await unwrapData(api.GET("/bookings/{id}", { params: { path: { id: booking.id } } }));
        if (b.status === "CONFIRMED") { qc.setQueryData(["booking", booking.id], b); qc.invalidateQueries({ queryKey: ["bookings"] }); setPhase("confirmed"); toast.success("Booking confirmed"); return; }
        if (b.payment?.status === "FAILED") { setError(b.payment.failureReason ?? "The bank declined this payment."); setPhase("failed"); setNonce((n) => n + 1); return; } // a failed order is final: get a fresh one ready for the retry
        if (b.status !== "PENDING_PAYMENT") { qc.setQueryData(["booking", booking.id], b); setPhase("waiting"); return; } // expired or cancelled meanwhile
      }
      if (alive.current) setPhase("waiting");
    } catch (e) { setError(errorMessage(e)); setPhase("failed"); setNonce((n) => n + 1); }
  }

  const instruments = payment?.checkout?.instruments ?? [];

  return (
    <>
      <div className="grid gap-5" aria-live="polite">
        {phase === "confirmed" ? (
          <div className="grid justify-items-center gap-3 py-4 text-center">
            <CheckCircle2 className="size-14 text-success motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300" />
            <p className="text-lg font-semibold">You&apos;re booked</p>
            <p className="text-sm text-muted-foreground">We&apos;ve emailed your confirmation. Booking <b className="font-mono">{booking.code}</b>.</p>
            <Button className="mt-2 w-full" onClick={() => close(false)}>View booking</Button>
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
            <p className="text-sm text-muted-foreground">You haven&apos;t been charged twice and your beds are still held. This page updates when the payment arrives; if nothing comes through, you can try again.</p>
            <div className="mt-2 flex w-full gap-2"><Button variant="outline" className="flex-1" onClick={() => close(false)}>Close</Button><Button className="flex-1" onClick={() => { setPhase("choose"); setError(null); setNonce((n) => n + 1); }}>Try again</Button></div>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3 rounded-xl bg-muted p-4"><span className="text-sm text-muted-foreground">Amount to pay</span><span className="tnum text-2xl font-semibold">{money(booking.pricing.totalPaise, { exact: true })}</span></div>
            <Alert tone="info" title="Demo payment">No real money moves. Pick how the &ldquo;bank&rdquo; should respond so you can see every outcome.</Alert>
            {phase === "failed" && shownError && <Alert tone="danger" title="Payment didn't go through">{sentence(shownError)} Your beds are still held. Choose an outcome and try again.</Alert>}
            {phase !== "failed" && shownError && <Alert tone="danger">{shownError}</Alert>}
            <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-semibold">Pay with</legend>
              <div className="grid grid-cols-2 gap-2">
                {METHODS.map(([v, label, Icon]) => <button key={v} type="button" role="radio" aria-checked={method === v} onClick={() => setMethod(v)} className={cn("pressable flex min-h-12 items-center gap-2 rounded-xl border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", method === v ? "border-primary bg-accent text-accent-foreground" : "bg-card hover:bg-muted")}><Icon className="size-4" />{label}</button>)}
              </div>
            </fieldset>
            <fieldset className="grid gap-2"><legend className="mb-1 flex items-center gap-2 text-sm font-semibold">Simulate <Badge tone="outline">demo</Badge></legend>
              <RadioGroup value={instrument} onValueChange={(v) => setInstrument(v as Instrument)}>
                {(instruments.length ? instruments : (["DEMO_SUCCESS", "DEMO_PENDING", "DEMO_FAIL", "DEMO_TIMEOUT"] as Instrument[])).map((i) => (
                  <Label key={i} htmlFor={`inst-${i}`} className={cn("flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors", instrument === i ? "border-primary bg-accent/60" : "hover:bg-muted")}>
                    <RadioGroupItem id={`inst-${i}`} value={i} className="mt-0.5" /><span><span className="block text-sm font-medium">{OUTCOMES[i]?.title ?? i}</span><span className="block text-xs font-normal text-muted-foreground">{OUTCOMES[i]?.hint}</span></span>
                  </Label>
                ))}
              </RadioGroup>
            </fieldset>
            <Button size="lg" onClick={pay} disabled={!payment} loading={starting}>Pay {money(booking.pricing.totalPaise, { exact: true })}</Button>
          </>
        )}
        {phase === "choose" && !payment && !starting && shownError && <p className="flex items-center gap-2 text-sm text-destructive"><CircleAlert className="size-4" />{shownError}</p>}
      </div>
    </>
  );
}
