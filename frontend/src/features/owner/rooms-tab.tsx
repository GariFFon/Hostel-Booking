"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, CalendarRange, DoorOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { money, plural } from "@/lib/format";
import type { Item } from "@/lib/api/types";
import { PriceRulesDialog } from "./price-rules-dialog";
import { RoomDialog } from "./room-dialog";

export type RoomType = Item<"/owner/hostels/{id}/room-types">;

export function RoomsTab({ hostelId }: { hostelId: string }) {
  const qc = useQueryClient();
  const key = ["owner", "rooms", hostelId];
  const q = useQuery({ queryKey: key, queryFn: () => unwrapData(api.GET("/owner/hostels/{id}/room-types", { params: { path: { id: hostelId } } })) });
  const [edit, setEdit] = React.useState<RoomType | "new" | null>(null);
  const [rules, setRules] = React.useState<RoomType | null>(null);
  const [del, setDel] = React.useState<RoomType | null>(null);
  const sync = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["owner", "hostel", hostelId] }); };
  const toggle = useMutation({ mutationFn: (r: RoomType) => unwrapData(api.PATCH("/owner/room-types/{id}", { params: { path: { id: r.id } }, body: { isActive: !r.isActive } })), onSuccess: sync, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => unwrapData(api.DELETE("/owner/room-types/{id}", { params: { path: { id } } })), onSuccess: () => { sync(); toast.success("Room type removed"); } });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rooms = q.data ?? [];
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Dorm beds and private rooms guests can book. Prices are per bed or room per night, before GST.</p><Button onClick={() => setEdit("new")}><Plus />Add room type</Button></div>
      {q.isPending ? <div className="grid gap-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
        : rooms.length === 0 ? <EmptyState icon={BedDouble} title="No rooms yet" description="Add at least one room type with a price and a number of beds or rooms." action={<Button onClick={() => setEdit("new")}><Plus />Add your first room type</Button>} />
        : <ul className="grid gap-3">{rooms.map((r) => (
          <li key={r.id} className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[1fr_auto] sm:p-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold [overflow-wrap:anywhere]">{r.name}</h3><Badge tone="outline">{r.kind === "DORM" ? <><BedDouble />Dorm bed</> : <><DoorOpen />Private room</>}</Badge>{r.gender !== "MIXED" && <Badge tone="primary">{r.gender === "FEMALE" ? "Women" : "Men"} only</Badge>}{!r.isActive && <Badge tone="warning">Hidden from guests</Badge>}</div>
              <p className="tnum mt-1.5 text-sm text-muted-foreground"><b className="text-foreground">{money(r.basePricePaise)}</b> {r.priceUnit === "MONTH" ? "per month" : "per night"} · {plural(r.totalUnits, r.kind === "DORM" ? "bed" : "room")}{r.kind === "PRIVATE" ? ` · sleeps ${r.maxOccupancyPerUnit}` : ""} · stays of {r.minStayNights}–{r.maxStayNights} nights</p>
              {r.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{r.description}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <label className="mr-1 flex items-center gap-2 text-sm text-muted-foreground"><Switch checked={r.isActive} onCheckedChange={() => toggle.mutate(r)} aria-label={`${r.name} is bookable`} />Bookable</label>
              <Button variant="outline" size="sm" onClick={() => setRules(r)}><CalendarRange />Special prices</Button>
              <Button variant="outline" size="sm" onClick={() => setEdit(r)}><Pencil />Edit</Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.name}`} className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDel(r)}><Trash2 /></Button>
            </div>
          </li>
        ))}</ul>}
      {edit && <RoomDialog hostelId={hostelId} room={edit === "new" ? null : edit} open onOpenChange={(o) => !o && setEdit(null)} onSaved={sync} />}
      {rules && <PriceRulesDialog room={rules} open onOpenChange={(o) => !o && setRules(null)} />}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} destructive title={`Delete ${del?.name ?? "this room type"}?`} confirmLabel="Delete room type" description="Guests will no longer see it. This is blocked while it has upcoming bookings: hide it instead." onConfirm={() => remove.mutateAsync(del!.id)} />
      <Alert tone="info">Need to close dates for maintenance or a private event? Use the <a className="font-medium underline" href="/owner/calendar">calendar</a>.</Alert>
    </div>
  );
}
