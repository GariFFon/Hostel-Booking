"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { localToday, addDays } from "@/lib/format";

/** The tenant's free time as the form holds it: one day and a time range, in their own timezone. */
export interface FreeTime { date: string; from: string; to: string; allowEntry: boolean }

const PRESETS = [["Morning", "09:00", "12:00"], ["Afternoon", "12:00", "17:00"], ["Evening", "17:00", "21:00"], ["Any time", "09:00", "21:00"]] as const;

export const defaultFreeTime = (): FreeTime => ({ date: addDays(localToday(), 1), from: "09:00", to: "21:00", allowEntry: false });

/** Local date + time → an ISO instant. Null while either is empty or invalid. */
export function toInstant(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The two instants the API wants, or the reason they are not ready yet. */
export function freeTimeRange(v: FreeTime): { availableFrom: string; availableTo: string; allowEntryIfAway: boolean } | string {
  const from = toInstant(v.date, v.from);
  const to = toInstant(v.date, v.to);
  if (!from || !to) return "Choose a day and the times you are free";
  if (new Date(to) <= new Date(from)) return "The end time must be after the start time";
  if (new Date(to).getTime() - new Date(from).getTime() < 3_600_000) return "Be free for at least an hour so staff can reach you";
  if (new Date(to) <= new Date()) return "That time has already passed";
  return { availableFrom: from, availableTo: to, allowEntryIfAway: v.allowEntry };
}

const dayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });
/** "Tue, 18 Nov, 10:00 am to 1:00 pm" in the viewer's own timezone. */
export function fmtSpan(fromIso: string, toIso: string) {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  const sameDay = a.toDateString() === b.toDateString();
  return sameDay ? `${dayFmt.format(a)}, ${timeFmt.format(a)} to ${timeFmt.format(b)}` : `${dayFmt.format(a)}, ${timeFmt.format(a)} to ${dayFmt.format(b)}, ${timeFmt.format(b)}`;
}

/** Day + from/to + quick presets + "may go in if I'm out". Required wherever it is used: staff cannot plan a visit without it. */
export function FreeTimeFields({ value, onChange, error, idPrefix = "ft" }: { value: FreeTime; onChange: (v: FreeTime) => void; error?: string; idPrefix?: string }) {
  const set = (p: Partial<FreeTime>) => onChange({ ...value, ...p });
  return (
    <fieldset className="grid gap-3 rounded-xl border p-3">
      <legend className="px-1 text-sm font-medium">When are you free to let someone in? <span className="text-destructive" aria-hidden>*</span></legend>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick choices">
        {PRESETS.map(([label, from, to]) => <Button key={label} type="button" size="sm" variant={value.from === from && value.to === to ? "default" : "outline"} onClick={() => set({ from, to })}>{label}</Button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Day" htmlFor={`${idPrefix}-date`}><Input id={`${idPrefix}-date`} type="date" min={localToday()} value={value.date} onChange={(e) => set({ date: e.target.value })} /></FormField>
        <FormField label="From" htmlFor={`${idPrefix}-from`}><Input id={`${idPrefix}-from`} type="time" value={value.from} onChange={(e) => set({ from: e.target.value })} /></FormField>
        <FormField label="Until" htmlFor={`${idPrefix}-to`}><Input id={`${idPrefix}-to`} type="time" value={value.to} onChange={(e) => set({ to: e.target.value })} /></FormField>
      </div>
      <label className="flex min-h-11 items-center gap-2.5 text-sm"><input type="checkbox" className="size-4" checked={value.allowEntry} onChange={(e) => set({ allowEntry: e.target.checked })} />Staff may go in even if I am not in the room</label>
      {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
    </fieldset>
  );
}
