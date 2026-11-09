import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { ApiError } from "./errors";

export type Paths = paths;
export interface Meta { requestId: string; nextCursor?: string | null; total?: number }

/** The browser always talks to its own origin; /api/bff attaches the session and forwards to the backend. */
export const api = createClient<paths>({ baseUrl: "/api/bff" });

type Result<T> = { data?: { data: T; meta: Meta } | undefined; error?: unknown; response: Response };

/** Turns an openapi-fetch result into `{ data, meta }` or throws a typed ApiError. */
export async function unwrap<T>(p: Promise<Result<T>>): Promise<{ data: T; meta: Meta }> {
  let r: Result<T>;
  try {
    r = await p;
  } catch (e) {
    if (e instanceof TypeError) throw e; // network failure: shown as "can't reach the server"
    throw e;
  }
  if (r.response.ok && r.data) return r.data;
  const body = r.error as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | undefined;
  throw new ApiError(r.response.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? r.response.statusText ?? "Request failed", body?.error?.details ?? null, body?.error?.requestId);
}

/** Convenience for the many "just give me the data" call sites. */
export async function unwrapData<T>(p: Promise<Result<T>>): Promise<T> {
  return (await unwrap(p)).data;
}

/** One idempotency key per user action: reuse the SAME key on every retry of that action. */
export const newIdempotencyKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
