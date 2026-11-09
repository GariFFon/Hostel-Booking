import { cn } from "@/lib/utils";

export function StatCard({ label, value, hint, icon: Icon, tone, href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; tone?: "warning" | "success"; href?: string }) {
  const body = (
    <div className={cn("flex h-full items-start justify-between gap-3 rounded-2xl border bg-card p-4 sm:p-5", href && "pressable transition-colors hover:bg-muted/40", tone === "warning" && "border-warning/40 bg-warning/5")}>
      <div className="min-w-0"><p className="text-sm text-muted-foreground">{label}</p><p className="tnum mt-1 text-2xl font-semibold">{value}</p>{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div>
      {Icon && <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Icon className="size-5" /></span>}
    </div>
  );
  return href ? <a href={href} className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</a> : body;
}
