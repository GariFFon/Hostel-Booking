"use client";
import { useSyncExternalStore } from "react";

/** SSR-safe media query (server snapshot is `false`, so the mobile layout is what first paints). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
export const useIsDesktop = () => useMediaQuery("(min-width: 768px)");
