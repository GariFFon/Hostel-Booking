"use client";
import * as React from "react";
import { QueryCache, QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isApiError } from "@/lib/api/errors";

const PROTECTED = ["/account", "/owner", "/admin", "/checkout"];

/** A 401 anywhere means the session is gone: go to sign-in and come back afterwards. */
function onUnauthenticated(e: unknown) {
  if (!isApiError(e) || e.status !== 401 || typeof window === "undefined") return;
  const path = window.location.pathname;
  // A hard navigation on purpose: a dead session must not leave stale per-user data in memory.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  if (PROTECTED.some((p) => path.startsWith(p))) window.location.assign(`/login?next=${encodeURIComponent(path + window.location.search)}`);
}

function makeClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: onUnauthenticated }),
    mutationCache: new MutationCache({ onError: onUnauthenticated }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // 4xx will not get better by asking again; network blips and 5xx might.
        retry: (n, e) => (isApiError(e) ? e.status >= 500 && n < 2 : n < 2),
      },
    },
  });
}

function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={(resolvedTheme as "light" | "dark" | undefined) ?? "system"}
      position="bottom-center"
      offset={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 88px)" }}
      mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 88px)" }}
      toastOptions={{ classNames: { toast: "!rounded-xl !border-border !bg-popover !text-popover-foreground !shadow-lg", description: "!text-muted-foreground" } }}
    />
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(makeClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
