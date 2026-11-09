import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchView } from "@/features/discovery/search-view";
import { HostelCardSkeleton } from "@/features/discovery/hostel-card";

export const metadata: Metadata = { title: "Search hostels and PGs", description: "Compare hostel beds, private rooms and PGs on a map, with GST-inclusive prices for your dates." };

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="mx-auto grid max-w-[1500px] gap-6 px-4 py-8 sm:grid-cols-2 lg:grid-cols-3 sm:px-6">{Array.from({ length: 6 }, (_, i) => <HostelCardSkeleton key={i} />)}</div>}>
      <SearchView />
    </Suspense>
  );
}
