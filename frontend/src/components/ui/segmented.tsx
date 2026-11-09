"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A segmented filter (All / Upcoming / Past…). Looks like Tabs, but it is a radio group: these switch a LIST's filter,
 * they don't reveal separate panels, so tab semantics (aria-controls to a panel) would point at nothing.
 */
interface Ctx { value: string; set: (v: string) => void }
const SegCtx = React.createContext<Ctx | null>(null);

export function Segmented({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) {
  return <SegCtx value={{ value, set: onValueChange }}>{children}</SegCtx>;
}

export function SegmentedList({ className, children, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null);
  // Arrow keys move between options, like a native radio group.
  function onKey(e: React.KeyboardEvent) {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    const i = items.findIndex((b) => b === document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = items[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]!;
    next.focus(); next.click();
  }
  return <div ref={ref} role="radiogroup" onKeyDown={onKey} className={cn("inline-flex h-10 max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-muted p-1 [scrollbar-width:none]", className)} {...props}>{children}</div>;
}

export function SegmentedItem({ value, className, ...props }: { value: string } & Omit<React.ComponentProps<"button">, "value">) {
  const ctx = React.useContext(SegCtx)!;
  const active = ctx.value === value;
  return (
    <button type="button" role="radio" aria-checked={active} tabIndex={active ? 0 : -1} onClick={() => ctx.set(value)}
      className={cn("pressable inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap outline-none transition-[color,background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground", className)} {...props} />
  );
}
