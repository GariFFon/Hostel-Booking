"use client";
import * as React from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { RatingBadge, Stars } from "@/components/common/rating";
import { api, unwrap } from "@/lib/api/client";
import { fmtDate, plural, timeAgo } from "@/lib/format";
import type { Data, Item } from "@/lib/api/types";

type Summary = Data<"/hostels/{idOrSlug}/reviews/summary">;
export type PublicReview = Item<"/hostels/{idOrSlug}/reviews">;
const CATS = [["cleanliness", "Cleanliness"], ["location", "Location"], ["staff", "Staff"], ["valueForMoney", "Value"]] as const;

export function ReviewCard({ r }: { r: PublicReview }) {
  const [more, setMore] = React.useState(false);
  const long = (r.comment?.length ?? 0) > 240;
  return (
    <article className="grid gap-2.5 border-b py-5 last:border-b-0">
      <div className="flex items-center gap-3">
        <Avatar name={r.reviewer.name} className="size-10" />
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{r.reviewer.name}</p><p className="text-xs text-muted-foreground">Stayed {fmtDate(`${r.stay.month}-01`, "month")} · {plural(r.stay.nights, "night")}</p></div>
        <span className="ml-auto text-xs text-muted-foreground" title={r.createdAt}>{timeAgo(r.createdAt)}{r.editedAt ? " · edited" : ""}</span>
      </div>
      <Stars value={r.overall} size="size-3.5" />
      {r.title && <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">{r.title}</h3>}
      {r.comment && (
        <>
          {/* user content is rendered as TEXT (React escapes it); whitespace is preserved for paragraphs */}
          <p className={`text-sm leading-relaxed whitespace-pre-line [overflow-wrap:anywhere] ${!more && long ? "line-clamp-4" : ""}`}>{r.comment}</p>
          {long && <button type="button" onClick={() => setMore((m) => !m)} className="w-fit text-sm font-medium underline-offset-4 hover:underline">{more ? "Show less" : "Read more"}</button>}
        </>
      )}
      {r.ownerReply && (
        <div className="mt-1 rounded-xl bg-muted p-3.5 text-sm">
          <p className="font-medium">Response from the host</p>
          <p className="mt-1 whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">{r.ownerReply}</p>
        </div>
      )}
    </article>
  );
}

export function ReviewsSection({ slug, summary }: { slug: string; summary: Summary | null }) {
  const [sort, setSort] = React.useState<"recent" | "highest" | "lowest">("recent");
  const [rating, setRating] = React.useState<number | undefined>();
  const q = useInfiniteQuery({
    queryKey: ["reviews", slug, sort, rating], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/hostels/{idOrSlug}/reviews", { params: { path: { idOrSlug: slug }, query: { sort, limit: 8, ...(rating ? { rating } : {}), ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const total = summary?.reviewCount ?? 0;
  if (summary && total === 0) return <EmptyState icon={MessageSquareText} title="No reviews yet" description="Be the first to stay and tell others what it was like." />;
  return (
    <div className="grid gap-6">
      {summary && (
        <div className="grid gap-6 md:grid-cols-[auto_1fr_1fr] md:items-center md:gap-10">
          <div><p className="tnum text-5xl font-semibold">{summary.avgRating.toFixed(1)}</p><Stars value={summary.avgRating} className="mt-1" /><p className="mt-1 text-sm text-muted-foreground">{plural(total, "review")}</p></div>
          <div className="grid gap-1.5" role="list" aria-label="Rating distribution">
            {[5, 4, 3, 2, 1].map((n) => {
              const c = summary.distribution[String(n) as "1"];
              return (
                <div key={n} role="listitem" aria-label={`${n} stars: ${plural(c, "review")}`} className="flex min-h-6 items-center gap-2 text-xs">
                  <span aria-hidden className="tnum w-3 text-right">{n}</span>
                  <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-star transition-[width] duration-300 ease-out" style={{ width: `${total ? (c / total) * 100 : 0}%` }} /></span>
                  <span aria-hidden className="tnum w-7 text-right text-muted-foreground">{c}</span>
                </div>
              );
            })}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {CATS.map(([k, label]) => summary.categories[k] != null && <div key={k}><dt className="text-muted-foreground">{label}</dt><dd className="tnum font-semibold">{summary.categories[k]!.toFixed(1)}</dd></div>)}
          </dl>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{rating ? `${rating}-star reviews` : "All reviews"}</p>
        <div className="flex gap-2">
          <Select value={rating ? String(rating) : "all"} onValueChange={(v) => setRating(v === "all" ? undefined : Number(v))}>
            <SelectTrigger className="h-10 w-auto min-w-32 md:h-9" aria-label="Filter by rating"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All ratings</SelectItem>{[5, 4, 3, 2, 1].map((n) => <SelectItem key={n} value={String(n)}>{n} stars</SelectItem>)}</SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
            <SelectTrigger className="h-10 w-auto min-w-36 md:h-9" aria-label="Sort reviews"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="recent">Most recent</SelectItem><SelectItem value="highest">Highest rated</SelectItem><SelectItem value="lowest">Lowest rated</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      {q.isError ? <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-4" aria-hidden>{Array.from({ length: 3 }, (_, i) => <div key={i} className="h-28 rounded-xl bg-muted motion-safe:animate-pulse" />)}</div>
        : items.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No reviews with this rating.</p>
        : <div>{items.map((r) => <ReviewCard key={r.id} r={r} />)}</div>}
      {q.hasNextPage && <div className="text-center"><Button variant="outline" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Show more reviews</Button></div>}
    </div>
  );
}
export { RatingBadge };
