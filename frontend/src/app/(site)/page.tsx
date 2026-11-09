import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, BadgeCheck, ReceiptIndianRupee, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HostelCard, HostelCardSkeleton } from "@/features/discovery/hostel-card";
import { SearchBar } from "@/features/discovery/search-bar";
import { money, plural } from "@/lib/format";
import { getCities, getTopRated } from "@/lib/server/public-api";

export default function Home() {
  return (
    <>
      <section className="relative isolate overflow-hidden border-b">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(70%_80%_at_85%_0%,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_70%),radial-gradient(60%_70%_at_0%_100%,color-mix(in_oklab,var(--star)_14%,transparent),transparent_70%)]" aria-hidden />
        <div className="mx-auto max-w-7xl px-4 pt-12 pb-14 sm:px-6 md:pt-20 md:pb-24">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur"><Zap className="size-3.5 fill-primary text-primary" />Instant booking · GST included · Free cancellation on many stays</p>
          <h1 className="display max-w-3xl text-[2.6rem] font-semibold sm:text-6xl md:text-7xl">A bed for the night.<br /><span className="text-primary">Anywhere in India.</span></h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground md:text-lg">Hostels, private rooms and PGs from hosts you can trust. See the final price before you commit, and book in a minute.</p>
          <SearchBar className="mt-9 max-w-4xl" />
        </div>
      </section>

      <section id="cities" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-14 sm:px-6">
        <div className="mb-6 flex items-end justify-between gap-4"><h2 className="text-2xl font-semibold md:text-3xl">Popular destinations</h2><Link href="/search" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">All stays <ArrowRight className="size-4" /></Link></div>
        <Suspense fallback={<CitiesSkeleton />}><Cities /></Suspense>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
        <h2 className="mb-6 text-2xl font-semibold md:text-3xl">Loved by travellers</h2>
        <Suspense fallback={<div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <HostelCardSkeleton key={i} />)}</div>}><TopRated /></Suspense>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { Icon: ReceiptIndianRupee, t: "The real price, up front", d: "GST is in the total from the first screen. No surprise at checkout." },
            { Icon: Zap, t: "Book in a minute", d: "Most stays confirm instantly. Request-to-book hosts answer within a day." },
            { Icon: BadgeCheck, t: "Verified hosts", d: "Every host passes ID and property checks before a listing goes live." },
          ].map(({ Icon, t, d }) => (
            <div key={t} className="rounded-2xl border bg-card p-6"><div className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Icon className="size-5" /></div><h3 className="mt-4 font-semibold">{t}</h3><p className="mt-1.5 text-sm text-muted-foreground">{d}</p></div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-foreground px-6 py-12 text-background sm:px-12 md:py-16">
          <div className="absolute -top-24 -right-24 size-72 rounded-full bg-primary/40 blur-3xl" aria-hidden />
          <div className="relative max-w-xl"><h2 className="display text-3xl font-semibold md:text-5xl">Own a hostel or PG?</h2><p className="mt-3 text-background/70">List it in minutes. Set your own prices, house rules and cancellation policy. We bring the guests and handle payments.</p>
            <Button asChild size="lg" className="mt-7 bg-background text-foreground hover:bg-background/90"><Link href="/host">Start hosting <ArrowRight /></Link></Button></div>
        </div>
      </section>
    </>
  );
}

async function Cities() {
  const cities = await getCities();
  if (!cities?.length) return <p className="text-sm text-muted-foreground">Destinations will appear here once stays are listed.</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {cities.slice(0, 8).map((c) => (
        <li key={c.city}>
          <Link href={`/search?city=${encodeURIComponent(c.city)}`} className="pressable group relative flex min-h-28 flex-col justify-between overflow-hidden rounded-2xl border bg-card p-4 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
            <span className="absolute -right-3 -bottom-6 text-[5.5rem] leading-none font-semibold text-primary/[0.07] select-none" aria-hidden>{c.city.slice(0, 1)}</span>
            <span className="relative"><span className="block truncate font-semibold">{c.city}</span><span className="block truncate text-xs text-muted-foreground">{c.state}</span></span>
            <span className="relative flex items-end justify-between gap-2 text-xs text-muted-foreground"><span>{plural(c.count, "stay")}</span>{c.fromPricePaise !== null && <span className="tnum">from <b className="text-foreground">{money(c.fromPricePaise)}</b></span>}</span>
            
          </Link>
        </li>
      ))}
    </ul>
  );
}
function CitiesSkeleton() {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-28 rounded-2xl bg-muted motion-safe:animate-pulse" />)}</div>;
}

async function TopRated() {
  const items = await getTopRated(8);
  if (!items?.length) return <p className="text-sm text-muted-foreground">Top-rated stays will appear here soon.</p>;
  return <div className="grid gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">{items.map((h, i) => <HostelCard key={h.id} h={h} priority={i === 0} />)}</div>;
}
