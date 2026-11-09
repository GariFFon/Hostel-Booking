"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, CalendarCheck, ShieldCheck, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { count, fmtRange, money, timeAgo } from "@/lib/format";

export function AdminOverview() {
  const hostels = useQuery({ queryKey: ["admin", "hostels", "PENDING_REVIEW"], refetchInterval: 60_000, queryFn: () => unwrapData(api.GET("/admin/hostels", { params: { query: { status: "PENDING_REVIEW", limit: 50 } } })) });
  const kyc = useQuery({ queryKey: ["admin", "kyc", "PENDING"], refetchInterval: 60_000, queryFn: () => unwrapData(api.GET("/admin/kyc", { params: { query: { status: "PENDING", limit: 50 } } })) });
  const bookings = useQuery({ queryKey: ["admin", "bookings", "recent"], queryFn: () => unwrapData(api.GET("/admin/bookings", { params: { query: { limit: 6 } } })) });
  const verify = useMutation({ mutationFn: () => unwrapData(api.GET("/admin/audit-logs/verify")), onError: (e) => toast.error(errorMessage(e)) });
  const n = (q: { data?: unknown[] }) => (q.data ? (q.data.length >= 50 ? "50+" : String(q.data.length)) : "…");
  return (
    <div className="grid gap-6">
      <PageHeader title="Admin overview" description="Queues that need a human decision." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Listings awaiting review" value={n(hostels)} icon={Building2} tone={hostels.data?.length ? "warning" : undefined} href="/admin/hostels" />
        <StatCard label="Hosts awaiting verification" value={n(kyc)} icon={ShieldCheck} tone={kyc.data?.length ? "warning" : undefined} href="/admin/kyc" />
        <StatCard label="Recent bookings" value={bookings.data ? count(bookings.data.length) : "…"} icon={CalendarCheck} href="/admin/bookings" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>Oldest listings in the queue</CardTitle><Link href="/admin/hostels" className="text-sm text-primary hover:underline">Open queue</Link></CardHeader><CardContent>
          {!hostels.data?.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing waiting.</p> : <ul className="grid gap-2">{hostels.data.slice(0, 5).map((h) => <li key={h.id}><Link href={`/admin/hostels/${h.id}`} className="pressable flex items-center justify-between gap-3 rounded-xl border p-3 hover:bg-muted/50"><span className="min-w-0"><span className="block truncate font-medium">{h.name}</span><span className="block truncate text-xs text-muted-foreground">{h.city} · {h.owner.ownerProfile?.businessName ?? h.owner.profile?.fullName}</span></span><span className="shrink-0 text-xs text-muted-foreground">{timeAgo(h.updatedAt)}</span></Link></li>)}</ul>}
        </CardContent></Card>
        <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>Latest bookings</CardTitle><Link href="/admin/bookings" className="text-sm text-primary hover:underline">All</Link></CardHeader><CardContent>
          {!bookings.data?.length ? <p className="py-6 text-center text-sm text-muted-foreground">No bookings yet.</p> : <ul className="grid gap-2">{bookings.data.map((b) => <li key={b.id}><Link href={`/admin/bookings/${b.id}`} className="pressable flex items-center justify-between gap-3 rounded-xl border p-3 hover:bg-muted/50"><span className="min-w-0"><span className="block truncate font-medium">{b.hostel.name}</span><span className="tnum block truncate text-xs text-muted-foreground">{fmtRange(b.checkIn, b.checkOut)} · {money(b.totalPaise)}</span></span><StatusBadge status={b.status} /></Link></li>)}</ul>}
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldQuestion className="size-4" />Audit log integrity</CardTitle></CardHeader><CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">Every change is written to a tamper-evident, hash-chained log. Verification recomputes the whole chain and reports any row that was altered. It also runs automatically every night.</p>
        {verify.data && (verify.data.intact ? <Alert tone="success" title="Chain intact">{count(verify.data.rowsChecked)} entries verified.</Alert> : <Alert tone="danger" title="Tampering detected">{verify.data.broken.length} entries failed verification. First: #{verify.data.broken[0]?.id} ({verify.data.broken[0]?.reason}).</Alert>)}
        <div><Button variant="outline" loading={verify.isPending} onClick={() => verify.mutate()}>Verify the chain now</Button></div>
      </CardContent></Card>
    </div>
  );
}
