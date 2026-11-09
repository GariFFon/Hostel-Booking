"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarCheck, Heart, Star, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/account/bookings", label: "Trips", Icon: CalendarCheck }, { href: "/account/wishlist", label: "Saved", Icon: Heart },
  { href: "/account/reviews", label: "Reviews", Icon: Star }, { href: "/account/notifications", label: "Notifications", Icon: Bell }, { href: "/account/profile", label: "Settings", Icon: UserCog },
];

/** Desktop sub-navigation (phones use the bottom tab bar). */
export function AccountNav() {
  const path = usePathname();
  return (
    <nav aria-label="Account" className="hidden gap-1 border-b md:flex">
      {LINKS.map(({ href, label, Icon }) => {
        const active = path.startsWith(href);
        return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("pressable -mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium outline-none focus-visible:bg-muted", active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}><Icon className="size-4" />{label}</Link>;
      })}
    </nav>
  );
}
