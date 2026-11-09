"use client";
import * as React from "react";
import { RadioGroup as R } from "radix-ui";
import { cn } from "@/lib/utils";

export const RadioGroup = ({ className, ...props }: React.ComponentProps<typeof R.Root>) => <R.Root className={cn("grid gap-2", className)} {...props} />;
export function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof R.Item>) {
  return (
    <R.Item className={cn("relative aspect-square size-5 shrink-0 rounded-full border border-input bg-card outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=checked]:border-primary before:absolute before:-inset-3 before:content-['']", className)} {...props}>
      <R.Indicator className="flex items-center justify-center"><span className="size-2.5 rounded-full bg-primary" /></R.Indicator>
    </R.Item>
  );
}
