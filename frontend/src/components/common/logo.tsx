import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8", className)} aria-hidden>
      <rect width="64" height="64" rx="16" fill="var(--primary)" />
      <path d="M14 44V22m0 12h36m0 10V30a6 6 0 0 0-6-6H30v10" fill="none" stroke="var(--primary-foreground)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("pressable flex items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} aria-label="Hostel Booking home">
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight">Hostel Booking</span>
    </Link>
  );
}
