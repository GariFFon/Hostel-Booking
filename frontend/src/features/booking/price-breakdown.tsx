import { Info } from "lucide-react";
import { bps, money, plural } from "@/lib/format";
import type { Quote } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** Every rupee, itemised: room-nights, discount, GST, total. The total is the number the guest actually pays. */
export function PriceBreakdown({ quote, className }: { quote: Quote; className?: string }) {
  const special = quote.items.some((i) => i.nightly.some((n) => n.isSpecialPrice));
  return (
    <div className={cn("grid gap-2.5 text-sm", className)}>
      {quote.items.map((i) => {
        const avg = Math.round(i.lineSubtotalPaise / Math.max(1, i.units * quote.nights));
        return (
          <div key={i.roomTypeId} className="flex items-start justify-between gap-4">
            <span className="min-w-0 [overflow-wrap:anywhere]">{i.name} <span className="text-muted-foreground">× {i.units}</span><span className="tnum block text-xs text-muted-foreground">{money(avg)} × {plural(quote.nights, "night")}{i.units > 1 ? ` × ${i.units}` : ""}</span></span>
            <span className="tnum shrink-0">{money(i.lineSubtotalPaise)}</span>
          </div>
        );
      })}
      {quote.discountPaise > 0 && <div className="flex justify-between gap-4 text-success"><span>Discount{quote.coupon?.valid ? ` (${quote.coupon.code})` : ""}</span><span className="tnum">−{money(quote.discountPaise)}</span></div>}
      <div className="flex justify-between gap-4"><span>GST <span className="text-muted-foreground">({bps(quote.effectiveGstBps)})</span></span><span className="tnum">{money(quote.taxPaise)}</span></div>
      {quote.serviceFeePaise > 0 && <div className="flex justify-between gap-4"><span>Service fee</span><span className="tnum">{money(quote.serviceFeePaise)}</span></div>}
      <div className="flex items-baseline justify-between gap-4 border-t pt-3 text-base font-semibold"><span>Total</span><span className="tnum text-lg">{money(quote.totalPaise, { exact: true })}</span></div>
      {special && <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-px size-3.5 shrink-0" />Includes weekend or seasonal rates on some nights.</p>}
    </div>
  );
}
