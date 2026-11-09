"use client";
import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Label + control + hint + inline error, wired for screen readers (aria-describedby / aria-invalid). */
export function FormField({ label, htmlFor, error, hint, required, className, children }: {
  label?: React.ReactNode; htmlFor?: string; error?: string; hint?: React.ReactNode; required?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      {label && <Label htmlFor={htmlFor}>{label}{required && <span className="text-destructive" aria-hidden> *</span>}</Label>}
      {children}
      {error ? <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="text-[13px] text-destructive">{error}</p>
        : hint ? <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-[13px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Spread onto an input so it announces its hint/error. */
export const describe = (id: string, error?: string, hint?: boolean) => ({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined });
