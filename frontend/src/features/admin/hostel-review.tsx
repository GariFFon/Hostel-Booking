"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ExternalLink, Pause, Play, X } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/error-state";
import { StatusBadge } from "@/components/common/status-badge";
import { AmenityIcon } from "@/features/hostel/amenity-icon";
import { api, unwrapData } from "@/lib/api/client";
import { money, plural, titleCase } from "@/lib/format";

type Act = "approve" | "reject" | "suspend" | "reinstate";

export function HostelReview() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [dlg, setDlg] = React.useState<Act | null>(null);
  const q = useQuery({ queryKey: ["admin", "hostel", id], queryFn: () => unwrapData(api.GET("/admin/hostels/{id}", { params: { path: { id } } })) });
  const run = useMutation({
    mutationFn: ({ kind, reason }: { kind: Act; reason: string }) => {
      const p = { params: { path: { id } } };
      switch (kind) {
        case "approve": return unwrapData(api.POST("/admin/hostels/{id}/approve", p));
        case "reinstate": return unwrapData(api.POST("/admin/hostels/{id}/reinstate", p));
        case "reject": return unwrapData(api.POST("/admin/hostels/{id}/reject", { ...p, body: { reason } }));
        case "suspend": return unwrapData(api.POST("/admin/hostels/{id}/suspend", { ...p, body: { reason } }));
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "hostel", id] }); qc.invalidateQueries({ queryKey: ["admin", "hostels"] }); toast.success("Done. The host has been notified."); },
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const h = q.data;
  if (!h) return <div className="grid gap-4"><Skeleton className="h-9 w-72" /><Skeleton className="h-96" /></div>;
  return (
    <div className="grid gap-6">
      <Link href="/admin/hostels" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Listings</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex flex-wrap items-center gap-2"><StatusBadge status={h.status} /><Badge tone="outline">{h.propertyType === "PG" ? "PG" : "Hostel"}</Badge></div><h1 className="mt-1.5 text-2xl font-semibold [overflow-wrap:anywhere] md:text-3xl">{h.name}</h1><p className="text-sm text-muted-foreground">{h.address.line1}, {h.address.city}, {h.address.state} {h.address.postalCode}</p></div>
        <div className="flex flex-wrap gap-2">
          {h.status === "PENDING_REVIEW" && <><Button onClick={() => setDlg("approve")}><Check />Approve</Button><Button variant="outline" onClick={() => setDlg("reject")}><X />Reject</Button></>}
          {h.status === "APPROVED" && <><Button variant="outline" asChild><Link href={`/hostels/${h.slug}`} target="_blank"><ExternalLink />View live</Link></Button><Button variant="outline" className="text-destructive" onClick={() => setDlg("suspend")}><Pause />Suspend</Button></>}
          {h.status === "SUSPENDED" && <Button onClick={() => setDlg("reinstate")}><Play />Reinstate</Button>}
        </div>
      </div>
      {h.rejectionReason && <Alert tone="warning" title={h.status === "SUSPENDED" ? "Suspension reason" : "Rejection reason"}>{h.rejectionReason}</Alert>}

      <Card><CardHeader><CardTitle>Photos ({h.media.length})</CardTitle></CardHeader><CardContent>
        {h.media.length === 0 ? <p className="text-sm text-muted-foreground">No photos.</p> : <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{h.media.map((m) => <li key={m.id} className="aspect-[4/3] overflow-hidden rounded-xl bg-muted">{ }<a href={m.fullUrl} target="_blank" rel="noopener noreferrer"><img src={m.cardUrl} alt={m.altText ?? ""} loading="lazy" className="size-full object-cover" /></a></li>)}</ul>}
      </CardContent></Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Description</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm"><p className="whitespace-pre-line [overflow-wrap:anywhere]">{h.description}</p>
          <dl className="grid grid-cols-2 gap-3"><div><dt className="text-muted-foreground">Booking</dt><dd className="font-medium">{h.bookingMode === "INSTANT" ? "Instant" : "Request to book"}</dd></div><div><dt className="text-muted-foreground">Cancellation</dt><dd className="font-medium">{titleCase(h.cancellationPolicy)}</dd></div><div><dt className="text-muted-foreground">Guests</dt><dd className="font-medium">{titleCase(h.genderPolicy)}</dd></div><div><dt className="text-muted-foreground">Check-in / out</dt><dd className="font-medium">{h.checkInTime} / {h.checkOutTime}</dd></div><div><dt className="text-muted-foreground">Phone</dt><dd className="font-medium">{h.phone ?? "—"}</dd></div><div><dt className="text-muted-foreground">GSTIN</dt><dd className="font-mono text-xs font-medium">{h.gstin ?? "—"}</dd></div></dl>
          {h.houseRules && <div><p className="text-muted-foreground">House rules</p><p className="mt-0.5 whitespace-pre-line [overflow-wrap:anywhere]">{h.houseRules}</p></div>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Rooms ({h.roomTypes.length})</CardTitle></CardHeader><CardContent className="grid gap-3">
          {h.roomTypes.map((r) => <div key={r.id} className="rounded-xl border p-3 text-sm"><p className="font-medium [overflow-wrap:anywhere]">{r.name} {!r.isActive && <Badge tone="warning">hidden</Badge>}</p><p className="tnum text-xs text-muted-foreground">{r.kind === "DORM" ? "Dorm bed" : "Private room"} · {plural(r.totalUnits, r.kind === "DORM" ? "bed" : "room")} · {money(r.basePricePaise)}/{r.priceUnit === "MONTH" ? "month" : "night"} · {r.minStayNights}–{r.maxStayNights} nights</p></div>)}
          {h.amenities.length > 0 && <ul className="flex flex-wrap gap-2 pt-1">{h.amenities.map((a) => <li key={a.code} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs"><AmenityIcon code={a.code} className="size-3.5" />{a.label}</li>)}</ul>}
        </CardContent></Card>
      </div>

      <ConfirmDialog open={dlg === "approve"} onOpenChange={(o) => !o && setDlg(null)} title="Approve this listing?" confirmLabel="Approve and publish" description="It goes live immediately and the host is notified." onConfirm={() => run.mutateAsync({ kind: "approve", reason: "" })} />
      <ConfirmDialog open={dlg === "reinstate"} onOpenChange={(o) => !o && setDlg(null)} title="Reinstate this listing?" confirmLabel="Reinstate" onConfirm={() => run.mutateAsync({ kind: "reinstate", reason: "" })} />
      <ConfirmDialog open={dlg === "reject"} onOpenChange={(o) => !o && setDlg(null)} destructive title="Reject this listing?" confirmLabel="Reject" description="The host sees your reason and can fix and resubmit." reason={{ label: "Reason for the host", required: true, max: 500, placeholder: "e.g. Photos are too dark to judge the rooms" }} onConfirm={(r) => run.mutateAsync({ kind: "reject", reason: r })} />
      <ConfirmDialog open={dlg === "suspend"} onOpenChange={(o) => !o && setDlg(null)} destructive title="Suspend this listing?" confirmLabel="Suspend" description="It disappears from search immediately. Existing bookings are not cancelled." reason={{ label: "Reason (shown to the host)", required: true, max: 500 }} onConfirm={(r) => run.mutateAsync({ kind: "suspend", reason: r })} />
    </div>
  );
}
