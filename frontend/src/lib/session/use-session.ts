"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/errors";
import type { SessionUser } from "@/lib/api/types";

export type { SessionUser };
export type Role = "GUEST" | "OWNER" | "ADMIN";
export const sessionKey = ["session"] as const;

/** null = signed out. Everything that depends on "who am I" reads this one query. */
export async function fetchSession(): Promise<SessionUser | null> {
  const res = await fetch("/api/session", { credentials: "same-origin", headers: { accept: "application/json" } });
  if (!res.ok) throw new ApiError(res.status, "SESSION_UNAVAILABLE", "Could not check your session");
  return ((await res.json()) as { data: SessionUser | null }).data;
}

export function useSession() {
  return useQuery({ queryKey: sessionKey, queryFn: fetchSession, staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: true });
}

export function useUser() {
  const q = useSession();
  const user = q.data ?? null;
  return {
    user,
    isLoading: q.isPending,
    isAuthenticated: user !== null,
    hasRole: (...roles: Role[]) => !!user && roles.some((r) => user.roles.includes(r)),
  };
}

/** After any change to the session (login, logout, profile, role): one place that keeps caches honest. */
export function useSessionActions() {
  const qc = useQueryClient();
  return {
    setUser: (user: SessionUser | null) => qc.setQueryData(sessionKey, user),
    /** Sign-out and sign-in must never leak one user's cached data to the next. */
    reset: (user: SessionUser | null) => { qc.clear(); qc.setQueryData(sessionKey, user); },
    refresh: () => qc.invalidateQueries({ queryKey: sessionKey }),
  };
}
