"use client";
import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useHydrated } from "@/hooks/use-hydrated";
import { useUser } from "@/lib/session/use-session";
import { cn } from "@/lib/utils";

const idsKey = ["wishlist", "ids"] as const;

/** One query for every heart on the page (search results are public and cached, so "saved" is layered on here). */
export function useWishlistIds() {
  const { user } = useUser();
  return useQuery({ queryKey: idsKey, enabled: !!user, staleTime: 60_000, queryFn: async () => (await unwrapData(api.GET("/me/wishlist/ids"))).hostelIds });
}

export function WishlistButton({ hostelId, className, variant = "overlay" }: { hostelId: string; className?: string; variant?: "overlay" | "plain" }) {
  const { user } = useUser();
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const { data: ids } = useWishlistIds();
  const hydrated = useHydrated();
  const saved = hydrated && !!ids?.includes(hostelId); // user-specific, client-fetched: never part of the hydration pass

  const toggle = useMutation({
    mutationFn: async (next: boolean) => next
      ? unwrapData(api.PUT("/me/wishlist/{hostelId}", { params: { path: { hostelId } } }))
      : unwrapData(api.DELETE("/me/wishlist/{hostelId}", { params: { path: { hostelId } } })),
    // Optimistic: the heart flips instantly (response, not release); roll back if the server says no.
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: idsKey });
      const prev = qc.getQueryData<string[]>(idsKey);
      qc.setQueryData<string[]>(idsKey, (cur = []) => (next ? [hostelId, ...cur.filter((x) => x !== hostelId)] : cur.filter((x) => x !== hostelId)));
      return { prev };
    },
    onError: (e, _n, ctx) => { qc.setQueryData(idsKey, ctx?.prev); toast.error(errorMessage(e)); },
    onSuccess: (_d, next) => {
      qc.invalidateQueries({ queryKey: ["wishlist", "list"] });
      toast(next ? "Saved to your list" : "Removed from your list", next ? { action: { label: "View", onClick: () => router.push("/account/wishlist") } } : undefined);
    },
  });

  function onClick(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation(); // the heart sits on top of a card that is itself a link
    if (!user) { router.push(`/login?next=${encodeURIComponent(path)}`); return; }
    toggle.mutate(!saved);
  }

  return (
    <button type="button" onClick={onClick} aria-pressed={saved} aria-label={saved ? "Remove from saved" : "Save this stay"}
      className={cn("pressable flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-10",
        variant === "overlay" ? "bg-background/85 text-foreground shadow-sm backdrop-blur-md hover:bg-background" : "hover:bg-muted", className)}>
      <Heart className={cn("size-5 transition-[transform,color,fill] duration-200 ease-out", saved ? "scale-110 fill-destructive text-destructive" : "text-foreground")} />
    </button>
  );
}
