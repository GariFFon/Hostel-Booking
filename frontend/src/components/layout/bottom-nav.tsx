"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarCheck, Compass, Heart, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/hooks/use-hydrated";
import { useUnreadCount } from "./notification-bell";

const TABS = [
  { href: "/search", label: "Explore", Icon: Compass, match: (p: string) => p === "/" || p.startsWith("/search") || p.startsWith("/hostels") },
  { href: "/account/wishlist", label: "Saved", Icon: Heart, match: (p: string) => p.startsWith("/account/wishlist") },
  { href: "/account/bookings", label: "Trips", Icon: CalendarCheck, match: (p: string) => p.startsWith("/account/bookings") },
  { href: "/account/notifications", label: "Inbox", Icon: Bell, match: (p: string) => p.startsWith("/account/notifications") },
  { href: "/account/profile", label: "Profile", Icon: User, match: (p: string) => p.startsWith("/account/profile") || p.startsWith("/account/reviews") },
];

/** Phone-only tab bar: thumb-reachable, safe-area aware, 44px+ targets. Hidden on desktop. */
export function BottomNav() {
  const path = usePathname();
  const { data } = useUnreadCount();
  const hydrated = useHydrated();
  const unread = hydrated ? data : 0; // client-fetched: not part of the hydration pass (this section streams in late on dynamic routes)
  return (
    <nav aria-label="Primary" className="tabbar safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 backdrop-blur-xl backdrop-saturate-150 md:hidden">
      <ul className="mx-auto flex h-16 max-w-md items-stretch justify-around">
        {TABS.map(({ href, label, Icon, match }) => {
          const active = match(path);
          return (
            <li key={href} className="flex-1">
              <Link href={href} aria-current={active ? "page" : undefined} className={cn("pressable relative flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none focus-visible:bg-muted", active ? "text-primary" : "text-muted-foreground")}>
                <span className="relative">
                  <Icon className={cn("size-6 transition-transform duration-200 ease-out", active && "scale-105")} strokeWidth={active ? 2.4 : 1.9} />
                  {label === "Inbox" && !!unread && <span className="absolute -top-0.5 -right-1 size-2.5 rounded-full bg-primary ring-2 ring-background" aria-label={`${unread} unread`} />}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
