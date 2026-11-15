"use client";
import * as React from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Input, Textarea } from "@/components/ui/input";
import { FormField, describe } from "@/components/common/form-field";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { api, unwrapData } from "@/lib/api/client";
import { addDays, fmtDate, localToday } from "@/lib/format";
import type { Item } from "@/lib/api/types";
import { Actions, useSubmit } from "@/features/owner/form-utils";

type Stay = Pick<Item<"/me/tenancies">, "id" | "noticeDays" | "hostel">;

/** Either side names the day the tenant will have moved out. The server enforces the stay's notice period; this just starts at the earliest day. */
export function NoticeDialog({ t, as, open, onOpenChange, onDone }: { t: Stay; as: "TENANT" | "OWNER"; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const earliest = addDays(localToday(), t.noticeDays);
  const [day, setDay] = React.useState(earliest);
  const [reason, setReason] = React.useState("");
  const f = useSubmit(() => {
    const body = { moveOutDate: day, ...(reason.trim() ? { reason: reason.trim() } : {}) };
    return as === "TENANT" ? unwrapData(api.POST("/me/tenancies/{id}/notice", { params: { path: { id: t.id } }, body })) : unwrapData(api.POST("/owner/tenancies/{id}/notice", { params: { path: { id: t.id } }, body }));
  }, () => { toast.success(as === "TENANT" ? "Notice given. The owner has been told." : "Notice served. The tenant has been told."); onDone(); onOpenChange(false); });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={as === "TENANT" ? "Give notice" : "Serve notice"} description={t.noticeDays > 0 ? `This stay needs ${t.noticeDays} days' notice. The earliest move-out is ${fmtDate(earliest, "long")}. Rent stops after the move-out day.` : "Choose the day the tenant moves out. Rent stops after that day."}>
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <FormField label="Move-out day" htmlFor="nt-day" error={f.fields.moveOutDate} required><Input type="date" min={earliest} value={day} onChange={(e) => setDay(e.target.value)} {...describe("nt-day", f.fields.moveOutDate)} /></FormField>
        <FormField label="Reason" htmlFor="nt-why" hint="Optional."><Textarea id="nt-why" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} /></FormField>
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label={as === "TENANT" ? "Give notice" : "Serve notice"} />
      </form>
    </ResponsiveDialog>
  );
}

/** The owner records that the tenant has left: the stay ends, the bed is free, and the deposit settlement starts. */
export function MoveOutDialog({ t, tenant, open, onOpenChange, onDone }: { t: { id: string; unit: { label: string } }; tenant: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [day, setDay] = React.useState(localToday());
  const [note, setNote] = React.useState("");
  const f = useSubmit(() => unwrapData(api.POST("/owner/tenancies/{id}/move-out", { params: { path: { id: t.id } }, body: { movedOutOn: day, ...(note.trim() ? { note: note.trim() } : {}) } })), () => { toast.success("Move-out recorded. You can settle the deposit now."); onDone(); onOpenChange(false); });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Record move-out" description={`${tenant} leaves bed ${t.unit.label}. Billing stops, the bed becomes free, and the deposit settlement starts. This cannot be undone.`}>
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <FormField label="Moved out on" htmlFor="mo-day" error={f.fields.movedOutOn} required><Input type="date" max={localToday()} value={day} onChange={(e) => setDay(e.target.value)} {...describe("mo-day", f.fields.movedOutOn)} /></FormField>
        <FormField label="Note" htmlFor="mo-note" hint="Optional: keys returned, room condition…"><Textarea id="mo-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} /></FormField>
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Record move-out" />
      </form>
    </ResponsiveDialog>
  );
}
