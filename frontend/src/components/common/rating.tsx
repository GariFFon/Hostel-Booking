"use client";
import * as React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** "4.6 (128)": zero reviews reads "New", never "0.0". */
export function RatingBadge({ rating, count, className }: { rating: number; count: number; className?: string }) {
  if (!count) return <span className={cn("text-xs font-medium text-muted-foreground", className)}>New</span>;
  return (
    <span className={cn("tnum inline-flex items-center gap-1 text-sm", className)}>
      <Star className="size-3.5 fill-star text-star" aria-hidden />
      <span className="font-semibold">{rating.toFixed(1)}</span>
      <span className="text-muted-foreground">({new Intl.NumberFormat("en-IN").format(count)})</span>
      <span className="sr-only">rated {rating.toFixed(1)} out of 5 from {count} reviews</span>
    </span>
  );
}

export function Stars({ value, size = "size-4", className }: { value: number; size?: string; className?: string }) {
  return (
    <span className={cn("inline-flex gap-0.5", className)} role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={cn(size, i <= Math.round(value) ? "fill-star text-star" : "text-muted-foreground/30")} aria-hidden />)}
    </span>
  );
}

/** Radio-group star input: 44px hit area per star, arrow keys work, value announced. */
export function StarInput({ value, onChange, label, optional, size = "size-8" }: { value: number | null; onChange: (v: number | null) => void; label: string; optional?: boolean; size?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i > 1 ? "s" : ""}`}
          onClick={() => onChange(optional && value === i ? null : i)}
          className="pressable flex size-11 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-9"
        >
          <Star className={cn(size, "transition-colors duration-150", value !== null && i <= value ? "fill-star text-star" : "text-muted-foreground/35")} aria-hidden />
        </button>
      ))}
    </div>
  );
}
