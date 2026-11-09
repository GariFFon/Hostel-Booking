import type { Metadata } from "next";
import Link from "next/link";
import { BadgeIndianRupee, CalendarCheck, LineChart, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "List your hostel or PG", description: "Reach travellers across India. Set your own prices and rules; we handle bookings and payments." };

const STEPS = [
  ["Create your listing", "Photos, rooms, prices and house rules. Save a draft and finish whenever you like."],
  ["Get verified", "Upload an ID and property proof once. We review within a day or two."],
  ["Start hosting", "Guests book instantly or request to stay, as you choose. Payouts follow each completed stay."],
] as const;

export default function HostPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 md:py-20">
      <h1 className="display max-w-3xl text-4xl font-semibold sm:text-6xl">Fill your beds. <span className="text-primary">Keep control.</span></h1>
      <p className="mt-5 max-w-xl text-lg text-muted-foreground">List your hostel or PG for free. You set the prices, house rules and cancellation policy; we bring travellers and handle payments with a 10% commission only when you earn.</p>
      <div className="mt-8 flex flex-wrap gap-3"><Button asChild size="lg"><Link href="/register?as=host">Create a host account</Link></Button><Button asChild size="lg" variant="outline"><Link href="/owner">I already host</Link></Button></div>
      <ul className="mt-16 grid gap-4 sm:grid-cols-2">
        {[[BadgeIndianRupee, "Your prices, your rules", "Weekend and festival rates, per-bed or per-room, with GST handled for you."], [CalendarCheck, "Instant or request-to-book", "Choose per property. Block dates any time."], [ShieldCheck, "Verified guests, safe payouts", "Payments are held until the stay and released to you after."], [LineChart, "A dashboard that keeps up", "Bookings, calendar, earnings, reviews and coupons in one place."]].map(([Icon, t, d]) => {
          const I = Icon as typeof ShieldCheck;
          return <li key={t as string} className="flex gap-4 rounded-2xl border bg-card p-5"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><I className="size-5" /></span><span><b className="block">{t as string}</b><span className="text-sm text-muted-foreground">{d as string}</span></span></li>;
        })}
      </ul>
      <h2 className="mt-16 text-2xl font-semibold">How it works</h2>
      <ol className="mt-5 grid gap-4 md:grid-cols-3">{STEPS.map(([t, d], i) => <li key={t} className="rounded-2xl border bg-card p-5"><span className="tnum flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span><b className="mt-3 block">{t}</b><p className="mt-1 text-sm text-muted-foreground">{d}</p></li>)}</ol>
    </div>
  );
}
