"use client";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { RatingBadge } from "@/components/common/rating";
import { WishlistButton } from "@/features/wishlist/wishlist-button";
import { api, unwrap } from "@/lib/api/client";
import { money } from "@/lib/format";

export function WishlistList() {
  const q = useInfiniteQuery({
    queryKey: ["wishlist", "list"], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/me/wishlist", { params: { query: { limit: 12, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="grid gap-6">
      <PageHeader title="Saved stays" description="Places you want to come back to." />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={Heart} title="Nothing saved yet" description="Tap the heart on any stay to keep it here." action={<Button asChild><Link href="/search">Explore stays</Link></Button>} />
        : <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">{items.map(({ hostel: h }) => (
          <article key={h.id} className="group relative">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-muted">{h.coverUrl &&   <img src={h.coverUrl} alt={h.name} loading="lazy" className="size-full object-cover" />}<div className="absolute top-2.5 right-2.5"><WishlistButton hostelId={h.id} /></div></div>
            <Link href={`/hostels/${h.slug}`} className="mt-3 block rounded-md outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex items-start justify-between gap-3"><h3 className="line-clamp-1 font-semibold [overflow-wrap:anywhere]">{h.name}</h3><RatingBadge rating={h.avgRating} count={h.reviewCount} className="shrink-0" /></div>
              <p className="line-clamp-1 text-sm text-muted-foreground">{[h.locality, h.city].filter(Boolean).join(", ")}</p>
              <p className="tnum mt-1 text-[15px]">{h.fromPricePaise === null ? "Price on request" : <><span className="text-muted-foreground">From </span><b>{money(h.fromPricePaise)}</b><span className="text-muted-foreground"> / night</span></>}</p>
            </Link>
          </article>
        ))}</div>}
      <LoadMore query={q} />
    </div>
  );
}
