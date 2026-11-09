"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField } from "@/components/common/form-field";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { addDays, fmtRange, localToday, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const monthLabel = (d: string) => new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const shiftMonth = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n, 1); return x.toISOString().slice(0, 10); };
const daysIn = (d: string) => { const x = new Date(`${d}T00:00:00Z`); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); };
const mondayIndex = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;

export function CalendarView() {
  const qc = useQueryClient();
  const hostels = useQuery({ queryKey: ["owner", "hostels", "options"], staleTime: 60_000, queryFn: () => unwrapData(api.GET("/owner/hostels", { params: { query: { limit: 50 } } })) });
  const [pickedHostel, setPickedHostel] = React.useState<string>("");
  const [pickedRoom, setPickedRoom] = React.useState<string>("");
  const [month, setMonth] = React.useState(() => monthStart(localToday()));
  const [sel, setSel] = React.useState<{ from: string; to?: string } | null>(null);
  const [units, setUnits] = React.useState("1");
  const [reason, setReason] = React.useState("");

  const hostelId = pickedHostel && hostels.data?.some((h) => h.id === pickedHostel) ? pickedHostel : hostels.data?.[0]?.id ?? "";
  const rooms = useQuery({ queryKey: ["owner", "rooms", hostelId], enabled: !!hostelId, queryFn: () => unwrapData(api.GET("/owner/hostels/{id}/room-types", { params: { path: { id: hostelId } } })) });
  const roomId = pickedRoom && rooms.data?.some((r) => r.id === pickedRoom) ? pickedRoom : rooms.data?.[0]?.id ?? "";
  const room = rooms.data?.find((r) => r.id === roomId);

  const from = month, to = addDays(month, daysIn(month) - 1);
  const cal = useQuery({ queryKey: ["owner", "calendar", roomId, month], enabled: !!roomId, queryFn: () => unwrapData(api.GET("/owner/room-types/{id}/calendar", { params: { path: { id: roomId }, query: { from, to } } })) });
  const byDate = new Map((cal.data ?? []).map((n) => [n.date, n]));
  const today = localToday();

  const block = useMutation({
    mutationFn: () => unwrapData(api.PUT("/owner/room-types/{id}/blocks", { params: { path: { id: roomId } }, body: { from: sel!.from, to: sel!.to ?? sel!.from, units: Number(units), ...(reason.trim() ? { reason: reason.trim() } : {}) } })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["owner", "calendar", roomId] }); toast.success(Number(units) === 0 ? "Dates reopened" : "Dates blocked"); setSel(null); setReason(""); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function pick(d: string) {
    if (d < today) return;
    setSel((cur) => (!cur || cur.to ? { from: d } : d < cur.from ? { from: d } : { from: cur.from, to: d }));
  }
  const inSel = (d: string) => !!sel && d >= sel.from && d <= (sel.to ?? sel.from);

  if (hostels.isError) return <ErrorState error={hostels.error} onRetry={() => hostels.refetch()} />;
  const lead = mondayIndex(month);
  return (
    <div className="grid gap-6">
      <PageHeader title="Calendar" description="See what's free night by night, and close dates for maintenance or private use." />
      {hostels.data && hostels.data.length === 0 ? <EmptyState title="No properties yet" description="Create a property and add rooms to manage availability." /> : (
        <>
          <div className="flex flex-wrap gap-3">
            <Select value={hostelId} onValueChange={(v) => { setPickedHostel(v); setPickedRoom(""); setSel(null); }}><SelectTrigger className="w-auto min-w-52" aria-label="Property"><SelectValue placeholder="Property" /></SelectTrigger><SelectContent>{(hostels.data ?? []).map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent></Select>
            <Select value={roomId} onValueChange={(v) => { setPickedRoom(v); setSel(null); }} disabled={!rooms.data?.length}><SelectTrigger className="w-auto min-w-52" aria-label="Room type"><SelectValue placeholder="Room type" /></SelectTrigger><SelectContent>{(rooms.data ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select>
          </div>
          {rooms.data && rooms.data.length === 0 ? <EmptyState title="No rooms in this property" description="Add a room type first." /> : (
            <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
              <div className="rounded-2xl border bg-card p-3 sm:p-5">
                <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">{monthLabel(month)}</h2>
                  <div className="flex gap-1"><Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} disabled={month <= monthStart(today)}><ChevronLeft /></Button><Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight /></Button></div></div>
                <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">{WEEK.map((d) => <div key={d} className="pb-1">{d}</div>)}</div>
                {cal.isError ? <ErrorState compact error={cal.error} onRetry={() => cal.refetch()} /> : (
                  <div className="grid grid-cols-7 gap-1" aria-busy={cal.isFetching}>
                    {Array.from({ length: lead }, (_, i) => <div key={`l${i}`} />)}
                    {Array.from({ length: daysIn(month) }, (_, i) => {
                      const d = addDays(month, i);
                      const n = byDate.get(d);
                      const past = d < today;
                      const full = n && n.available <= 0;
                      return (
                        <button key={d} type="button" disabled={past} onClick={() => pick(d)} aria-pressed={inSel(d)} aria-label={`${d}${n ? `, ${n.available} of ${n.total} free` : ""}`}
                          className={cn("pressable flex min-h-14 flex-col items-center justify-center rounded-lg border text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35 sm:min-h-16",
                            inSel(d) ? "border-primary bg-accent ring-1 ring-primary" : full ? "bg-destructive/10" : n && n.booked + n.held > 0 ? "bg-warning/10" : "bg-card hover:bg-muted", d === today && "font-semibold")}>
                          <span className="tnum">{Number(d.slice(8))}</span>
                          {n ? <span className={cn("tnum text-[11px]", full ? "text-destructive" : "text-muted-foreground")}>{n.available}/{n.total}</span> : cal.isPending ? <span className="h-3" /> : null}
                          {n && n.blocked > 0 && <span className="text-[10px] text-muted-foreground">{n.blocked} blocked</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span><i className="mr-1 inline-block size-2.5 rounded bg-card ring-1 ring-border" />Free</span><span><i className="mr-1 inline-block size-2.5 rounded bg-warning/30" />Some booked or held</span><span><i className="mr-1 inline-block size-2.5 rounded bg-destructive/25" />Fully booked</span><span>Numbers are free / total {room?.kind === "DORM" ? "beds" : "rooms"}.</span></p>
              </div>

              <div className="grid gap-4 rounded-2xl border bg-card p-4 sm:p-5 lg:sticky lg:top-20">
                <h3 className="font-semibold">Close or reopen dates</h3>
                {!sel ? <p className="text-sm text-muted-foreground">Tap a start date, then an end date.</p> : (
                  <>
                    <p className="tnum text-sm font-medium">{sel.to ? fmtRange(sel.from, sel.to) : `${sel.from}, tap an end date or use one night`}{sel.to ? ` · ${plural(Math.round((Date.parse(sel.to) - Date.parse(sel.from)) / 86_400_000) + 1, "night")}` : ""}</p>
                    <FormField label={`${room?.kind === "DORM" ? "Beds" : "Rooms"} to block (0 reopens)`} htmlFor="blk-units" hint={room ? `Of ${room.totalUnits} total.` : undefined}><Input id="blk-units" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ""))} /></FormField>
                    {room && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setUnits(String(room.totalUnits))}>Block all</Button><Button size="sm" variant="outline" onClick={() => setUnits("0")}>Reopen</Button></div>}
                    <FormField label="Reason (private)" htmlFor="blk-reason"><Input id="blk-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Painting the dorm" /></FormField>
                    <Button loading={block.isPending} disabled={units === "" || Number(units) > (room?.totalUnits ?? 0)} onClick={() => block.mutate()}>{Number(units) === 0 ? "Reopen dates" : "Block dates"}</Button>
                    <Button variant="ghost" onClick={() => setSel(null)}>Clear selection</Button>
                  </>
                )}
                <Alert tone="info">Blocking never touches existing bookings: it only closes beds that are still free.</Alert>
              </div>
            </div>
          )}
          {(hostels.isPending || rooms.isPending) && <Skeleton className="h-96" />}
        </>
      )}
    </div>
  );
}
