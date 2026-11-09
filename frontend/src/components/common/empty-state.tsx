import { cn } from "@/lib/utils";

/** Zero-item state: says what is missing and what to do about it. */
export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: React.ComponentType<{ className?: string }>; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-card/50 px-6 py-14 text-center", className)}>
      {Icon && <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon className="size-6" /></div>}
      <div className="max-w-sm">
        <p className="font-medium">{title}</p>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
