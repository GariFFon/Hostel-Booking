"use client";
import * as React from "react";
import { Select as S } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldClass } from "./input";

export const Select = S.Root;
export const SelectValue = S.Value;
export const SelectGroup = S.Group;

export function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof S.Trigger>) {
  return (
    <S.Trigger className={cn(fieldClass, "flex h-11 items-center justify-between gap-2 text-left whitespace-nowrap data-[placeholder]:text-muted-foreground md:h-10 [&>span]:truncate", className)} {...props}>
      {children}
      <S.Icon asChild><ChevronDown className="size-4 shrink-0 text-muted-foreground" /></S.Icon>
    </S.Trigger>
  );
}
export function SelectContent({ className, children, position = "popper", ...props }: React.ComponentProps<typeof S.Content>) {
  return (
    <S.Portal>
      <S.Content position={position} sideOffset={6} className={cn("z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] origin-[var(--radix-select-content-transform-origin)] overflow-hidden rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100", className)} {...props}>
        <S.Viewport>{children}</S.Viewport>
      </S.Content>
    </S.Portal>
  );
}
export function SelectItem({ className, children, ...props }: React.ComponentProps<typeof S.Item>) {
  return (
    <S.Item className={cn("relative flex min-h-10 cursor-default items-center rounded-lg py-2 pr-8 pl-2.5 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted", className)} {...props}>
      <S.ItemText>{children}</S.ItemText>
      <span className="absolute right-2.5 flex size-4 items-center justify-center"><S.ItemIndicator><Check className="size-4 text-primary" /></S.ItemIndicator></span>
    </S.Item>
  );
}
