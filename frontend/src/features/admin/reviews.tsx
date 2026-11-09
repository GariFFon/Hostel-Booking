"use client";
import * as React from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EyeOff, MessageSquareText, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { Stars } from "@/components/common/rating";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { timeAgo } from "@/lib/format";
import type { Item } from "@/lib/api/types";

type R = Item<"/admin/reviews">;

export function AdminReviews() {
  const qc = useQueryClient();
  const [status, setStatus] = React.useState<"PUBLISHED" | "HIDDEN">("PUBLISHED");
  const [hide, setHide] = React.useState<R | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["admin", "reviews", status], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/admin/reviews", { params: { query: { status, limit: 15, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const sync = () => qc.invalidateQueries({ queryKey: ["admin", "reviews"] });
  const doHide = useMutation({ mutationFn: (v: { id: string; reason: string }) => unwrapData(api.POST("/admin/reviews/{id}/hide", { params: { path: { id: v.id } }, body: { reason: v.reason } })), onSuccess: () => { sync(); toast.success("Review hidden. The guest was told why."); } });
  const restore = useMutation({ mutationFn: (id: string) => unwrapData(api.POST("/admin/reviews/{id}/restore", { params: { path: { id } } })), onSuccess: () => { sync(); toast.success("Review restored"); }, onError: (e) => toast.error((e as Error).message) });
  return (
    <div className="grid gap-6">
      <PageHeader title="Review moderation" description="Hide reviews that break the content rules. Hosts can report reviews: reports arrive as notifications." />
      <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)}><TabsList><TabsTrigger value="PUBLISHED">Published</TabsTrigger><TabsTrigger value="HIDDEN">Hidden</TabsTrigger></TabsList></Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /></div>
        : items.length === 0 ? <EmptyState icon={MessageSquareText} title="No reviews" />
        : <div className="grid gap-4">{items.map((r) => (
          <article key={r.id} className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold [overflow-wrap:anywhere]">{r.hostel.name}</p><p className="text-xs text-muted-foreground">{r.reviewer.name} · {r.guestEmail} · {timeAgo(r.createdAt)} · <span className="font-mono">{r.bookingCode}</span></p></div><StatusBadge status={r.status} /></div>
            <Stars value={r.overall} />
            {r.title && <p className="font-medium [overflow-wrap:anywhere]">{r.title}</p>}
            {r.comment && <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{r.comment}</p>}
            {r.ownerReply && <p className="rounded-lg bg-muted p-3 text-sm [overflow-wrap:anywhere]"><b>Host:</b> {r.ownerReply}</p>}
            {r.status === "HIDDEN" && <Alert tone="warning" title="Hidden">{r.moderationReason}</Alert>}
            <div>{r.status === "PUBLISHED" ? <Button size="sm" variant="outline" onClick={() => setHide(r)}><EyeOff />Hide</Button> : <Button size="sm" variant="outline" loading={restore.isPending} onClick={() => restore.mutate(r.id)}><Undo2 />Restore</Button>}</div>
          </article>
        ))}</div>}
      <LoadMore query={q} />
      <ConfirmDialog open={!!hide} onOpenChange={(o) => !o && setHide(null)} destructive title="Hide this review?" confirmLabel="Hide review" description="It leaves the property page and its rating is recalculated. The guest sees your reason." reason={{ label: "Reason", required: true, max: 500, placeholder: "e.g. Contains abusive language" }} onConfirm={(r) => doHide.mutateAsync({ id: hide!.id, reason: r })} />
    </div>
  );
}
