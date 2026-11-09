"use client";
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck, MapPin, Phone, ReceiptIndianRupee, Star } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/error-state";
import { StatusBadge } from "@/components/common/status-badge";
import { ReviewDialog } from "@/features/account/review-dialog";
import { PaymentSheet } from "@/features/account/payment-sheet";
import { useNow } from "@/hooks/use-now";
import { useUser } from "@/lib/session/use-session";
import { api, newIdempotencyKey, unwrapData } from "@/lib/api/client";
import { bps, countdown, fmtDate, fmtDateTime, fmtRange, money, plural } from "@/lib/format";

const REVEAL = ["CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW"];

export function BookingDetailView() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const now = useNow();
  const [payOpen, setPayOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reviewOpen, setReviewOpen] = React.useState(false);

  const q = useQuery({
    queryKey: ["booking", id], staleTime: 5_000, retry: (n, e) => (n < 1 && (e as { status?: number }).status !== 404),
    queryFn: () => unwrapData(api.GET("/bookings/{id}", { params: { path: { id } } })),
    // While money is in flight the page keeps itself fresh.
    refetchInterval: (query) => (query.state.data?.status === "PENDING_PAYMENT" || query.state.data?.status === "PENDING_APPROVAL" ? 15_000 : false),
  });
  const b = q.data;
  const autoPay = React.useRef(false);
  React.useEffect(() => { if (b && sp.get("pay") === "1" && b.actions.includes("pay") && !autoPay.current) { autoPay.current = true; setPayOpen(true); } }, [b, sp]);

  const preview = useQuery({ queryKey: ["cancel-preview", id], enabled: cancelOpen, staleTime: 0, queryFn: () => unwrapData(api.GET("/bookings/{id}/cancellation-preview", { params: { path: { id } } })) });
  const cancel = useMutation({
    mutationFn: (reason: string) => unwrapData(api.POST("/bookings/{id}/cancel", { params: { path: { id } }, body: reason ? { reason } : {}, headers: { "Idempotency-Key": newIdempotencyKey() } })),
    onSuccess: (nb) => { qc.setQueryData(["booking", id], nb); qc.invalidateQueries({ queryKey: ["bookings"] }); toast.success("Booking cancelled"); },
  });

  const { hasRole } = useUser();
  const notMine = q.isError && (q.error as { status?: number }).status === 404 && hasRole("OWNER");
  React.useEffect(() => { if (notMine) router.replace(`/owner/bookings/${id}`); }, [notMine, router, id]); // a host tapped a notification about a booking at their property
  if (notMine) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!b) return <div className="grid gap-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;

  const left = b.holdExpiresAt && now ? countdown(b.holdExpiresAt, now) : null;
  const can = (a: string) => (b.actions as string[]).includes(a);
  return (
    <div className="grid gap-6">
      <div><Link href="/account/bookings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All trips</Link></div>

      <div className="flex gap-4">
        <div className="size-20 shrink-0 overflow-hidden rounded-2xl bg-muted sm:size-28">{b.hostel.coverUrl &&   <img src={b.hostel.coverUrl} alt="" className="size-full object-cover" />}</div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={b.status} /><span className="font-mono text-xs text-muted-foreground">{b.code}</span></div>
          <h1 className="mt-1.5 text-xl font-semibold [overflow-wrap:anywhere] md:text-3xl"><Link href={`/hostels/${b.hostel.slug}`} className="hover:underline">{b.hostel.name}</Link></h1>
          <p className="tnum mt-1 text-sm text-muted-foreground">{fmtRange(b.checkIn, b.checkOut)} · {plural(b.nights, "night")} · {plural(b.guestsCount, "guest")}</p>
        </div>
      </div>

      {b.status === "PENDING_PAYMENT" && (left
        ? <Alert tone="warning" title={`Your beds are held for ${left}`}><div className="flex flex-wrap items-center justify-between gap-3"><span>Complete payment to confirm. After that the hold is released.</span>{can("pay") && <Button onClick={() => setPayOpen(true)}>Pay {money(b.pricing.totalPaise, { exact: true })}</Button>}</div></Alert>
        : now && <Alert tone="danger" title="The payment window has closed">This booking will expire shortly. You can search again for these dates.</Alert>)}
      {b.status === "PENDING_APPROVAL" && <Alert tone="info" title="Waiting for the host">{b.approvalDeadline ? `They reply by ${fmtDateTime(b.approvalDeadline)}. ` : ""}You&apos;ll be asked to pay only if they accept, and we&apos;ll notify you straight away.</Alert>}
      {b.status === "CONFIRMED" && <Alert tone="success" title="You're all set">Check-in from {b.hostel.checkInTime} on {fmtDate(b.checkIn, "weekday")}. Carry a government ID.</Alert>}
      {b.status === "REJECTED" && <Alert tone="danger" title="The host couldn't accept this request">You haven&apos;t been charged. <Link className="font-medium underline" href="/search">Find another stay</Link></Alert>}
      {b.status === "EXPIRED" && <Alert tone="info" title="This booking expired">It wasn&apos;t completed in time, so the beds were released. You haven&apos;t been charged.</Alert>}
      {(b.status === "CANCELLED_BY_GUEST" || b.status === "CANCELLED_BY_OWNER") && <Alert tone={b.status === "CANCELLED_BY_OWNER" ? "danger" : "info"} title={b.status === "CANCELLED_BY_GUEST" ? "You cancelled this booking" : "The property cancelled this booking"}>{b.cancelReason ?? (b.status === "CANCELLED_BY_OWNER" ? "You'll receive a full refund." : "No reason was given.")}</Alert>}
      {b.status === "NO_SHOW" && <Alert tone="danger" title="Marked as a no-show">The property recorded that you didn't arrive. The amount paid isn't refundable under the cancellation policy.</Alert>}
      {b.refund && <Alert tone={b.refund.status === "PROCESSED" ? "success" : "info"} title={`Refund ${b.refund.status === "PROCESSED" ? "sent" : "on its way"}: ${money(b.refund.amountPaise, { exact: true })}`}>{b.refund.reason}. It can take a few days to appear.</Alert>}

      <div className="grid items-start gap-6 md:grid-cols-[1fr_20rem]">
        <div className="grid gap-6">
          <Card><CardHeader><CardTitle>Your stay</CardTitle></CardHeader><CardContent className="grid gap-4">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-muted-foreground">Check-in</dt><dd className="font-medium">{fmtDate(b.checkIn, "weekday")} · from {b.hostel.checkInTime}</dd></div>
              <div><dt className="text-muted-foreground">Check-out</dt><dd className="font-medium">{fmtDate(b.checkOut, "weekday")} · by {b.hostel.checkOutTime}</dd></div>
            </dl>
            <ul className="grid gap-1.5 text-sm">{b.items.map((i) => <li key={i.roomTypeId} className="flex justify-between gap-4"><span className="[overflow-wrap:anywhere]">{i.name}</span><span className="text-muted-foreground">× {i.units}</span></li>)}</ul>
            <div className="border-t pt-4"><p className="mb-2 text-sm font-medium">Guests</p><ul className="grid gap-1 text-sm text-muted-foreground">{b.guests.map((g, i) => <li key={i} className="[overflow-wrap:anywhere]">{g.fullName}{g.isPrimary ? " (primary)" : ""}</li>)}</ul></div>
            {b.specialRequests && <p className="rounded-lg bg-muted p-3 text-sm [overflow-wrap:anywhere]">“{b.specialRequests}”</p>}
          </CardContent></Card>

          <Card><CardHeader><CardTitle>The property</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm">
            <p className="flex items-start gap-2 [overflow-wrap:anywhere]"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />{[b.hostel.addressLine1, b.hostel.locality, b.hostel.city, b.hostel.state].filter(Boolean).join(", ")}</p>
            {b.hostel.phone ? <p className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" /><a className="font-medium hover:underline" href={`tel:${b.hostel.phone}`}>{b.hostel.phone}</a></p> : !REVEAL.includes(b.status) && <p className="text-muted-foreground">The property&apos;s phone number is shown once your booking is confirmed.</p>}
            <a className="w-fit font-medium text-primary underline-offset-4 hover:underline" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/directions?to=${b.hostel.location.latitude}%2C${b.hostel.location.longitude}`}>Get directions</a>
          </CardContent></Card>

          <Card><CardHeader><CardTitle>Timeline</CardTitle></CardHeader><CardContent>
            <ol className="relative grid gap-4 border-l pl-5">
              {b.timeline.map((t, i) => (
                <li key={i} className="relative"><span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-primary ring-4 ring-card" /><p className="text-sm font-medium"><StatusBadge status={t.status} /></p><p className="mt-0.5 text-xs text-muted-foreground">{fmtDateTime(t.at, true)}{t.reason ? ` · ${t.reason}` : ""}</p></li>
              ))}
            </ol>
          </CardContent></Card>
        </div>

        <div className="grid gap-4 md:sticky md:top-24">
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><ReceiptIndianRupee className="size-4" />Price</CardTitle></CardHeader><CardContent className="grid gap-4">
            <div className="grid gap-2 text-sm">
              <Row label="Room charges" v={money(b.pricing.subtotalPaise)} />
              {b.pricing.discountPaise > 0 && <Row label={`Discount${b.pricing.couponCode ? ` (${b.pricing.couponCode})` : ""}`} v={`−${money(b.pricing.discountPaise)}`} tone="text-success" />}
              <Row label={`GST (${bps(b.pricing.effectiveGstBps)})`} v={money(b.pricing.taxPaise)} />
              <div className="flex items-baseline justify-between border-t pt-3 text-base font-semibold"><span>Total</span><span className="tnum">{money(b.pricing.totalPaise, { exact: true })}</span></div>
            </div>
            {b.payment && <p className="flex items-center justify-between text-xs text-muted-foreground"><span>Payment</span><StatusBadge status={b.payment.status} /></p>}
          </CardContent></Card>

          {b.cancellation && (can("cancel") || b.status === "CONFIRMED") && (
            <Card><CardHeader><CardTitle className="text-sm">Cancellation</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm text-muted-foreground"><p>{b.cancellation.summary}</p>
              {b.status === "CONFIRMED" && <p className="tnum font-medium text-foreground">If you cancel now: {b.cancellation.refundPercentNow}% back ({money(b.cancellation.refundPaiseNow, { exact: true })})</p>}</CardContent></Card>
          )}

          <div className="grid gap-2">
            {can("pay") && <Button size="lg" onClick={() => setPayOpen(true)}><CalendarCheck />Pay now</Button>}
            {can("review") && <Button size="lg" variant="outline" onClick={() => setReviewOpen(true)}><Star />Write a review</Button>}
            {b.reviewId && <Button asChild variant="outline"><Link href="/account/reviews"><Star />View your review</Link></Button>}
            {can("cancel") && <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setCancelOpen(true)}>Cancel booking</Button>}
          </div>
        </div>
      </div>

      <PaymentSheet booking={b} open={payOpen} onOpenChange={(o) => { setPayOpen(o); if (!o && sp.get("pay")) router.replace(`/account/bookings/${id}`, { scroll: false }); }} />
      <ReviewDialog booking={{ id: b.id, hostelName: b.hostel.name }} open={reviewOpen} onOpenChange={setReviewOpen} />
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} destructive title="Cancel this booking?" confirmLabel="Yes, cancel booking" reason={{ label: "Reason", placeholder: "Tell the host why (optional)" }} onConfirm={(r) => cancel.mutateAsync(r)}
        description="This can't be undone.">
        {preview.isPending ? <Skeleton className="h-16" /> : preview.data ? (
          <div className="rounded-xl bg-muted p-4 text-sm">
            {preview.data.refundPaise > 0 ? <><p className="font-medium">You&apos;ll get {money(preview.data.refundPaise, { exact: true })} back ({preview.data.refundPercent}%)</p>{preview.data.retainedPaise > 0 && <p className="mt-1 text-muted-foreground">{money(preview.data.retainedPaise, { exact: true })} is kept under the cancellation policy.</p>}</> : <p className="font-medium">{b.pricing.totalPaise === 0 || !b.payment || b.payment.status !== "CAPTURED" ? "You haven't paid, so nothing is charged." : "No refund applies at this point under the cancellation policy."}</p>}
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
const Row = ({ label, v, tone }: { label: string; v: string; tone?: string }) => <div className={`flex justify-between gap-3 ${tone ?? ""}`}><span>{label}</span><span className="tnum">{v}</span></div>;
