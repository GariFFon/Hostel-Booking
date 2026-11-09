import { cn } from "@/lib/utils";

/** Shimmer placeholder. Always give it the final layout's size so nothing jumps when content arrives. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("rounded-md bg-[linear-gradient(90deg,var(--muted)_25%,color-mix(in_oklab,var(--muted)_55%,var(--card))_50%,var(--muted)_75%)] bg-[length:200%_100%] motion-safe:animate-shimmer", className)}
      {...props}
    />
  );
}
