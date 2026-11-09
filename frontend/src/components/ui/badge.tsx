import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// nowrap + shrink-0: a badge never wraps onto two lines or gets squeezed by a long neighbour (break-ui).
export const badgeVariants = cva("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "border-transparent bg-secondary text-secondary-foreground",
      primary: "border-transparent bg-accent text-accent-foreground",
      success: "border-transparent bg-success/12 text-success",
      warning: "border-transparent bg-warning/14 text-warning",
      danger: "border-transparent bg-destructive/12 text-destructive",
      info: "border-transparent bg-info/12 text-info",
      outline: "border-border text-muted-foreground",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}
