"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField, describe } from "@/components/common/form-field";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { addDays, localToday, money, plural } from "@/lib/format";
import { useUser } from "@/lib/session/use-session";
import type { Data } from "@/lib/api/types";

type Terms = Data<"/hostels/{idOrSlug}/tenancy-terms">;
type Gender = "MALE" | "FEMALE" | "OTHER";

/** Long-term properties are rented monthly: show the rent and terms, and let a signed-in student ask for a bed. */
export function ApplyCard({ hostel, className }: { hostel: { id: string; slug: string; name: string; genderPolicy: string; fromPricePaise: number | null }; className?: string }) {
  const { user } = useUser();
  const [open, setOpen] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const terms = useQuery({ queryKey: ["tenancy-terms", hostel.id], queryFn: () => unwrapData(api.GET("/hostels/{idOrSlug}/tenancy-terms", { params: { path: { idOrSlug: hostel.id } } })) });
  const free = terms.data?.rooms.reduce((n, r) => n + r.freeUnits, 0) ?? 0;
  const t = terms.data;
  return (
    <div className={`grid gap-4 rounded-2xl border bg-card p-5 shadow-lg ${className ?? ""}`}>
      <p className="tnum">{hostel.fromPricePaise !== null ? <><span className="text-sm text-muted-foreground">From </span><span className="text-2xl font-semibold">{money(hostel.fromPricePaise)}</span><span className="text-sm text-muted-foreground"> / month</span></> : <span className="text-sm text-muted-foreground">Rent on request</span>}</p>
      {t && (
        <ul className="grid gap-1.5 text-sm text-muted-foreground">
          <li>Deposit: <b className="font-medium text-foreground">{t.depositMonths === 0 ? "none" : plural(t.depositMonths, "month") + " of rent"}</b></li>
          <li>Notice period: <b className="font-medium text-foreground">{plural(t.noticeDays, "day")}</b></li>
          <li>Rent is due on the <b className="font-medium text-foreground">{t.rentDueDay}{ordinal(t.rentDueDay)}</b> ({plural(t.rentGraceDays, "day")} grace)</li>
          <li><b className="font-medium text-foreground">{free}</b> {free === 1 ? "bed" : "beds"} free right now</li>
        </ul>
      )}
      {sent ? <Alert tone="success"><span className="inline-flex items-center gap-2"><CheckCircle2 className="size-4" />Request sent. We&apos;ll notify you when the owner replies.</span></Alert>
        : !user ? <Button asChild size="lg"><Link href={`/login?next=${encodeURIComponent(`/hostels/${hostel.slug}`)}`}>Sign in to request a bed</Link></Button>
        : <Button size="lg" disabled={!t || free === 0} onClick={() => setOpen(true)}>{free === 0 && t ? "No beds free right now" : "Request a bed"}</Button>}
      <p className="flex items-start gap-2 text-xs text-muted-foreground"><CalendarClock className="mt-0.5 size-3.5 shrink-0" />Long-term stay. The owner reviews your request and confirms your move-in.</p>
      {t && open && <ApplyDialog hostel={hostel} terms={t} open={open} onOpenChange={setOpen} onSent={() => setSent(true)} />}
    </div>
  );
}

