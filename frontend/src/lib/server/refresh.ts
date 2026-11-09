import "server-only";
import { backend, readEnvelope, type Tokens } from "./backend";

/**
 * Token refresh, single-flight.
 *
 * The backend ROTATES refresh tokens and treats reuse of an old one as theft (it revokes the whole family and the
 * user is signed out everywhere). A page fires several requests at once, all carrying the same (old) refresh cookie,
 * so naive "refresh on 401" would trip that alarm. Rules:
 *   1. concurrent callers with the same refresh token share ONE backend call;
 *   2. the result is remembered for a short grace period, because requests that were already in flight carry the old
 *      cookie and arrive after the first refresh finished. They get the new tokens instead of replaying the old one.
 * (In-process memory: with several Node instances, put the BFF behind sticky sessions or share this with Redis.)
 */
const GRACE_MS = 20_000;
const memo = new Map<string, Promise<Tokens | null>>();

export function refreshSession(refreshToken: string): Promise<Tokens | null> {
  const existing = memo.get(refreshToken);
  if (existing) return existing;

  const p = (async (): Promise<Tokens | null> => {
    const res = await backend("auth/refresh", { method: "POST", contentType: "application/json", body: JSON.stringify({ refreshToken }) });
    if (res.status === 401 || res.status === 403 || res.status === 422) return null; // invalid / expired / revoked: the user must sign in again
    if (!res.ok) throw new Error(`refresh failed with HTTP ${res.status}`); // 5xx / rate limit: transient, do not sign the user out
    const { data } = await readEnvelope<Tokens>(res);
    if (!data?.accessToken) throw new Error("refresh returned no tokens");
    return data;
  })();

  memo.set(refreshToken, p);
  p.then(
    () => { setTimeout(() => memo.delete(refreshToken), GRACE_MS).unref?.(); },
    () => { memo.delete(refreshToken); }, // transient failure: let the next request try again
  );
  return p;
}

/** Test seam. */
export const _resetRefreshMemo = () => memo.clear();
