"use client";
import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DialogOverlay } from "./dialog";

/** Side panel (nav menu, filters on desktop). Enters and exits along the SAME edge (spatial consistency). */
export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetTitle = ({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) => <SheetPrimitive.Title className={cn("text-lg leading-tight font-semibold", className)} {...props} />;
export const SheetDescription = ({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) => <SheetPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;

const sides = {
  right: "inset-y-0 right-0 w-[min(92vw,26rem)] border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
  left: "inset-y-0 left-0 w-[min(88vw,20rem)] border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
};

export function SheetContent({ className, side = "right", children, ...props }: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: keyof typeof sides }) {
  return (
    <SheetPrimitive.Portal>
      <DialogOverlay />
      <SheetPrimitive.Content
        className={cn("safe-top safe-bottom fixed z-50 flex flex-col gap-4 overflow-y-auto overscroll-contain bg-popover p-5 text-popover-foreground shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:duration-300 data-[state=open]:ease-[var(--ease-drawer)] data-[state=closed]:animate-out data-[state=closed]:duration-200", sides[side], className)}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="pressable absolute top-3 right-3 flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close">
          <X className="size-4" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