const ordinal = (n: number) => (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");

function ApplyDialog({ hostel, terms, open, onOpenChange, onSent }: { hostel: { id: string; name: string; genderPolicy: string }; terms: Terms; open: boolean; onOpenChange: (o: boolean) => void; onSent: () => void }) {
  const qc = useQueryClient();
  const rooms = terms.rooms.filter((r) => r.freeUnits > 0);
  const [roomTypeId, setRoom] = React.useState(rooms[0]?.roomTypeId ?? "");
  const [moveInDate, setDate] = React.useState(addDays(localToday(), 7));
  const [tenure, setTenure] = React.useState("");
  const [gender, setGender] = React.useState<Gender | "">("");
  const [occupation, setOccupation] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [contactName, setContactName] = React.useState("");
  const [contactPhone, setContactPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const room = rooms.find((r) => r.roomTypeId === roomTypeId);
  const needGender = hostel.genderPolicy !== "MIXED" || (room && room.gender !== "MIXED");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setFields({});
    try {
      await unwrapData(api.POST("/hostels/{idOrSlug}/tenancy-applications", { params: { path: { idOrSlug: hostel.id } }, body: {
        roomTypeId, moveInDate, ...(tenure ? { tenureMonths: Number(tenure) } : {}), ...(gender ? { gender } : {}), ...(occupation ? { occupation } : {}), ...(message ? { message } : {}),
        emergencyContactName: contactName, emergencyContactPhone: contactPhone.replace(/[\s-]/g, ""),
      } }));
      toast.success("Request sent");
      qc.invalidateQueries({ queryKey: ["me", "tenancy"] });
      qc.invalidateQueries({ queryKey: ["tenancy-terms", hostel.id] });
      onSent(); onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
      if (isApiError(err) && err.fieldErrors) setFields(err.fieldErrors);
    } finally { setBusy(false); }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Request a bed" description={`${hostel.name}. The owner decides, usually within a few days.`}>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <div className="grid max-h-[60dvh] gap-4 overflow-y-auto overscroll-contain p-0.5">
          {error && <Alert tone="danger">{error}</Alert>}
          <FormField label="Room" htmlFor="ap-room" error={fields.roomTypeId} required>
            <Select value={roomTypeId} onValueChange={setRoom}><SelectTrigger id="ap-room"><SelectValue /></SelectTrigger>
              <SelectContent>{rooms.map((r) => <SelectItem key={r.roomTypeId} value={r.roomTypeId}>{r.name} · {money(r.rentPaise)}/month · {r.freeUnits} free</SelectItem>)}</SelectContent></Select>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Move-in date" htmlFor="ap-date" error={fields.moveInDate} required><Input type="date" min={localToday()} max={addDays(localToday(), 180)} value={moveInDate} onChange={(e) => setDate(e.target.value)} {...describe("ap-date", fields.moveInDate)} /></FormField>
            <FormField label="Planned stay (months)" htmlFor="ap-tenure" error={fields.tenureMonths} hint="Optional"><Input inputMode="numeric" value={tenure} onChange={(e) => setTenure(e.target.value.replace(/\D/g, ""))} {...describe("ap-tenure", fields.tenureMonths, true)} /></FormField>
          </div>
          {needGender && (
            <FormField label="Your gender" htmlFor="ap-gender" error={fields.gender} required hint="This property or room is restricted by gender.">
              <Select value={gender} onValueChange={(v) => setGender(v as Gender)}><SelectTrigger id="ap-gender"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent><SelectItem value="FEMALE">Female</SelectItem><SelectItem value="MALE">Male</SelectItem><SelectItem value="OTHER">Other</SelectItem></SelectContent></Select>
            </FormField>
          )}
          <FormField label="Studying or working at" htmlFor="ap-occ" error={fields.occupation} hint="Optional"><Input value={occupation} onChange={(e) => setOccupation(e.target.value)} maxLength={100} {...describe("ap-occ", fields.occupation, true)} /></FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Emergency contact name" htmlFor="ap-cn" error={fields.emergencyContactName} required><Input value={contactName} onChange={(e) => setContactName(e.target.value)} autoComplete="off" {...describe("ap-cn", fields.emergencyContactName)} /></FormField>
            <FormField label="Emergency contact phone" htmlFor="ap-cp" error={fields.emergencyContactPhone} required hint="With country code, e.g. +919876543210"><Input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} autoComplete="off" {...describe("ap-cp", fields.emergencyContactPhone, true)} /></FormField>
          </div>
          <FormField label="Message to the owner" htmlFor="ap-msg" error={fields.message} hint="Optional"><Textarea rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} {...describe("ap-msg", fields.message, true)} /></FormField>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button><Button type="submit" loading={busy} disabled={!roomTypeId}>Send request</Button></div>
      </form>
    </ResponsiveDialog>
  );
}
