"use client";
import * as React from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag, MessageSquareReply, MessageSquareText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { FormField } from "@/components/common/form-field";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Stars } from "@/components/common/rating";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { fmtDate, timeAgo } from "@/lib/format";
import type { Item } from "@/lib/api/types";

type R = Item<"/owner/reviews">;
const TABS = [["false", "To answer"], ["true", "Answered"], ["all", "All"]] as const;

function ReplyDialog({ review, onClose }: { review: R; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = React.useState(review.ownerReply ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => unwrapData(api.PUT("/owner/reviews/{id}/reply", { params: { path: { id: review.id } }, body: { text: text.trim() } })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["owner", "reviews"] }); toast.success("Reply posted"); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={review.ownerReply ? "Edit your reply" : "Reply to this review"} description="Replies are public. Be kind and specific, and thank guests for their feedback." className="sm:max-w-lg" dismissible={!save.isPending}>
      <div className="grid gap-3">
        <div className="rounded-xl bg-muted p-3.5 text-sm"><Stars value={review.overall} size="size-3.5" />{review.comment && <p className="mt-1.5 line-clamp-4 [overflow-wrap:anywhere]">{review.comment}</p>}</div>
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label="Your reply" htmlFor="reply" hint={`${text.length}/1000`}><Textarea id="reply" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={5} autoFocus /></FormField>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button loading={save.isPending} disabled={!text.trim()} onClick={() => { setError(null); save.mutate(); }}>Post reply</Button></div>
      </div>
    </ResponsiveDialog>
  );
}

export function OwnerReviews() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<(typeof TABS)[number][0]>("false");
  const [reply, setReply] = React.useState<R | null>(null);
  const [report, setReport] = React.useState<R | null>(null);
  const [unreply, setUnreply] = React.useState<R | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["owner", "reviews", tab], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/owner/reviews", { params: { query: { limit: 10, status: "PUBLISHED", ...(tab !== "all" ? { replied: tab } : {}), ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const sync = () => qc.invalidateQueries({ queryKey: ["owner", "reviews"] });
  const removeReply = useMutation({ mutationFn: (id: string) => unwrapData(api.DELETE("/owner/reviews/{id}/reply", { params: { path: { id } } })), onSuccess: () => { sync(); toast.success("Reply removed"); } });
  const doReport = useMutation({ mutationFn: (v: { id: string; reason: string }) => unwrapData(api.POST("/owner/reviews/{id}/report", { params: { path: { id: v.id } }, body: { reason: v.reason } })), onSuccess: () => toast.success("Reported. Our moderators will take a look.") });

  return (
    <div className="grid gap-6">
      <PageHeader title="Reviews" description="Reply to guests publicly. You can't hide a review, but you can ask moderators to look at one that breaks the rules." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}><TabsList>{TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}</TabsList></Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3"><Skeleton className="h-36 rounded-2xl" /><Skeleton className="h-36 rounded-2xl" /></div>
        : items.length === 0 ? <EmptyState icon={MessageSquareText} title={tab === "false" ? "No reviews waiting for a reply" : "No reviews yet"} description="Reviews appear here after guests complete their stays." />
        : <div className="grid gap-4">{items.map((r) => (
          <article key={r.id} className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold [overflow-wrap:anywhere]">{r.reviewer.name}</p><p className="text-xs text-muted-foreground">{r.hostel.name} · stayed {fmtDate(`${r.stay.month}-01`, "month")} · {timeAgo(r.createdAt)} · <span className="font-mono">{r.bookingCode}</span></p></div><StatusBadge status={r.status} /></div>
            <Stars value={r.overall} />
            {r.title && <p className="font-medium [overflow-wrap:anywhere]">{r.title}</p>}
            {r.comment && <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{r.comment}</p>}
            {r.ownerReply && <div className="rounded-xl bg-muted p-3.5 text-sm"><p className="font-medium">Your reply</p><p className="mt-1 whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">{r.ownerReply}</p></div>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={r.ownerReply ? "outline" : "default"} onClick={() => setReply(r)}><MessageSquareReply />{r.ownerReply ? "Edit reply" : "Reply"}</Button>
              {r.ownerReply && <Button size="sm" variant="ghost" onClick={() => setUnreply(r)}><Trash2 />Remove reply</Button>}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setReport(r)}><Flag />Report</Button>
            </div>
          </article>
        ))}</div>}
      <LoadMore query={q} />
      {reply && <ReplyDialog review={reply} onClose={() => setReply(null)} />}
      <ConfirmDialog open={!!unreply} onOpenChange={(o) => !o && setUnreply(null)} destructive title="Remove your reply?" confirmLabel="Remove reply" onConfirm={() => removeReply.mutateAsync(unreply!.id)} />
      <ConfirmDialog open={!!report} onOpenChange={(o) => !o && setReport(null)} title="Report this review" confirmLabel="Send report" description="Tell moderators what's wrong, for example abuse, personal details, or a stay that never happened. You can report each review once." reason={{ label: "What's the problem?", required: true, max: 500 }} onConfirm={(reason) => doReport.mutateAsync({ id: report!.id, reason })} />
    </div>
  );
}
