import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const variants = cva("flex items-start gap-3 rounded-xl border p-3.5 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0", {
  variants: {
    tone: {
      info: "border-info/25 bg-info/8 text-foreground [&>svg]:text-info",
      success: "border-success/25 bg-success/8 text-foreground [&>svg]:text-success",
      warning: "border-warning/30 bg-warning/10 text-foreground [&>svg]:text-warning",
      danger: "border-destructive/30 bg-destructive/8 text-foreground [&>svg]:text-destructive",
    },
  },
  defaultVariants: { tone: "info" },
});
const icons = { info: Info, success: CheckCircle2, warning: TriangleAlert, danger: AlertCircle };

export function Alert({ tone = "info", title, children, className, ...props }: Omit<React.ComponentProps<"div">, "title"> & VariantProps<typeof variants> & { title?: React.ReactNode }) {
  const Icon = icons[tone ?? "info"];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn(variants({ tone }), className)} {...props}>
      <Icon aria-hidden />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-0.5 text-muted-foreground")}>{children}</div>}
      </div>
    </div>
  );
}
