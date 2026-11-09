"use client";
import { useSyncExternalStore } from "react";

/** The current year without making the page "unstable" for prerendering: server shows a fixed value, the browser corrects it. */
export function Year() {
  const year = useSyncExternalStore(() => () => {}, () => String(new Date().getFullYear()), () => "2026");
  return <span suppressHydrationWarning>{year}</span>;
}
