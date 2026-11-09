"use client";
import * as React from "react";
import Link from "next/link";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { Stars } from "@/components/common/rating";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { Item } from "@/lib/api/types";
import { ReviewDialog } from "./review-dialog";

type R = Item<"/me/reviews">;

export function MyReviews() {
  const qc = useQueryClient();
  const [edit, setEdit] = React.useState<R | null>(null);
  const [del, setDel] = React.useState<R | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["reviews", "mine"], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/me/reviews", { params: { query: { limit: 10, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const remove = useMutation({
    mutationFn: (id: string) => unwrapData(api.DELETE("/reviews/{id}", { params: { path: { id } } })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reviews"] }); qc.invalidateQueries({ queryKey: ["booking"] }); toast.success("Review deleted"); },
  });
  return (
    <div className="grid gap-6">
      <PageHeader title="Your reviews" description="What you've told other travellers." />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3"><Skeleton className="h-36 rounded-2xl" /><Skeleton className="h-36 rounded-2xl" /></div>
        : items.length === 0 ? <EmptyState icon={MessageSquareText} title="No reviews yet" description="After a stay ends you can review it from the trip page." action={<Button asChild variant="outline"><Link href="/account/bookings">Your trips</Link></Button>} />
        : <div className="grid gap-4">{items.map((r) => (
          <article key={r.id} className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><Link href={`/hostels/${r.hostel.slug}`} className="font-semibold [overflow-wrap:anywhere] hover:underline">{r.hostel.name}</Link><p className="text-xs text-muted-foreground">Stayed {fmtDate(`${r.stay.month}-01`, "month")} · posted {fmtDateTime(r.createdAt, true)}{r.editedAt ? " · edited" : ""}</p></div>
              <StatusBadge status={r.status} />
            </div>
            <Stars value={r.overall} />
            {r.title && <p className="font-medium [overflow-wrap:anywhere]">{r.title}</p>}
            {r.comment && <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{r.comment}</p>}
            {r.status === "HIDDEN" && <Alert tone="warning" title="Hidden by our moderators">{r.moderationReason ?? "This review broke our content rules."}</Alert>}
            {r.ownerReply && <div className="rounded-xl bg-muted p-3.5 text-sm"><p className="font-medium">Reply from the host</p><p className="mt-1 whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">{r.ownerReply}</p></div>}
            <div className="flex flex-wrap items-center gap-2">
              {r.editable ? <><Button variant="outline" size="sm" onClick={() => setEdit(r)}><Pencil />Edit</Button><Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDel(r)}><Trash2 />Delete</Button>
                {r.editableUntil && <span className="text-xs text-muted-foreground">You can edit until {fmtDateTime(r.editableUntil)}</span>}</>
                : r.status === "PUBLISHED" && <span className="text-xs text-muted-foreground">{r.ownerReply ? "Locked because the host replied." : "The editing window has closed."}</span>}
            </div>
          </article>
        ))}</div>}
      <LoadMore query={q} />
      {edit && <ReviewDialog reviewId={edit.id} initial={{ overall: edit.overall, cleanliness: edit.cleanliness, location: edit.location, staff: edit.staff, valueForMoney: edit.valueForMoney, title: edit.title ?? "", comment: edit.comment ?? "" }} open onOpenChange={(o) => !o && setEdit(null)} />}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} destructive title="Delete this review?" description="It will disappear from the property page and its rating will be recalculated." confirmLabel="Delete review" onConfirm={() => remove.mutateAsync(del!.id)} />
    </div>
  );
}
