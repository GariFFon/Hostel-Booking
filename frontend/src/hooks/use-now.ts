"use client";
import { useSyncExternalStore } from "react";

/** One shared 1-second ticker for every countdown on the page (an external store, so no setState-in-effect). */
let snapshot: number | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) {
    snapshot = Date.now();
    timer = setInterval(() => { snapshot = Date.now(); listeners.forEach((l) => l()); }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) { clearInterval(timer); snapshot = null; }
  };
}

/** The current time in ms, ticking every second; `null` on the server and before mount, so nothing time-dependent is prerendered. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, () => snapshot, () => null);
}
