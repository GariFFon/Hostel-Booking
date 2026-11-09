"use client";
import * as React from "react";
import { Tooltip as T } from "radix-ui";
import { cn } from "@/lib/utils";

// delayDuration only before the FIRST tooltip; skipDelayDuration makes neighbours instant (emil: skip delay on subsequent hovers).
export const TooltipProvider = ({ children }: { children: React.ReactNode }) => <T.Provider delayDuration={350} skipDelayDuration={400}>{children}</T.Provider>;
export const Tooltip = T.Root;
export const TooltipTrigger = T.Trigger;
export function TooltipContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof T.Content>) {
  return (
    <T.Portal>
      <T.Content sideOffset={sideOffset} className={cn("z-50 max-w-xs origin-[var(--radix-tooltip-content-transform-origin)] rounded-lg bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=delayed-open]:duration-125 data-[state=instant-open]:animate-none", className)} {...props} />
    </T.Portal>
  );
}
