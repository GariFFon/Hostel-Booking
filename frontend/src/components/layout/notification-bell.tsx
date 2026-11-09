"use client";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, unwrapData } from "@/lib/api/client";
import { useHydrated } from "@/hooks/use-hydrated";
import { useUser } from "@/lib/session/use-session";

export const unreadKey = ["notifications", "unread"] as const;

/** Polls a cheap count endpoint once a minute (and on focus). Hidden when signed out. */
export function useUnreadCount() {
  const { user } = useUser();
  return useQuery({
    queryKey: unreadKey, enabled: !!user, refetchInterval: 60_000, refetchOnWindowFocus: true, staleTime: 20_000,
    queryFn: async () => (await unwrapData(api.GET("/me/notifications/unread-count"))).unread,
  });
}

export function NotificationBell() {
  const { user } = useUser();
  const { data } = useUnreadCount();
  const hydrated = useHydrated();
  if (!hydrated || !user) return null;
  const n = data ?? 0;
  return (
    <Link href="/account/notifications" className="pressable relative hidden size-10 items-center justify-center rounded-full text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:flex" aria-label={n ? `Notifications, ${n} unread` : "Notifications"}>
      <Bell className="size-5" />
      {n > 0 && <span className="tnum absolute top-1 right-0.5 flex min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-[18px] font-semibold text-primary-foreground ring-2 ring-background">{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}
