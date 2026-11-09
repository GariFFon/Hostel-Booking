"use client";
import * as React from "react";
import { DropdownMenu as M } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuGroup = M.Group;

// Origin-aware: scales from the trigger (radix exposes it as a CSS variable), not from the centre.
const panel = "z-50 min-w-48 origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-hidden rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-100";
const item = "relative flex min-h-10 cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted data-[variant=destructive]:text-destructive [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

export function DropdownMenuContent({ className, sideOffset = 6, align = "end", ...props }: React.ComponentProps<typeof M.Content>) {
  return <M.Portal><M.Content sideOffset={sideOffset} align={align} className={cn(panel, className)} {...props} /></M.Portal>;
}
export function DropdownMenuItem({ className, variant, ...props }: React.ComponentProps<typeof M.Item> & { variant?: "destructive" }) {
  return <M.Item data-variant={variant} className={cn(item, className)} {...props} />;
}
export function DropdownMenuCheckboxItem({ className, children, checked, ...props }: React.ComponentProps<typeof M.CheckboxItem>) {
  return (
    <M.CheckboxItem checked={checked} className={cn(item, "pr-8", className)} {...props}>
      {children}
      <span className="absolute right-2.5 flex size-4 items-center justify-center"><M.ItemIndicator><Check className="!text-primary" /></M.ItemIndicator></span>
    </M.CheckboxItem>
  );
}
export const DropdownMenuLabel = ({ className, ...props }: React.ComponentProps<typeof M.Label>) => <M.Label className={cn("px-2.5 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />;
export const DropdownMenuSeparator = ({ className, ...props }: React.ComponentProps<typeof M.Separator>) => <M.Separator className={cn("-mx-1.5 my-1.5 h-px bg-border", className)} {...props} />;
