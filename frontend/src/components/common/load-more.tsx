"use client";
import * as React from "react";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

/** Keyset pagination UI: loads the next page as the end comes into view, with a button as the always-works fallback. */
export function LoadMore({ query }: { query: Pick<UseInfiniteQueryResult, "hasNextPage" | "isFetchingNextPage" | "fetchNextPage" | "isFetchNextPageError"> }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isFetchNextPageError } = query;
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !hasNextPage || isFetchNextPageError) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage(); }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, isFetchNextPageError]);
  if (!hasNextPage && !isFetchNextPageError) return null;
  return <div ref={ref} className="py-6 text-center"><Button variant="outline" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>{isFetchNextPageError ? "Couldn't load more. Try again" : "Show more"}</Button></div>;
}
