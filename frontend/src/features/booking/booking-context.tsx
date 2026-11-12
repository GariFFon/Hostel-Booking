"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { nightsBetween } from "@/lib/format";
import type { HostelDetail } from "@/lib/api/types";

export const MAX_NIGHTS = 90;
export const MAX_ITEMS = 5;
type Sel = Record<string, number>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "roomId:2,roomId:1" ⇄ { roomId: 2, ... } (also how the checkout page receives the choice). */
export const encodeItems = (sel: Sel) => Object.entries(sel).filter(([, n]) => n > 0).map(([id, n]) => `${id}:${n}`).join(",");
export function decodeItems(s: string | null): Sel {
  const out: Sel = {};
  for (const part of (s ?? "").split(",")) {
    const [id, n] = part.split(":");
    const units = Math.trunc(Number(n));
    if (id && /^[0-9a-f-]{36}$/i.test(id) && units > 0 && units <= 50) out[id] = units;
  }
  return out;
}

export function useBooking() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useBooking must be used inside <BookingProvider>");
  return c;
}

function useBookingState(hostel: HostelDetail) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const ci = sp.get("checkIn"), co = sp.get("checkOut");
  const dates = ci && co && DATE.test(ci) && DATE.test(co) && co > ci && nightsBetween(ci, co) <= MAX_NIGHTS ? { checkIn: ci, checkOut: co } : null;
  // What the calendar shows: the full range, or just the check-in while the guest is still choosing the check-out.
  const draftDates: { checkIn?: string; checkOut?: string } = dates ?? { checkIn: ci && DATE.test(ci) ? ci : undefined };
  const guests = Math.min(30, Math.max(1, Math.trunc(Number(sp.get("guests"))) || 1));
  const [rawSel, setSel] = React.useState<Sel>(() => decodeItems(sp.get("items")));
  const [couponInput, setCouponInput] = React.useState(sp.get("coupon") ?? "");
  const [coupon, setCoupon] = React.useState(sp.get("coupon") ?? ""); // only changes when "Apply" is pressed
  const nights = dates ? nightsBetween(dates.checkIn, dates.checkOut) : 0;

  const writeUrl = React.useCallback((patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  }, [sp, router, pathname]);

  const rooms = React.useMemo(() => new Map(hostel.roomTypes.map((r) => [r.id, r])), [hostel.roomTypes]);

  const availability = useQuery({
    queryKey: ["availability", hostel.slug, dates?.checkIn, dates?.checkOut, guests], enabled: !!dates, staleTime: 20_000, placeholderData: keepPreviousData, retry: false,
    queryFn: () => unwrapData(api.GET("/hostels/{idOrSlug}/availability", { params: { path: { idOrSlug: hostel.slug }, query: { checkIn: dates!.checkIn, checkOut: dates!.checkOut, guests } } })),
  });
  const avail = React.useMemo(() => new Map((availability.data?.rooms ?? []).map((r) => [r.roomTypeId, r])), [availability.data]);

  // The choice is always shown clamped to what is actually free for the chosen dates (derived, never stored twice).
  const sel = React.useMemo(() => {
    if (!availability.data || availability.isPlaceholderData) return rawSel;
    const next: Sel = {};
    for (const [id, n] of Object.entries(rawSel)) {
      const a = avail.get(id);
      const v = Math.min(n, a && a.eligible ? a.availableUnits : 0);
      if (v > 0) next[id] = v;
    }
    return next;
  }, [rawSel, availability.data, availability.isPlaceholderData, avail]);

  const items = Object.entries(sel).filter(([, n]) => n > 0).map(([roomTypeId, units]) => ({ roomTypeId, units }));
  const totalUnits = items.reduce((s, i) => s + i.units, 0);
  const capacity = items.reduce((s, i) => s + i.units * (rooms.get(i.roomTypeId)?.maxOccupancyPerUnit ?? 1), 0);

  const setUnits = React.useCallback((roomTypeId: string, units: number) => {
    setSel((cur) => {
      const next = { ...cur };
      if (units <= 0) delete next[roomTypeId]; else next[roomTypeId] = units;
      return next;
    });
  }, []);
  // Each bed/room needs a guest: raise the guest count to match the beds chosen.
  React.useEffect(() => { if (totalUnits > guests) writeUrl({ guests: String(totalUnits) }); }, [totalUnits, guests, writeUrl]);

  const quote = useQuery({
    queryKey: ["quote", hostel.id, dates?.checkIn, dates?.checkOut, guests, encodeItems(sel), coupon],
    enabled: !!dates && items.length > 0 && guests >= totalUnits && guests <= capacity && items.length <= MAX_ITEMS,
    staleTime: 15_000, placeholderData: keepPreviousData, retry: false,
    queryFn: () => unwrapData(api.POST("/quotes", { body: { hostelId: hostel.id, checkIn: dates!.checkIn, checkOut: dates!.checkOut, guests, items, ...(coupon ? { couponCode: coupon } : {}) } })),
  });

  let issue: string | null = null;
  if (!dates) issue = "Choose your dates";
  else if (items.length === 0) issue = "Choose a bed or room";
  else if (items.length > MAX_ITEMS) issue = `Choose at most ${MAX_ITEMS} room types`;
  else if (guests > capacity) issue = `Your selection sleeps ${capacity}. Add more beds or rooms, or reduce guests.`;
  else if (quote.isError) issue = errorMessage(quote.error);
  else if (!quote.data) issue = null;

  const params = new URLSearchParams();
  if (dates) { params.set("checkIn", dates.checkIn); params.set("checkOut", dates.checkOut); }
  params.set("guests", String(guests));
  params.set("items", encodeItems(sel));
  if (coupon && quote.data?.coupon?.valid) params.set("coupon", coupon);
  const canReserve = !issue && !!quote.data && !quote.isPlaceholderData && !quote.isFetching;

  return {
    hostel, dates, draftDates, nights, guests, items, totalUnits, capacity, sel, setUnits, rooms, availability, avail, quote, issue, canReserve,
    reserveHref: `/checkout/${hostel.slug}?${params}`,
    coupon, couponInput, setCouponInput, applyCode: (c: string) => { const v = c.trim().toUpperCase(); setCouponInput(v); setCoupon(v); }, applyCoupon: () => { const v = couponInput.trim().toUpperCase(); setCouponInput(v); setCoupon(v); }, clearCoupon: () => { setCoupon(""); setCouponInput(""); },
    setDates: (r: { checkIn?: string; checkOut?: string }) => writeUrl({ checkIn: r.checkIn, checkOut: r.checkOut }),
    setGuests: (n: number) => writeUrl({ guests: n > 1 ? String(n) : undefined }),
  };
}

const Ctx = React.createContext<ReturnType<typeof useBookingState> | null>(null);
export function BookingProvider({ hostel, children }: { hostel: HostelDetail; children: React.ReactNode }) {
  const value = useBookingState(hostel);
  return <Ctx value={value}>{children}</Ctx>;
}
