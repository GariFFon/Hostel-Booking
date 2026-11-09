"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Building2, CalendarCheck, Clock, IndianRupee, MessageSquare, Plus, ShieldAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Stars } from "@/components/common/rating";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { fmtDate, fmtRange, money, plural, timeAgo } from "@/lib/format";
import { useUser } from "@/lib/session/use-session";

export function OwnerOverview() {
  const { user } = useUser();
  const kyc = useQuery({ queryKey: ["owner", "profile"], queryFn: () => unwrapData(api.GET("/owner/profile")) });
  const hostels = useQuery({ queryKey: ["owner", "hostels", "all"], queryFn: () => unwrap(api.GET("/owner/hostels", { params: { query: { limit: 50 } } })) });
  const earnings = useQuery({ queryKey: ["owner", "earnings", "overview"], queryFn: () => unwrapData(api.GET("/owner/earnings", { params: { query: {} } })) });
  const pending = useQuery({ queryKey: ["owner", "bookings", "pending"], refetchInterval: 60_000, queryFn: () => unwrapData(api.GET("/owner/bookings", { params: { query: { status: "PENDING_APPROVAL", limit: 5 } } })) });
  const upcoming = useQuery({ queryKey: ["owner", "bookings", "upcoming"], queryFn: () => unwrapData(api.GET("/owner/bookings", { params: { query: { when: "upcoming", status: "CONFIRMED", limit: 5 } } })) });
  const toReply = useQuery({ queryKey: ["owner", "reviews", "unreplied"], queryFn: () => unwrapData(api.GET("/owner/reviews", { params: { query: { replied: "false", status: "PUBLISHED", limit: 3 } } })) });

  const hs = hostels.data?.data ?? [];
  const live = hs.filter((h) => h.status === "APPROVED").length;
  const kycStatus = kyc.data?.kycStatus;
  const first = user?.fullName?.split(" ")[0];
  return (
    <div className="grid gap-6">
      <PageHeader title={first ? `Welcome back, ${first}` : "Host dashboard"} description="What needs your attention today." actions={<Button asChild><Link href="/owner/hostels/new"><Plus />New property</Link></Button>} />

      {kycStatus && kycStatus !== "APPROVED" && (
        <Alert tone={kycStatus === "REJECTED" ? "danger" : "warning"} title={kycStatus === "PENDING" ? "Verification in review" : kycStatus === "REJECTED" ? "Verification needs attention" : "Verify your identity to go live"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{kycStatus === "PENDING" ? "We usually respond within a day or two. You can keep preparing your listings." : kycStatus === "REJECTED" ? kyc.data?.rejectionReason ?? "Please review your documents and submit again." : "Properties can't be published until your ID and business details are approved."}</span>
            {kycStatus !== "PENDING" && <Button asChild size="sm"><Link href="/owner/verification"><ShieldAlert />{kycStatus === "REJECTED" ? "Fix and resubmit" : "Start verification"}</Link></Button>}
          </div>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Awaiting your reply" value={pending.isPending ? "…" : pending.data?.length ?? 0} icon={Clock} tone={pending.data?.length ? "warning" : undefined} hint="Booking requests" href="/owner/bookings?tab=requests" />
        <StatCard label="Upcoming stays" value={upcoming.isPending ? "…" : (upcoming.data?.length ?? 0) >= 5 ? "5+" : upcoming.data?.length ?? 0} icon={CalendarCheck} hint="Confirmed" href="/owner/bookings" />
        <StatCard label="Live properties" value={hostels.isPending ? "…" : `${live} of ${hs.length}`} icon={Building2} href="/owner/hostels" />
        <StatCard label="Expected earnings" value={earnings.isPending ? "…" : money(earnings.data?.upcoming.expectedOwnerPaise)} icon={IndianRupee} hint={earnings.data ? `${plural(earnings.data.upcoming.bookings, "booking")} to come` : undefined} href="/owner/earnings" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>Booking requests</CardTitle><Link href="/owner/bookings" className="text-sm text-primary hover:underline">All bookings</Link></CardHeader>
          <CardContent>
            {pending.isPending ? <Skeleton className="h-24" /> : !pending.data?.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing waiting. You&apos;re all caught up.</p> : (
              <ul className="grid gap-2">{pending.data.map((b) => <li key={b.id}><Link href={`/owner/bookings/${b.id}`} className="pressable flex items-center justify-between gap-3 rounded-xl border p-3 hover:bg-muted/50"><span className="min-w-0"><span className="block truncate font-medium">{b.guestName ?? "Guest"} · {b.hostel.name}</span><span className="tnum block text-xs text-muted-foreground">{fmtRange(b.checkIn, b.checkOut)} · {plural(b.guestsCount, "guest")}</span></span><StatusBadge status={b.status} /></Link></li>)}</ul>
            )}
          </CardContent></Card>

        <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>Arriving soon</CardTitle><Link href="/owner/calendar" className="text-sm text-primary hover:underline">Calendar</Link></CardHeader>
          <CardContent>
            {upcoming.isPending ? <Skeleton className="h-24" /> : !upcoming.data?.length ? <p className="py-6 text-center text-sm text-muted-foreground">No confirmed stays coming up.</p> : (
              <ul className="grid gap-2">{upcoming.data.map((b) => <li key={b.id}><Link href={`/owner/bookings/${b.id}`} className="pressable flex items-center justify-between gap-3 rounded-xl border p-3 hover:bg-muted/50"><span className="min-w-0"><span className="block truncate font-medium">{b.guestName ?? "Guest"}</span><span className="block truncate text-xs text-muted-foreground">{b.hostel.name}</span></span><span className="tnum shrink-0 text-sm">{fmtDate(b.checkIn, "weekday")}</span></Link></li>)}</ul>
            )}
          </CardContent></Card>
      </div>

      <Card><CardHeader className="flex-row items-center justify-between"><CardTitle className="flex items-center gap-2"><MessageSquare className="size-4" />Reviews to answer</CardTitle><Link href="/owner/reviews" className="text-sm text-primary hover:underline">All reviews</Link></CardHeader>
        <CardContent>
          {toReply.isPending ? <Skeleton className="h-20" /> : !toReply.data?.length ? <p className="py-4 text-center text-sm text-muted-foreground">Every review has a reply.</p> : (
            <ul className="grid gap-3">{toReply.data.map((r) => <li key={r.id} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-3"><Stars value={r.overall} size="size-3.5" /><span className="text-xs text-muted-foreground">{r.reviewer.name} · {r.hostel.name} · {timeAgo(r.createdAt)}</span></div>{r.comment && <p className="mt-1.5 line-clamp-2 text-sm [overflow-wrap:anywhere]">{r.comment}</p>}</li>)}</ul>
          )}
        </CardContent></Card>

      {hostels.data && hs.length === 0 && <EmptyState icon={Building2} title="List your first property" description="Add photos, rooms and prices. You can save a draft and finish later." action={<Button asChild><Link href="/owner/hostels/new"><Plus />Create a listing</Link></Button>} />}
    </div>
  );
}
