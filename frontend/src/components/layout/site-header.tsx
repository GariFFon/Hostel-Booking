import Link from "next/link";
import { Suspense } from "react";
import { Search } from "lucide-react";
import { Logo } from "@/components/common/logo";
import { NotificationBell } from "./notification-bell";
import { UserMenu } from "./user-menu";

/** Translucent chrome with content scrolling beneath it (apple-design: materials, not opaque bars). */
export function SiteHeader() {
  return (
    <header className="safe-top sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
          <Link href="/search" className="pressable rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">Explore</Link>
          <Link href="/host" className="pressable rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">List your property</Link>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Link href="/search" className="pressable flex size-11 items-center justify-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:hidden" aria-label="Search stays"><Search className="size-5" /></Link>
          <Suspense><NotificationBell /></Suspense>
          <Suspense><UserMenu /></Suspense>
        </div>
      </div>
    </header>
  );
}
