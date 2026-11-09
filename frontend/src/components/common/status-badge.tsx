import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/format";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "outline";
const MAP: Record<string, { tone: Tone; label?: string }> = {
  // bookings
  PENDING_PAYMENT: { tone: "warning", label: "Awaiting payment" }, PENDING_APPROVAL: { tone: "warning", label: "Awaiting host" }, HOLD: { tone: "warning" },
  CONFIRMED: { tone: "success" }, CHECKED_IN: { tone: "info", label: "Checked in" }, COMPLETED: { tone: "neutral" }, EXPIRED: { tone: "outline" },
  CANCELLED_BY_GUEST: { tone: "outline", label: "Cancelled" }, CANCELLED_BY_OWNER: { tone: "danger", label: "Cancelled by host" }, REJECTED: { tone: "danger", label: "Declined" }, NO_SHOW: { tone: "danger", label: "No-show" },
  // listings / kyc / reviews / coupons
  DRAFT: { tone: "neutral" }, PENDING_REVIEW: { tone: "warning", label: "In review" }, APPROVED: { tone: "success", label: "Live" }, SUSPENDED: { tone: "danger" },
  NOT_SUBMITTED: { tone: "neutral", label: "Not submitted" }, PENDING: { tone: "warning" },
  PUBLISHED: { tone: "success" }, HIDDEN: { tone: "danger" },
  ACTIVE: { tone: "success" }, SCHEDULED: { tone: "info" }, EXHAUSTED: { tone: "warning" }, DISABLED: { tone: "outline" },
  // payments / refunds
  CREATED: { tone: "neutral" }, CAPTURED: { tone: "success", label: "Paid" }, FAILED: { tone: "danger" }, PARTIALLY_REFUNDED: { tone: "info", label: "Partly refunded" }, REFUNDED: { tone: "info" }, PROCESSED: { tone: "success" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const m = MAP[status] ?? { tone: "neutral" as Tone };
  return <Badge tone={m.tone} className={className}>{m.label ?? titleCase(status)}</Badge>;
}
