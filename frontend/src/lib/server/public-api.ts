import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import createClient from "openapi-fetch";
import type { paths } from "@/lib/api/schema";
import { API_V1 } from "./config";

/**
 * Public (signed-out) reads for server components. Plain uncached requests: with Cache Components they stream in behind
 * <Suspense> at request time, so a page build never depends on the backend being up. The backend caches these in Redis anyway.
 * Failures return null so a section can degrade instead of taking the whole page down.
 */
const client = createClient<paths>({
  baseUrl: API_V1,
  fetch: (req) => fetch(new Request(req, { cache: "no-store", signal: AbortSignal.timeout(10_000) })),
});

async function safe<T>(call: () => Promise<{ data?: { data: T }; response: Response }>): Promise<T | null> {
  await connection(); // request-time data: tell Next this render is dynamic before any clock/network use
  try {
    const r = await call();
    return r.response.ok && r.data ? r.data.data : null;
  } catch {
    return null;
  }
}

export const getCities = cache(() => safe(() => client.GET("/cities")));
export const getTopRated = cache((limit = 8) => safe(() => client.GET("/hostels", { params: { query: { sort: "rating", limit } } })));
export const getHostel = cache((slug: string) => safe(() => client.GET("/hostels/{idOrSlug}", { params: { path: { idOrSlug: slug } } })));
export const getOffers = cache((slug: string) => safe(() => client.GET("/hostels/{idOrSlug}/offers", { params: { path: { idOrSlug: slug } } })));
export const getReviewSummary = cache((slug: string) => safe(() => client.GET("/hostels/{idOrSlug}/reviews/summary", { params: { path: { idOrSlug: slug } } })));
export const getReviews = cache((slug: string) => safe(() => client.GET("/hostels/{idOrSlug}/reviews", { params: { path: { idOrSlug: slug }, query: { limit: 6, sort: "recent" } } })));
