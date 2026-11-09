"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Logo } from "@/components/common/logo";
import { UserMenu } from "./user-menu";
import { cn } from "@/lib/utils";

export interface NavItem { href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean; badge?: number }

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <ul className="grid gap-0.5">
      {items.map(({ href, label, icon: Icon, exact, badge }) => {
        const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
        return (
          <li key={href}>
            <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
              className={cn("pressable flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:min-h-10", active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              <Icon className="size-[18px] shrink-0" /><span className="min-w-0 flex-1 truncate">{label}</span>
              {!!badge && <span className="tnum rounded-full bg-primary px-1.5 text-[11px] leading-[18px] font-semibold text-primary-foreground">{badge}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Console layout for hosts and admins: persistent sidebar on desktop, a slide-in menu on phones. */
export function DashboardShell({ title, items, children }: { title: string; items: NavItem[]; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r bg-card/50 p-4 lg:flex">
        <div className="grid gap-1 px-1"><Logo /><span className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</span></div>
        <nav aria-label={title} className="flex-1 overflow-y-auto"><NavList items={items} /></nav>
        <Link href="/" className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground">← Back to the site</Link>
      </aside>
      <div className="min-w-0">
        <header className="safe-top sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-xl sm:px-6 lg:justify-end">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu"><Menu /></Button></SheetTrigger>
            <SheetContent side="left" className="p-4">
              <SheetTitle className="sr-only">{title} menu</SheetTitle><SheetDescription className="sr-only">Navigate the {title.toLowerCase()} area</SheetDescription>
              <div className="grid gap-1 px-1"><Logo /><span className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</span></div>
              <nav aria-label={title}><NavList items={items} onNavigate={() => setOpen(false)} /></nav>
              <Link href="/" className="mt-auto rounded-lg px-3 py-2 text-sm text-muted-foreground">← Back to the site</Link>
            </SheetContent>
          </Sheet>
          <span className="text-sm font-semibold lg:hidden">{title}</span>
          <div className="ml-auto lg:ml-0"><UserMenu /></div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}
