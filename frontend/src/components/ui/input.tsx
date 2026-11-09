import * as React from "react";
import { cn } from "@/lib/utils";

// 16px on touch (iOS zooms inputs below it); 14px on fine pointers. Set globally in globals.css.
const field = "w-full min-w-0 rounded-lg border border-input bg-card px-3 text-foreground shadow-xs transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(field, "h-11 md:h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(field, "min-h-24 resize-y py-2.5 leading-relaxed", className)} {...props} />;
}

export { field as fieldClass };
