"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField, describe } from "@/components/common/form-field";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { plural } from "@/lib/format";
import type { RoomType } from "./rooms-tab";

type Status = "ACTIVE" | "MAINTENANCE" | "RETIRED";

/** The physical beds/rooms of a long-term room type, e.g. "204-B3". Tenants are assigned to one. */
export function UnitsDialog({ room, open, onOpenChange }: { room: RoomType; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const key = ["owner", "units", room.id];
  const q = useQuery({ queryKey: key, queryFn: () => unwrapData(api.GET("/owner/room-types/{id}/units", { params: { path: { id: room.id } } })) });
  const [labels, setLabels] = React.useState("");
  const [floor, setFloor] = React.useState("");
  const sync = () => qc.invalidateQueries({ queryKey: key });
  const counted = q.data?.filter((u) => u.status !== "RETIRED").length ?? 0;
  const add = useMutation({
    mutationFn: () => unwrapData(api.POST("/owner/room-types/{id}/units", { params: { path: { id: room.id } }, body: { labels: labels.split(/[\n,]+/).map((l) => l.trim()).filter(Boolean), ...(floor !== "" ? { floor: Number(floor) } : {}) } })),
    onSuccess: (r) => { sync(); setLabels(""); toast.success(`${plural(r.length, "unit")} added`); },
  });
  const patch = useMutation({ mutationFn: (v: { id: string; status: Status }) => unwrapData(api.PATCH("/owner/units/{id}", { params: { path: { id: v.id } }, body: { status: v.status } })), onSuccess: sync, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => unwrapData(api.DELETE("/owner/units/{id}", { params: { path: { id } } })), onSuccess: sync, onError: (e) => toast.error(errorMessage(e)) });
  const room_noun = room.kind === "DORM" ? "bed" : "room";
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={`${room.name}: ${room_noun}s`} description={`${counted} of ${room.totalUnits} ${room_noun}s listed. Tenants are assigned to one of these.`}>
      <div className="grid max-h-[65dvh] gap-4 overflow-y-auto overscroll-contain p-0.5">
        {q.isPending ? <Skeleton className="h-32" /> : q.isError ? <Alert tone="danger">{errorMessage(q.error)}</Alert>
          : q.data.length === 0 ? <p className="text-sm text-muted-foreground">No {room_noun}s listed yet. Add their labels below.</p>
          : <ul className="grid gap-2">{q.data.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 rounded-xl border p-2.5">
              <span className="min-w-0 truncate font-medium">{u.label}{u.floor !== null && <span className="text-sm font-normal text-muted-foreground"> · floor {u.floor}</span>}</span>
              <span className="flex items-center gap-1.5">
                <Select value={u.status} onValueChange={(v) => patch.mutate({ id: u.id, status: v as Status })}><SelectTrigger className="h-9 w-36" aria-label={`Status of ${u.label}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ACTIVE">Available</SelectItem><SelectItem value="MAINTENANCE">Maintenance</SelectItem><SelectItem value="RETIRED">Retired</SelectItem></SelectContent></Select>
                <Button size="icon" variant="ghost" aria-label={`Remove ${u.label}`} onClick={() => remove.mutate(u.id)}><Trash2 /></Button>
              </span>
            </li>
          ))}</ul>}
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="grid gap-3 border-t pt-4" noValidate>
          {add.isError && <Alert tone="danger">{errorMessage(add.error)}</Alert>}
          <FormField label={`Add ${room_noun}s`} htmlFor="un-labels" hint="One label per line or separated by commas, e.g. 204-B1, 204-B2"><Textarea rows={3} value={labels} onChange={(e) => setLabels(e.target.value)} {...describe("un-labels", undefined, true)} /></FormField>
          <FormField label="Floor" htmlFor="un-floor" hint="Optional, applies to all labels above"><Input inputMode="numeric" className="sm:w-32" value={floor} onChange={(e) => setFloor(e.target.value.replace(/[^\d-]/g, ""))} {...describe("un-floor", undefined, true)} /></FormField>
          <div className="flex justify-end"><Button type="submit" loading={add.isPending} disabled={!labels.trim()}>Add</Button></div>
        </form>
      </div>
    </ResponsiveDialog>
  );
}
