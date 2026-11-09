import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BedDouble, Clock, Info, MapPin, ShieldCheck, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HideTabBar } from "@/components/layout/hide-tab-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { RatingBadge } from "@/components/common/rating";
import { BookingCard } from "@/features/booking/booking-card";
import { BookingProvider } from "@/features/booking/booking-context";
import { MobileBookingBar } from "@/features/booking/mobile-bar";
import { RoomsSection } from "@/features/booking/rooms-section";
import { AmenityIcon } from "@/features/hostel/amenity-icon";
import { Gallery } from "@/features/hostel/gallery";
import { ReviewsSection } from "@/features/hostel/reviews-section";
import { HostelMap } from "@/features/discovery/hostel-map";
import { WishlistButton } from "@/features/wishlist/wishlist-button";
import { getHostel, getReviewSummary } from "@/lib/server/public-api";

type Props = PageProps<"/hostels/[slug]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const h = await getHostel((await params).slug);
  if (!h) return { title: "Stay not found", robots: { index: false } };
  const img = h.media[0]?.fullUrl;
  return {
    title: `${h.name}, ${h.address.city}`,
    description: h.description.replace(/\s+/g, " ").slice(0, 155),
    alternates: { canonical: `/hostels/${h.slug}` },
    openGraph: { title: h.name, description: h.description.slice(0, 155), type: "website", ...(img ? { images: [{ url: img }] } : {}) },
  };
}

export default function HostelPage({ params }: Props) {
  return <Suspense fallback={<DetailSkeleton />}><Detail params={params} /></Suspense>;
}

async function Detail({ params }: { params: Props["params"] }) {
  const { slug } = await params;
  const [h, summary] = await Promise.all([getHostel(slug), getReviewSummary(slug)]);
  if (!h) notFound();
  const gender = h.genderPolicy === "MIXED" ? null : h.genderPolicy === "FEMALE_ONLY" ? "Women only" : "Men only";
  const jsonLd = {
    "@context": "https://schema.org", "@type": "Hostel", name: h.name, description: h.description, image: h.media.slice(0, 5).map((m) => m.fullUrl),
    address: { "@type": "PostalAddress", streetAddress: h.address.line1, addressLocality: h.address.city, addressRegion: h.address.state, postalCode: h.address.postalCode, addressCountry: h.address.country },
    geo: { "@type": "GeoCoordinates", latitude: h.location.latitude, longitude: h.location.longitude },
    ...(summary && summary.reviewCount > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: summary.avgRating, reviewCount: summary.reviewCount } } : {}),
  };
  return (
    <BookingProvider hostel={h}>
      <HideTabBar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="mx-auto w-full max-w-7xl px-4 pt-5 pb-28 sm:px-6 lg:pb-12">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold [overflow-wrap:anywhere] md:text-4xl">{h.name}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <RatingBadge rating={h.avgRating} count={h.reviewCount} />
              <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{[...new Set([h.address.locality, h.address.city, h.address.state].filter(Boolean))].join(", ")}</span>
            </p>
          </div>
          <WishlistButton hostelId={h.id} variant="plain" className="shrink-0 border" />
        </div>
        <Gallery photos={h.media} name={h.name} />

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-14">
          <div className="grid min-w-0 gap-10">
            <section className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="outline">{h.propertyType === "PG" ? "PG" : "Hostel"}</Badge>
                {h.bookingMode === "INSTANT" ? <Badge tone="primary"><Zap className="fill-current" />Instant booking</Badge> : <Badge tone="warning"><Clock />Host approval required</Badge>}
                {gender && <Badge tone="primary">{gender}</Badge>}
                {h.host.name && <span className="text-sm text-muted-foreground">Hosted by <b className="font-semibold text-foreground">{h.host.name}</b></span>}
              </div>
              <p className="max-w-3xl text-[15px] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{h.description}</p>
              <dl className="grid max-w-xl grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border p-3"><dt className="text-muted-foreground">Check-in</dt><dd className="tnum font-semibold">from {h.checkInTime}</dd></div>
                <div className="rounded-xl border p-3"><dt className="text-muted-foreground">Check-out</dt><dd className="tnum font-semibold">by {h.checkOutTime}</dd></div>
              </dl>
            </section>

            <section aria-labelledby="rooms-h" className="grid scroll-mt-24 gap-4">
              <div><h2 id="rooms-h" className="flex items-center gap-2 text-xl font-semibold"><BedDouble className="size-5 text-muted-foreground" />Choose your bed or room</h2></div>
              <RoomsSection />
            </section>

            {h.amenities.length > 0 && (
              <section aria-labelledby="amen-h" className="grid gap-4">
                <h2 id="amen-h" className="text-xl font-semibold">What this place offers</h2>
                <ul className="grid gap-x-8 gap-y-3.5 sm:grid-cols-2">{h.amenities.map((a) => <li key={a.code} className="flex items-center gap-3 text-[15px]"><AmenityIcon code={a.code} className="size-5 shrink-0 text-muted-foreground" />{a.label}</li>)}</ul>
              </section>
            )}

            <section aria-labelledby="loc-h" className="grid gap-4">
              <h2 id="loc-h" className="text-xl font-semibold">Where you&apos;ll be</h2>
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{[h.address.line1, h.address.line2, h.address.locality, h.address.city, h.address.state, h.address.postalCode].filter(Boolean).join(", ")}</p>
              <div className="relative h-72 overflow-hidden rounded-2xl border">
                <HostelMap markers={[{ id: h.id, slug: h.slug, name: h.name, lat: h.location.latitude, lng: h.location.longitude, pricePaise: h.fromPricePaise, rating: h.avgRating, reviews: h.reviewCount }]} interactive={false} zoom={14} />
              </div>
              <Link className="w-fit text-sm font-medium text-primary underline-offset-4 hover:underline" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/directions?to=${h.location.latitude}%2C${h.location.longitude}`}>Get directions</Link>
            </section>

            <section aria-labelledby="rev-h" className="grid gap-4">
              <h2 id="rev-h" className="text-xl font-semibold">Guest reviews</h2>
              <ReviewsSection slug={h.slug} summary={summary} />
            </section>

            <section aria-labelledby="rules-h" className="grid gap-5">
              <h2 id="rules-h" className="text-xl font-semibold">Good to know</h2>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="grid content-start gap-2 rounded-2xl border p-5"><h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4" />Cancellation</h3><p className="text-sm text-muted-foreground">{h.cancellation.summary}</p></div>
                <div className="grid content-start gap-2 rounded-2xl border p-5"><h3 className="flex items-center gap-2 font-semibold"><Info className="size-4" />House rules</h3><p className="text-sm whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">{h.houseRules || "No special rules. Be considerate of other guests."}</p></div>
              </div>
              <p className="text-xs text-muted-foreground">{h.tax.note}</p>
            </section>
          </div>

          <aside className="hidden lg:block"><div className="sticky top-24"><BookingCard /></div></aside>
        </div>
      </div>
      <MobileBookingBar />
    </BookingProvider>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6" aria-hidden>
      <Skeleton className="h-9 w-2/3" /><Skeleton className="mt-3 h-4 w-1/3" /><Skeleton className="mt-5 aspect-[4/3] w-full rounded-2xl md:aspect-[16/7]" />
      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_24rem]"><div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div><Skeleton className="hidden h-96 lg:block" /></div>
    </div>
  );
}
