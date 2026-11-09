"use client";
import * as React from "react";
import { CalendarDays, Minus, Plus, Users, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMediaQuery } from "@/hooks/use-media-query";
import { fmtRange, fromISODate, localToday, nightsBetween, plural, toISODate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const triggerClass = "pressable flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl px-3.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/70 data-[state=open]:bg-muted";

export function FieldLabel({ icon: Icon, label, children, placeholder }: { icon: React.ComponentType<{ className?: string }>; label: string; children?: React.ReactNode; placeholder: string }) {
  return (
    <>
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
        <span className={cn("block truncate text-sm", children ? "font-medium" : "text-muted-foreground")}>{children ?? placeholder}</span>
      </span>
    </>
  );
}

/** The calendar body. "Today" is read here (only mounted when the popover opens), so nothing time-dependent is prerendered. */
function RangeCalendar({ checkIn, checkOut, onChange, onDone }: { checkIn?: string; checkOut?: string; onChange: (r: { checkIn?: string; checkOut?: string }) => void; onDone: () => void }) {
  const wide = useMediaQuery("(min-width: 768px)");
  const today = fromISODate(localToday());
  const range: DateRange | undefined = checkIn ? { from: fromISODate(checkIn), to: checkOut ? fromISODate(checkOut) : undefined } : undefined;
  return (
    <>
      <Calendar
        mode="range" numberOfMonths={wide ? 2 : 1} defaultMonth={range?.from ?? today} selected={range} min={1}
        disabled={{ before: today }} excludeDisabled
        onSelect={(r, picked) => {
          // Clicking a date once a full range exists starts a new range from that date (what people expect).
          if (range?.from && range.to) { onChange({ checkIn: toISODate(picked), checkOut: undefined }); return; }
          onChange({ checkIn: r?.from ? toISODate(r.from) : undefined, checkOut: r?.to ? toISODate(r.to) : undefined });
          if (r?.from && r.to) onDone();
        }}
      />
      {(checkIn || checkOut) && (
        <div className="mt-2 flex justify-end border-t pt-2"><Button variant="ghost" size="sm" onClick={() => onChange({})}><X /> Clear dates</Button></div>
      )}
    </>
  );
}

/** Check-in / check-out in one calendar. Past days are disabled; picking the second date closes the popover. */
export function DateRangeField({ checkIn, checkOut, onChange, className, label = "When" }: { checkIn?: string; checkOut?: string; onChange: (r: { checkIn?: string; checkOut?: string }) => void; className?: string; label?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(triggerClass, className)}>
          <FieldLabel icon={CalendarDays} label={label} placeholder="Add dates">
            {checkIn && checkOut ? <>{fmtRange(checkIn, checkOut)} <span className="font-normal text-muted-foreground">· {plural(nightsBetween(checkIn, checkOut), "night")}</span></> : checkIn ? "Pick check-out" : null}
          </FieldLabel>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-1rem)] p-3">
        <RangeCalendar checkIn={checkIn} checkOut={checkOut} onChange={onChange} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

export function Stepper({ value, onChange, min = 1, max = 30, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="flex items-center gap-3" role="group" aria-label={label}>
      <Button variant="outline" size="icon" className="rounded-full" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Fewer ${label}`}><Minus /></Button>
      <span className="tnum w-8 text-center font-medium" aria-live="polite">{value}</span>
      <Button variant="outline" size="icon" className="rounded-full" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More ${label}`}><Plus /></Button>
    </div>
  );
}

export function GuestsField({ guests, onChange, className }: { guests: number; onChange: (n: number) => void; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn(triggerClass, className)}>
          <FieldLabel icon={Users} label="Who" placeholder="Add guests">{plural(guests, "guest")}</FieldLabel>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-sm font-medium">Guests</p><p className="text-xs text-muted-foreground">Everyone who will stay</p></div>
          <Stepper value={guests} onChange={onChange} label="guests" />
        </div>
      </PopoverContent>
    </Popover>
  );
}
