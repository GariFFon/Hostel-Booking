"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarX2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { useNow } from "@/hooks/use-now";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { countdown, fmtRange, money, plural } from "@/lib/format";
import type { BookingSummary } from "@/lib/api/types";

const TABS = [["requests", "Requests"], ["upcoming", "Upcoming"], ["past", "Past"], ["all", "All"]] as const;
type Tab = (typeof TABS)[number][0];

export function OwnerBookingsList() {
  const initial = useSearchParams().get("tab");
  const [tab, setTab] = React.useState<Tab>(TABS.some(([t]) => t === initial) ? (initial as Tab) : "requests");
  const [hostelId, setHostelId] = React.useState("all");
  const [reject, setReject] = React.useState<BookingSummary | null>(null);
  const qc = useQueryClient();
  const now = useNow();
  const hostels = useQuery({ queryKey: ["owner", "hostels", "options"], staleTime: 60_000, queryFn: () => unwrapData(api.GET("/owner/hostels", { params: { query: { limit: 50 } } })) });
  const q = useInfiniteQuery({
    queryKey: ["owner", "bookings", tab, hostelId], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/owner/bookings", { params: { query: {
      limit: 15, ...(hostelId !== "all" ? { hostelId } : {}), ...(pageParam ? { cursor: pageParam } : {}),
      ...(tab === "requests" ? { status: "PENDING_APPROVAL" as const } : tab === "all" ? { when: "all" as const } : { when: tab }),
    } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const sync = () => qc.invalidateQueries({ queryKey: ["owner", "bookings"] });
  const approve = useMutation({ mutationFn: (id: string) => unwrapData(api.POST("/owner/bookings/{id}/approve", { params: { path: { id } } })), onSuccess: () => { sync(); toast.success("Accepted. The guest now has time to pay."); }, onError: (e) => toast.error(errorMessage(e)) });
  const decline = useMutation({ mutationFn: (v: { id: string; reason: string }) => unwrapData(api.POST("/owner/bookings/{id}/reject", { params: { path: { id: v.id } }, body: { reason: v.reason } })), onSuccess: () => { sync(); toast.success("Request declined"); } });

  return (
    <div className="grid gap-6">
      <PageHeader title="Bookings" description="Requests need your reply within the deadline, or they expire." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}><TabsList>{TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}</TabsList></Tabs>
        {(hostels.data?.length ?? 0) > 1 && (
          <Select value={hostelId} onValueChange={setHostelId}><SelectTrigger className="h-10 w-auto min-w-44 md:h-9" aria-label="Filter by property"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All properties</SelectItem>{hostels.data!.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent></Select>
        )}
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={CalendarX2} title={tab === "requests" ? "No requests waiting" : "No bookings here"} description={tab === "requests" ? "When a guest asks to book a request-to-book property, it shows up here." : "Bookings appear as guests reserve your beds and rooms."} />
        : <ul className="grid gap-3">{items.map((b) => {
          const left = b.holdExpiresAt && now ? countdown(b.holdExpiresAt, now) : null;
          return (
            <li key={b.id} className="rounded-2xl border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <Link href={`/owner/bookings/${b.id}`} className="min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <p className="flex flex-wrap items-center gap-2"><span className="font-semibold [overflow-wrap:anywhere]">{b.guestName ?? "Guest"}</span><StatusBadge status={b.status} /></p>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">{b.hostel.name}</p>
                  <p className="tnum mt-1 text-sm">{fmtRange(b.checkIn, b.checkOut)} · {plural(b.nights, "night")} · {plural(b.guestsCount, "guest")}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{b.code}</p>
                </Link>
                <div className="text-right"><p className="tnum text-lg font-semibold">{money(b.totalPaise, { exact: true })}</p>{b.status === "PENDING_APPROVAL" && left && <p className="tnum text-xs font-medium text-warning">Reply within {left}</p>}</div>
              </div>
              {b.status === "PENDING_APPROVAL" && (
                <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                  <Button size="sm" loading={approve.isPending && approve.variables === b.id} onClick={() => approve.mutate(b.id)}><Check />Accept</Button>
                  <Button size="sm" variant="outline" onClick={() => setReject(b)}><X />Decline</Button>
                  <Button size="sm" variant="ghost" asChild><Link href={`/owner/bookings/${b.id}`}>Details</Link></Button>
                </div>
              )}
            </li>
          );
        })}</ul>}
      <LoadMore query={q} />
      <ConfirmDialog open={!!reject} onOpenChange={(o) => !o && setReject(null)} destructive title="Decline this request?" confirmLabel="Decline request" description="The guest isn't charged and the beds are released." reason={{ label: "Reason (shown to the guest)", required: true, placeholder: "e.g. Closed for renovation on those dates" }} onConfirm={(r) => decline.mutateAsync({ id: reject!.id, reason: r })} />
    </div>
  );
}
