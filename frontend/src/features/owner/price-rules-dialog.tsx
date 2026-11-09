"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { FormField } from "@/components/common/form-field";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { bps, fmtRange, localToday, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RoomType } from "./rooms-tab";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Weekend uplifts and date-range prices (festivals, peak season). The highest-priority rule that applies wins. */
export function PriceRulesDialog({ room, open, onOpenChange }: { room: RoomType; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const key = ["owner", "price-rules", room.id];
  const q = useQuery({ queryKey: key, enabled: open, queryFn: () => unwrapData(api.GET("/owner/room-types/{id}/price-rules", { params: { path: { id: room.id } } })) });
  const [adding, setAdding] = React.useState(false);
  const [type, setType] = React.useState<"WEEKEND" | "DATE_RANGE">("WEEKEND");
  const [days, setDays] = React.useState<number[]>([5, 6]);
  const [start, setStart] = React.useState(""), [end, setEnd] = React.useState("");
  const [mode, setMode] = React.useState<"percent" | "price">("percent");
  const [val, setVal] = React.useState("20");
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const sync = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["owner", "hostel"] }); };

  const add = useMutation({
    mutationFn: () => {
      const n = Number(val);
      const price = mode === "price" ? { pricePaise: Math.round(n * 100) } : { adjustmentBps: Math.round(n * 100) };
      return unwrapData(api.POST("/owner/room-types/{id}/price-rules", { params: { path: { id: room.id } }, body: { type, ...(name.trim() ? { name: name.trim() } : {}), ...(type === "WEEKEND" ? { weekdays: days } : { startDate: start, endDate: end }), ...price, priority: type === "DATE_RANGE" ? 10 : 0 } }));
    },
    onSuccess: () => { sync(); setAdding(false); setName(""); toast.success("Price rule added"); },
    onError: (e) => setError(errorMessage(e)),
  });
  const toggle = useMutation({ mutationFn: (r: { id: string; isActive: boolean }) => unwrapData(api.PATCH("/owner/price-rules/{id}", { params: { path: { id: r.id } }, body: { isActive: !r.isActive } })), onSuccess: sync, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => unwrapData(api.DELETE("/owner/price-rules/{id}", { params: { path: { id } } })), onSuccess: () => { sync(); toast.success("Rule removed"); }, onError: (e) => toast.error(errorMessage(e)) });
  const valid = Number(val) !== 0 && Number.isFinite(Number(val)) && (type === "WEEKEND" ? days.length > 0 : !!start && !!end && end >= start);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={`Special prices: ${room.name}`} description={`Base price ${money(room.basePricePaise)} per night.`} className="sm:max-w-xl">
      <div className="grid max-h-[62dvh] gap-4 overflow-y-auto overscroll-contain p-0.5">
        {q.isPending ? <Skeleton className="h-20" /> : (q.data ?? []).length === 0 && !adding ? <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">No special prices. Guests pay the base price every night.</p> : (
          <ul className="grid gap-2">{(q.data ?? []).map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl border p-3">
              <div className="min-w-0 flex-1"><p className="flex flex-wrap items-center gap-2 text-sm font-medium"><Badge tone="outline">{r.type === "WEEKEND" ? "Weekly" : "Dates"}</Badge>{r.name ?? (r.type === "WEEKEND" ? "Weekend rate" : "Seasonal rate")}</p>
                <p className="tnum mt-1 text-xs text-muted-foreground">{r.type === "WEEKEND" ? r.weekdays.map((d) => DAYS[d]).join(", ") : r.startDate && r.endDate ? fmtRange(r.startDate, r.endDate) : ""} · {r.pricePaise !== null ? `${money(r.pricePaise)} / night` : `${r.adjustmentBps! > 0 ? "+" : ""}${bps(r.adjustmentBps ?? 0)}`}</p></div>
              <Switch checked={r.isActive} onCheckedChange={() => toggle.mutate(r)} aria-label="Rule active" />
              <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="Delete rule" onClick={() => remove.mutate(r.id)}><Trash2 /></Button>
            </li>
          ))}</ul>
        )}
        {adding ? (
          <div className="grid gap-4 rounded-xl border bg-muted/40 p-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <FormField label="Applies to" htmlFor="pr-type"><Select value={type} onValueChange={(v) => setType(v as typeof type)}><SelectTrigger id="pr-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="WEEKEND">Days of the week</SelectItem><SelectItem value="DATE_RANGE">A date range (festival, season)</SelectItem></SelectContent></Select></FormField>
            {type === "WEEKEND" ? (
              <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => setDays((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))} className={cn("pressable min-h-10 min-w-12 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", days.includes(i) ? "border-primary bg-accent text-accent-foreground" : "bg-card")}>{d}</button>)}</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2"><FormField label="From" htmlFor="pr-s"><Input id="pr-s" type="date" min={localToday()} value={start} onChange={(e) => setStart(e.target.value)} /></FormField><FormField label="To (inclusive)" htmlFor="pr-e"><Input id="pr-e" type="date" min={start || localToday()} value={end} onChange={(e) => setEnd(e.target.value)} /></FormField></div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Change the price by" htmlFor="pr-mode"><Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}><SelectTrigger id="pr-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="percent">A percentage</SelectItem><SelectItem value="price">Set a fixed price</SelectItem></SelectContent></Select></FormField>
              <FormField label={mode === "percent" ? "Percent (negative = discount)" : "Price per night (₹)"} htmlFor="pr-val"><Input id="pr-val" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} /></FormField>
            </div>
            <FormField label="Label (optional)" htmlFor="pr-name"><Input id="pr-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali week" /></FormField>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setAdding(false); setError(null); }}>Cancel</Button><Button disabled={!valid} loading={add.isPending} onClick={() => { setError(null); add.mutate(); }}>Add rule</Button></div>
          </div>
        ) : <Button variant="outline" onClick={() => setAdding(true)} className="w-fit"><Plus />Add a rule</Button>}
      </div>
    </ResponsiveDialog>
  );
}
