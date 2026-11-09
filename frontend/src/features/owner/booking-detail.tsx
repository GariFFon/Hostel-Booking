"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, LogIn, LogOut, Phone, UserX, X } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/error-state";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrapData } from "@/lib/api/client";
import { bps, fmtDate, fmtDateTime, fmtRange, money, plural } from "@/lib/format";

type Act = "reject" | "check_in" | "complete" | "no_show" | "cancel";

export function OwnerBookingDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [dlg, setDlg] = React.useState<Act | null>(null);
  const q = useQuery({ queryKey: ["owner", "booking", id], queryFn: () => unwrapData(api.GET("/owner/bookings/{id}", { params: { path: { id } } })) });
  const b = q.data;
  const done = (nb: NonNullable<typeof b>) => { qc.setQueryData(["owner", "booking", id], nb); qc.invalidateQueries({ queryKey: ["owner", "bookings"] }); };
  const approve = useMutation({ mutationFn: () => unwrapData(api.POST("/owner/bookings/{id}/approve", { params: { path: { id } } })), onSuccess: (nb) => { done(nb); toast.success("Accepted. The guest now has time to pay."); }, onError: (e) => toast.error(String((e as Error).message)) });
  const act = useMutation({
    mutationFn: async ({ kind, text }: { kind: Act; text: string }) => {
      const p = { params: { path: { id } } };
      switch (kind) {
        case "reject": return unwrapData(api.POST("/owner/bookings/{id}/reject", { ...p, body: { reason: text } }));
        case "cancel": return unwrapData(api.POST("/owner/bookings/{id}/cancel", { ...p, body: { reason: text } }));
        case "check_in": return unwrapData(api.POST("/owner/bookings/{id}/check-in", { ...p, body: text ? { notes: text } : {} }));
        case "complete": return unwrapData(api.POST("/owner/bookings/{id}/complete", p));
        case "no_show": return unwrapData(api.POST("/owner/bookings/{id}/no-show", p));
      }
    },
    onSuccess: (nb) => { done(nb); toast.success("Done"); },
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!b) return <div className="grid gap-4"><Skeleton className="h-9 w-64" /><Skeleton className="h-72" /></div>;
  const can = (a: string) => (b.actions as string[]).includes(a);
  const guest = b.guest;
  return (
    <div className="grid gap-6">
      <Link href="/owner/bookings" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Bookings</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex flex-wrap items-center gap-2"><StatusBadge status={b.status} /><span className="font-mono text-xs text-muted-foreground">{b.code}</span></div>
          <h1 className="mt-1.5 text-2xl font-semibold [overflow-wrap:anywhere] md:text-3xl">{guest?.name ?? "Guest"}</h1>
          <p className="tnum mt-1 text-sm text-muted-foreground">{b.hostel.name} · {fmtRange(b.checkIn, b.checkOut)} · {plural(b.nights, "night")} · {plural(b.guestsCount, "guest")}</p></div>
        <div className="flex flex-wrap gap-2">
          {can("approve") && <Button loading={approve.isPending} onClick={() => approve.mutate()}><Check />Accept</Button>}
          {can("reject") && <Button variant="outline" onClick={() => setDlg("reject")}><X />Decline</Button>}
          {can("check_in") && <Button onClick={() => setDlg("check_in")}><LogIn />Check in</Button>}
          {can("complete") && <Button onClick={() => setDlg("complete")}><LogOut />Complete stay</Button>}
          {can("no_show") && <Button variant="outline" onClick={() => setDlg("no_show")}><UserX />No-show</Button>}
          {can("cancel") && <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDlg("cancel")}>Cancel booking</Button>}
        </div>
      </div>

      {b.status === "PENDING_APPROVAL" && <Alert tone="warning" title="Waiting for your reply">{b.approvalDeadline ? `Reply by ${fmtDateTime(b.approvalDeadline)}, or the request expires. ` : ""}The guest isn&apos;t charged until you accept.</Alert>}
      {b.status === "PENDING_PAYMENT" && <Alert tone="info" title="Waiting for the guest to pay">Their beds are held until {b.holdExpiresAt ? fmtDateTime(b.holdExpiresAt) : "the hold expires"}.</Alert>}
      {b.cancelReason && <Alert tone="info" title={b.cancelledBy === "GUEST" ? "Cancelled by the guest" : "Cancelled"}>{b.cancelReason}</Alert>}

      <div className="grid items-start gap-6 md:grid-cols-[1fr_20rem]">
        <div className="grid gap-6">
          <Card><CardHeader><CardTitle>Stay</CardTitle></CardHeader><CardContent className="grid gap-4 text-sm">
            <dl className="grid grid-cols-2 gap-4"><div><dt className="text-muted-foreground">Check-in</dt><dd className="font-medium">{fmtDate(b.checkIn, "weekday")} · from {b.hostel.checkInTime}</dd></div><div><dt className="text-muted-foreground">Check-out</dt><dd className="font-medium">{fmtDate(b.checkOut, "weekday")} · by {b.hostel.checkOutTime}</dd></div></dl>
            <ul className="grid gap-1.5">{b.items.map((i) => <li key={i.roomTypeId} className="flex justify-between gap-3"><span>{i.name}</span><span className="text-muted-foreground">× {i.units}</span></li>)}</ul>
            {b.specialRequests && <p className="rounded-lg bg-muted p-3 [overflow-wrap:anywhere]">“{b.specialRequests}”</p>}
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Guests</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm">
            {b.guests.map((g, i) => <div key={i} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3"><span className="font-medium [overflow-wrap:anywhere]">{g.fullName}{g.isPrimary ? " (primary)" : ""}</span><span className="text-muted-foreground">{[g.gender, g.age ? `${g.age} yrs` : null, g.idType ? `${g.idType} ····${g.idLast4}` : null].filter(Boolean).join(" · ") || "No details"}</span></div>)}
            {guest && (guest.phone || guest.email)
              ? <div className="grid gap-1.5 rounded-lg bg-muted p-3">{guest.phone && <p className="flex items-center gap-2"><Phone className="size-4" /><a className="font-medium hover:underline" href={`tel:${guest.phone}`}>{guest.phone}</a></p>}{guest.email && <p className="[overflow-wrap:anywhere]">{guest.email}</p>}</div>
              : <p className="text-muted-foreground">The guest&apos;s contact details are shown once the booking is confirmed.</p>}
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Timeline</CardTitle></CardHeader><CardContent><ol className="relative grid gap-4 border-l pl-5">{b.timeline.map((t, i) => <li key={i} className="relative"><span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-primary ring-4 ring-card" /><StatusBadge status={t.status} /><p className="mt-0.5 text-xs text-muted-foreground">{fmtDateTime(t.at, true)}{t.actorRole ? ` · ${t.actorRole.toLowerCase()}` : ""}{t.reason ? ` · ${t.reason}` : ""}</p></li>)}</ol></CardContent></Card>
        </div>
        <Card className="md:sticky md:top-20"><CardHeader><CardTitle>Earnings</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm">
          <Row l="Room charges" v={money(b.pricing.subtotalPaise)} />{b.pricing.discountPaise > 0 && <Row l={`Discount${b.pricing.couponCode ? ` (${b.pricing.couponCode})` : ""}`} v={`−${money(b.pricing.discountPaise)}`} />}
          <Row l={`GST (${bps(b.pricing.effectiveGstBps)}), collected for tax`} v={money(b.pricing.taxPaise)} />
          <div className="my-1 border-t" />
          {b.ownerShare && <><Row l="Platform commission" v={`−${money(b.ownerShare.commissionPaise)}`} /><div className="flex justify-between gap-3 text-base font-semibold"><span>You earn</span><span className="tnum">{money(b.ownerShare.ownerNetPaise, { exact: true })}</span></div></>}
          <p className="mt-1 text-xs text-muted-foreground">Guest pays {money(b.pricing.totalPaise, { exact: true })}. Released to you when the stay is complete.</p>
        </CardContent></Card>
      </div>

      <ConfirmDialog open={dlg === "reject"} onOpenChange={(o) => !o && setDlg(null)} destructive title="Decline this request?" confirmLabel="Decline" reason={{ label: "Reason (shown to the guest)", required: true }} onConfirm={(r) => act.mutateAsync({ kind: "reject", text: r })} />
      <ConfirmDialog open={dlg === "cancel"} onOpenChange={(o) => !o && setDlg(null)} destructive title="Cancel this booking?" confirmLabel="Cancel booking" description="The guest receives a full refund." reason={{ label: "Reason (shown to the guest)", required: true }} onConfirm={(r) => act.mutateAsync({ kind: "cancel", text: r })} />
      <ConfirmDialog open={dlg === "check_in"} onOpenChange={(o) => !o && setDlg(null)} title="Check this guest in?" confirmLabel="Check in" reason={{ label: "Notes", placeholder: "e.g. ID verified: Aadhaar", max: 300 }} onConfirm={(r) => act.mutateAsync({ kind: "check_in", text: r })} />
      <ConfirmDialog open={dlg === "complete"} onOpenChange={(o) => !o && setDlg(null)} title="Complete this stay?" confirmLabel="Complete" description="Your share is released and the guest is invited to review." onConfirm={() => act.mutateAsync({ kind: "complete", text: "" })} />
      <ConfirmDialog open={dlg === "no_show"} onOpenChange={(o) => !o && setDlg(null)} destructive title="Record a no-show?" confirmLabel="Record no-show" description="The guest's payment is kept and the remaining nights go back on sale." onConfirm={() => act.mutateAsync({ kind: "no_show", text: "" })} />
    </div>
  );
}
const Row = ({ l, v }: { l: string; v: string }) => <div className="flex justify-between gap-3"><span className="text-muted-foreground">{l}</span><span className="tnum">{v}</span></div>;
