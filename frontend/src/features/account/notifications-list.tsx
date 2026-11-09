"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, CalendarCheck, CircleDollarSign, Info, MessageSquare, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { unreadKey } from "@/components/layout/notification-bell";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { timeAgo } from "@/lib/format";
import { notificationHref } from "@/lib/notification-link";
import type { Item } from "@/lib/api/types";
import { cn } from "@/lib/utils";

type N = Item<"/me/notifications">;
function icon(type: string) {
  if (type.startsWith("PAYMENT") || type.startsWith("REFUND")) return CircleDollarSign;
  if (type.startsWith("BOOKING")) return CalendarCheck;
  if (type.startsWith("REVIEW")) return MessageSquare;
  if (type.startsWith("KYC") || type.startsWith("HOSTEL")) return ShieldCheck;
  return Info;
}

export function NotificationsList() {
  const qc = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = React.useState<"all" | "unread">("all");
  const q = useInfiniteQuery({
    queryKey: ["notifications", "list", tab], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/me/notifications", { params: { query: { limit: 20, ...(tab === "unread" ? { unread: "true" as const } : {}), ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const sync = () => { qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: unreadKey }); };
  const read = useMutation({ mutationFn: (id: string) => unwrapData(api.POST("/me/notifications/{id}/read", { params: { path: { id } } })), onSuccess: sync });
  const readAll = useMutation({ mutationFn: () => unwrapData(api.POST("/me/notifications/read-all")), onSuccess: () => { sync(); toast.success("All caught up"); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => unwrapData(api.DELETE("/me/notifications/{id}", { params: { path: { id } } })), onSuccess: sync, onError: (e) => toast.error(errorMessage(e)) });

  function open(n: N) {
    if (!n.read) read.mutate(n.id);
    const href = notificationHref(n);
    if (href) router.push(href);
  }
  const hasUnread = items.some((n) => !n.read);
  return (
    <div className="grid gap-6">
      <PageHeader title="Notifications" actions={<Button variant="outline" size="sm" onClick={() => readAll.mutate()} loading={readAll.isPending} disabled={!hasUnread && tab === "all"}>Mark all as read</Button>} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}><TabsList><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="unread">Unread</TabsTrigger></TabsList></Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={tab === "unread" ? BellOff : Bell} title={tab === "unread" ? "You're all caught up" : "No notifications yet"} description="Booking updates, payment receipts and reviews will show up here." />
        : <ul className="grid gap-2">{items.map((n) => {
          const Icon = icon(n.type);
          const href = notificationHref(n);
          return (
            <li key={n.id} className={cn("group flex items-stretch gap-1 rounded-xl border bg-card transition-colors", !n.read && "border-primary/30 bg-accent/40")}>
              <button type="button" onClick={() => open(n)} className="pressable flex min-w-0 flex-1 items-start gap-3 rounded-xl p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full", n.read ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground")}><Icon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3"><span className={cn("text-sm [overflow-wrap:anywhere]", !n.read && "font-semibold")}>{n.title}</span><span className="shrink-0 text-xs text-muted-foreground" title={n.createdAt}>{timeAgo(n.createdAt)}</span></span>
                  <span className="mt-0.5 line-clamp-3 block text-sm text-muted-foreground [overflow-wrap:anywhere]">{n.body}</span>
                  {href && <span className="mt-1 block text-xs font-medium text-primary">Open</span>}
                </span>
                {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
              </button>
              <button type="button" onClick={() => remove.mutate(n.id)} aria-label="Delete notification" className="pressable my-1 mr-1 flex size-11 shrink-0 items-center justify-center self-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring md:size-9 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"><Trash2 className="size-4" /></button>
            </li>
          );
        })}</ul>}
      <LoadMore query={q} />
      <p className="text-center text-xs text-muted-foreground">Choose what you get in <Link href="/account/profile#notifications" className="underline">Settings</Link>.</p>
    </div>
  );
}
