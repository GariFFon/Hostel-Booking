"use client";
import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { money, fmtRange } from "@/lib/format";
import { useBooking } from "./booking-context";
import { BookingCard } from "./booking-card";

/** Phone-only bottom bar: always shows the price and the one next action. */
export function MobileBookingBar() {
  const b = useBooking();
  const [open, setOpen] = React.useState(false);
  const q = b.quote.data;
  return (
    <>
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="tnum min-w-0">
            {q && b.dates ? <><p className="text-lg leading-tight font-semibold">{money(q.totalPaise, { exact: true })}</p><p className="truncate text-xs text-muted-foreground">{fmtRange(b.dates.checkIn, b.dates.checkOut)}</p></>
              : <><p className="text-lg leading-tight font-semibold">{money(b.hostel.fromPricePaise)}<span className="text-sm font-normal text-muted-foreground"> / night</span></p><p className="text-xs text-muted-foreground">{b.dates ? "Choose your beds or rooms" : "Taxes included at checkout"}</p></>}
          </div>
          {b.canReserve
            ? <Button asChild size="lg" className="shrink-0"><Link href={b.reserveHref}>{b.hostel.bookingMode === "APPROVAL" ? "Request" : "Reserve"}</Link></Button>
            : <Button size="lg" className="shrink-0" onClick={() => (b.dates && b.items.length === 0 ? document.getElementById("rooms")?.scrollIntoView({ behavior: "smooth", block: "start" }) : setOpen(true))}>{b.dates ? (b.items.length === 0 ? "Choose rooms" : "Review") : "Check dates"}</Button>}
        </div>
      </div>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerTitle className="sr-only">Your stay</DrawerTitle><DrawerDescription className="sr-only">Dates, guests and price</DrawerDescription>
          <BookingCard className="border-0 p-0 shadow-none" />
        </DrawerContent>
      </Drawer>
    </>
  );
}
