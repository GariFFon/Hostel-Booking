import type { Metadata } from "next";
import { BookingsList } from "@/features/account/bookings-list";

// Signed-in, client-rendered screen (behind <AuthGate>): nothing to prerender, so skip instant-navigation validation.
export const instant = false;
export const metadata: Metadata = { title: "Your trips", robots: { index: false } };
export default function Page() { return <BookingsList />; }
