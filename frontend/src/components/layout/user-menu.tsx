"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CalendarCheck, Heart, LayoutDashboard, LogOut, Settings, ShieldCheck, Star } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useHydrated } from "@/hooks/use-hydrated";
import { useSessionActions, useUser } from "@/lib/session/use-session";

export function UserMenu() {
  const { user, isLoading, hasRole } = useUser();
  const hydrated = useHydrated();
  const { reset } = useSessionActions();
  const router = useRouter();

  async function logout() {
    try {
      await unwrap(api.POST("/auth/logout", { body: { refreshToken: "-" } })); // the BFF reads the real token from its cookie
    } catch (e) {
      toast.error(errorMessage(e));
    }
    reset(null);
    router.push("/");
    router.refresh();
  }

  if (!hydrated || isLoading) return <Skeleton className="size-10 rounded-full" />;
  if (!user) {
    return (
      <div className="flex items-center gap-1.5">
        <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><Link href="/login">Sign in</Link></Button>
        <Button asChild size="sm"><Link href="/register">Sign up</Link></Button>
      </div>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="pressable flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-10" aria-label="Account menu">
          <Avatar src={user.avatarUrl} name={user.fullName ?? user.email} className="size-9" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel className="px-2.5 py-2">
          <span className="block truncate text-sm font-semibold text-foreground">{user.fullName || "Welcome"}</span>
          <span className="block truncate text-xs font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/account/bookings"><CalendarCheck /> My trips</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/account/wishlist"><Heart /> Saved</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/account/notifications"><Bell /> Notifications</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/account/reviews"><Star /> My reviews</Link></DropdownMenuItem>
        {(hasRole("OWNER") || hasRole("ADMIN")) && <DropdownMenuSeparator />}
        {hasRole("OWNER") && <DropdownMenuItem asChild><Link href="/owner"><LayoutDashboard /> Host dashboard</Link></DropdownMenuItem>}
        {hasRole("ADMIN") && <DropdownMenuItem asChild><Link href="/admin"><ShieldCheck /> Admin</Link></DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/account/profile"><Settings /> Account settings</Link></DropdownMenuItem>
        <div className="flex items-center justify-between px-2.5 py-1.5 text-sm"><span>Theme</span><ThemeToggle /></div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout} variant="destructive"><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
