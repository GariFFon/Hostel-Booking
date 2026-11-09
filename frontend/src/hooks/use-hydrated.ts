"use client";
import { useSyncExternalStore } from "react";

/**
 * `false` for the server render AND for the hydration pass, `true` afterwards.
 * Anything whose output depends on client-only async state (who is signed in, what is saved) must wait for this:
 * streamed sections can hydrate AFTER shared queries have already resolved, and rendering that state during hydration
 * would not match the server HTML.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(() => () => {}, () => true, () => false);
}
