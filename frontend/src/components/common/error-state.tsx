"use client";
import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

export function ErrorState({ error, onRetry, className, compact }: { error: unknown; onRetry?: () => void; className?: string; compact?: boolean }) {
  const requestId = isApiError(error) ? error.requestId : undefined;
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 px-6 text-center", compact ? "py-6" : "py-12", className)}>
      <AlertCircle className="size-6 text-destructive" aria-hidden />
      <div className="max-w-sm">
        <p className="font-medium">We couldn&apos;t load this</p>
        <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{errorMessage(error)}</p>
        {requestId && requestId !== "bff" && <p className="mt-2 font-mono text-[11px] text-muted-foreground/80">Ref {requestId.slice(0, 8)}</p>}
      </div>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}><RotateCw /> Try again</Button>}
    </div>
  );
}
