"use client";
import * as React from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField, describe } from "@/components/common/form-field";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { api, unwrapData } from "@/lib/api/client";
import { Actions, useSubmit } from "@/features/owner/form-utils";
import { TRADES, tradeLabel } from "@/features/complaints/common";

type Trade = (typeof TRADES)[number];
export interface HostelOption { id: string; name: string }

/** Invite by email. Owners must pick the properties; admins inviting a platform vendor pass no `hostels`. */
export function InviteDialog({ hostels, open, onOpenChange, onDone }: { hostels?: HostelOption[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [email, setEmail] = React.useState("");
  const [trade, setTrade] = React.useState<Trade>("ELECTRICIAN");
  const [picked, setPicked] = React.useState<string[]>(hostels?.length === 1 ? [hostels[0]!.id] : []);
  const f = useSubmit(() => hostels
    ? unwrapData(api.POST("/owner/staff/invites", { body: { email: email.trim(), trade, hostelIds: picked } }))
    : unwrapData(api.POST("/admin/staff/invites", { body: { email: email.trim(), trade } })),
  () => { toast.success("Invitation sent"); onDone(); onOpenChange(false); });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={hostels ? "Invite staff" : "Invite a vendor"} description={hostels ? "They get an email with a link. It works for 7 days." : "A vendor can then be engaged by any owner for their properties."}>
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <FormField label="Email" htmlFor="si-email" error={f.fields.email} required><Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} {...describe("si-email", f.fields.email)} /></FormField>
        <FormField label="Trade" htmlFor="si-trade"><Select value={trade} onValueChange={(v) => setTrade(v as Trade)}><SelectTrigger id="si-trade"><SelectValue /></SelectTrigger><SelectContent>{TRADES.map((t) => <SelectItem key={t} value={t}>{tradeLabel(t)}</SelectItem>)}</SelectContent></Select></FormField>
        {hostels && <FormField label="Works at" error={f.fields.hostelIds} required>
          {hostels.length === 0 ? <p className="text-sm text-muted-foreground">Add a hostel or PG first.</p> : <PropertyPicker hostels={hostels} value={picked} onChange={setPicked} />}</FormField>}
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Send invitation" />
      </form>
    </ResponsiveDialog>
  );
}

export function PropertyPicker({ hostels, value, onChange }: { hostels: HostelOption[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <ul className="grid gap-1.5" role="group" aria-label="Properties">{hostels.map((h) => (
      <li key={h.id}><label className="flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 text-sm"><input type="checkbox" className="size-4" checked={value.includes(h.id)} onChange={(e) => onChange(e.target.checked ? [...value, h.id] : value.filter((x) => x !== h.id))} /><span className="min-w-0 [overflow-wrap:anywhere]">{h.name}</span></label></li>))}</ul>
  );
}
