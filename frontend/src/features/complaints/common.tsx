"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Clock, ImageIcon, MessageSquare, Star } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/error-state";
import { FileDrop } from "@/components/common/file-drop";
import { FormField } from "@/components/common/form-field";
import { StarInput, Stars } from "@/components/common/rating";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrapData } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { fmtDateTime, plural, timeAgo, titleCase } from "@/lib/format";
import { uploadToCloudinary } from "@/lib/upload";
import type { Data, Item } from "@/lib/api/types";
import { Actions, useSubmit } from "@/features/owner/form-utils";
import { FreeTimeFields, defaultFreeTime, fmtSpan, freeTimeRange, toInstant, type FreeTime } from "./availability";

export type ComplaintRow = Item<"/me/complaints">;
export type ComplaintDetail = Data<"/complaints/{id}">;
export type Priority = ComplaintRow["priority"];
export const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
export const CATEGORIES = ["ELECTRICAL", "PLUMBING", "CARPENTRY", "CLEANING", "FOOD", "WIFI", "SECURITY", "BEHAVIOUR", "OTHER"] as const;
export const STATUSES = ["OPEN", "ACKNOWLEDGED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED", "REOPENED", "REJECTED"] as const;
export const TRADES = ["ELECTRICIAN", "PLUMBER", "CARPENTER", "CLEANER", "COOK", "SECURITY", "WARDEN", "NETWORK", "OTHER"] as const;
export const tradeLabel = (t: string) => (t === "NETWORK" ? "Wi-Fi / network" : titleCase(t));

export const PriorityBadge = ({ priority }: { priority: Priority }) => <Badge tone={priority === "URGENT" ? "danger" : priority === "HIGH" ? "warning" : "outline"}>{titleCase(priority)}</Badge>;

/** One complaint in a list: the same card for every role; `who` says what the second line shows. */
export function ComplaintCard({ c, onOpen, who }: { c: ComplaintRow; onOpen: () => void; who: "tenant" | "owner" | "staff" }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="grid w-full gap-1.5 rounded-2xl border bg-card p-4 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex flex-wrap items-center gap-2"><span className="font-semibold [overflow-wrap:anywhere]">{c.title}</span><StatusBadge status={c.status} /><PriorityBadge priority={c.priority} />{c.slaBreached && <Badge tone="danger">Overdue</Badge>}</span>
        <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {who === "owner" ? `${c.raisedBy.name ?? "Tenant"} · bed ${c.unitLabel} · ${c.hostel.name}` : who === "staff" ? `${c.hostel.name} · bed ${c.unitLabel}${c.location ? ` · ${c.location}` : ""}` : `${c.hostel.name} · ${titleCase(c.category)}`}
        </span>
        <span className="tnum flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-mono">{c.code}</span><span>{timeAgo(c.createdAt)}</span>
          {c.visit ? <span className="font-medium text-foreground">Visit {fmtSpan(c.visit.start, c.visit.end)}</span> : c.availability && ["ASSIGNED", "IN_PROGRESS", "ON_HOLD", "REOPENED"].includes(c.status) && who !== "tenant" ? <span>Free {fmtSpan(c.availability.from, c.availability.to)}</span> : null}
          {c.assignedStaff && who !== "staff" && <span>With {c.assignedStaff.name ?? "staff"}{c.assignedStaff.trade ? ` (${tradeLabel(c.assignedStaff.trade)})` : ""}</span>}
          {c.mediaCount > 0 && <span className="inline-flex items-center gap-1"><ImageIcon className="size-3" aria-hidden />{c.mediaCount}</span>}
          {c.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="size-3" aria-hidden />{c.commentCount}</span>}
          {c.rating !== null && <Stars value={c.rating} size="size-3" />}
        </span>
      </button>
    </li>
  );
}

type Sub = null | "reopen" | "rate" | "close" | "reject" | "resolve" | "hold" | "assign" | "priority" | "unassign" | "schedule" | "availability";

/**
 * The complaint's whole story for whoever is looking: photos, timeline, comments, and exactly the actions the server says this
 * person may take right now (`actions`). Nothing here decides permissions; it only renders what the API allows.
 */
export function ComplaintDialog({ id, open, onOpenChange, onChanged }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const key = ["complaint", id];
  const q = useQuery({ queryKey: key, queryFn: () => unwrapData(api.GET("/complaints/{id}", { params: { path: { id } } })) });
  const [sub, setSub] = React.useState<Sub>(null);
  const c = q.data;
  // Sub-dialogs close themselves when they succeed. Resetting `sub` here would also close one the user opened while a quick action was still in flight.
  const refreshed = () => { qc.invalidateQueries({ queryKey: key }); onChanged(); };
  const can = (a: ComplaintDetail["actions"][number]) => !!c?.actions.includes(a);

  async function act(body: Record<string, unknown>) {
    if (!c) return;
    const call = c.viewer === "TENANT" ? api.POST("/me/complaints/{id}/actions", { params: { path: { id } }, body: body as never })
      : c.viewer === "OWNER" ? api.POST("/owner/complaints/{id}/actions", { params: { path: { id } }, body: body as never })
      : api.POST("/staff/complaints/{id}/actions", { params: { path: { id } }, body: body as never });
    await unwrapData(call);
    refreshed();
  }
  const quick = async (body: Record<string, unknown>, done: string) => { try { await act(body); toast.success(done); } catch (e) { toast.error(errorMessage(e)); } };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={c ? c.title : "Complaint"} description={c ? `${c.code} · ${c.hostel.name} · bed ${c.unitLabel}` : undefined} className="sm:max-w-xl">
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !c ? <Skeleton className="h-56" /> : (
        <div className="grid max-h-[68dvh] gap-5 overflow-y-auto overscroll-contain p-0.5 text-sm">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} /><PriorityBadge priority={c.priority} /><Badge tone="outline">{titleCase(c.category)}</Badge>
            {c.slaBreached ? <Badge tone="danger">Overdue</Badge> : ["OPEN", "ACKNOWLEDGED", "ASSIGNED", "IN_PROGRESS", "REOPENED"].includes(c.status) && <span className="tnum inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3" aria-hidden />Respond by {fmtDateTime(c.slaDueAt)}</span>}</div>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{c.description}</p>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {c.viewer !== "TENANT" && <div><dt className="text-muted-foreground">Raised by</dt><dd>{c.raisedBy.name ?? "Tenant"}{c.raisedBy.phone ? ` · ${c.raisedBy.phone}` : ""}</dd></div>}
            {c.location && <div><dt className="text-muted-foreground">Where</dt><dd>{c.location}</dd></div>}
            {c.availability && <div className="sm:col-span-2"><dt className="text-muted-foreground">{c.viewer === "TENANT" ? "Your free time" : "Tenant is free"}</dt><dd className="tnum">{fmtSpan(c.availability.from, c.availability.to)} <span className="text-muted-foreground">· {c.availability.allowEntryIfAway ? "staff may go in if nobody is home" : "someone will be home"}</span></dd></div>}
            {c.visit ? <div className="sm:col-span-2"><dt className="text-muted-foreground">Visit booked</dt><dd className="tnum font-medium">{fmtSpan(c.visit.start, c.visit.end)}</dd></div>
              : c.actions.includes("schedule") ? <div className="sm:col-span-2"><dt className="text-muted-foreground">Visit</dt><dd>Not booked yet</dd></div> : null}
            <div><dt className="text-muted-foreground">Assigned to</dt><dd>{c.assignedStaff ? `${c.assignedStaff.name ?? "Staff"}${c.assignedStaff.trade ? ` (${tradeLabel(c.assignedStaff.trade)})` : ""}` : "Nobody yet"}</dd></div>
            {c.resolutionNote && <div className="sm:col-span-2"><dt className="text-muted-foreground">How it was resolved</dt><dd className="[overflow-wrap:anywhere]">{c.resolutionNote}</dd></div>}
            {c.rating !== null && <div><dt className="text-muted-foreground">Rating</dt><dd><Stars value={c.rating} />{c.feedback ? <span className="mt-0.5 block [overflow-wrap:anywhere]">“{c.feedback}”</span> : null}</dd></div>}
          </dl>

          <Photos c={c} onAdded={refreshed} />

          {(c.actions.some((a) => a !== "comment" && a !== "add_photo")) && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {can("acknowledge") && <Button size="sm" variant="outline" onClick={() => quick({ action: "acknowledge" }, "Marked as seen")}>Mark as seen</Button>}
              {can("schedule") && <Button size="sm" variant={c.visit ? "outline" : "default"} onClick={() => setSub("schedule")}><CalendarClock />{c.visit ? "Change visit time" : "Book a visit"}</Button>}
              {can("set_availability") && <Button size="sm" variant="outline" onClick={() => setSub("availability")}><CalendarClock />Change my free time</Button>}
              {can("assign") && <Button size="sm" onClick={() => setSub("assign")}>{c.assignedStaff ? "Reassign" : "Assign"}</Button>}
              {can("start") && <Button size="sm" onClick={() => quick({ action: "start" }, c.status === "ON_HOLD" ? "Resumed" : "Started")}>{c.status === "ON_HOLD" ? "Resume work" : "Start work"}</Button>}
              {can("hold") && <Button size="sm" variant="outline" onClick={() => setSub("hold")}>Put on hold</Button>}
              {can("resolve") && <Button size="sm" onClick={() => setSub("resolve")}>Mark resolved</Button>}
              {can("set_priority") && <Button size="sm" variant="outline" onClick={() => setSub("priority")}>Change priority</Button>}
              {can("unassign") && <Button size="sm" variant="ghost" onClick={() => setSub("unassign")}>Take back</Button>}
              {can("reject") && <Button size="sm" variant="ghost" onClick={() => setSub("reject")}>Decline</Button>}
              {can("rate") && <Button size="sm" onClick={() => setSub("rate")}><Star />Rate the fix</Button>}
              {can("reopen") && <Button size="sm" variant="outline" onClick={() => setSub("reopen")}>It isn’t fixed</Button>}
              {can("close") && <Button size="sm" variant="ghost" onClick={() => setSub("close")}>{c.status === "RESOLVED" ? "Close it" : "Withdraw"}</Button>}
            </div>
          )}

          <Timeline c={c} />
          <Comments c={c} onPosted={refreshed} />
        </div>
      )}
      {c && sub === "reopen" && <ReopenDialog open onOpenChange={(o) => !o && setSub(null)} onSubmit={async (reason, range) => { await act({ action: "reopen", reason, ...range }); toast.success("Complaint reopened"); }} />}
      {c && sub === "availability" && <AvailabilityDialog open onOpenChange={(o) => !o && setSub(null)} onSubmit={async (range) => { await act({ action: "set_availability", ...range }); toast.success("Free time updated"); }} />}
      {c && sub === "schedule" && <ScheduleDialog c={c} open onOpenChange={(o) => !o && setSub(null)} onSubmit={async (visitStart, visitEnd) => { await act({ action: "schedule", visitStart, visitEnd }); toast.success("Visit booked. The tenant has been told."); }} />}
      <ConfirmDialog open={sub === "close"} onOpenChange={(o) => !o && setSub(null)} title={c?.status === "RESOLVED" ? "Close this complaint?" : "Withdraw this complaint?"} description={c?.status === "RESOLVED" ? "You can still rate the fix afterwards." : "Nobody will work on it any more."} confirmLabel={c?.status === "RESOLVED" ? "Close" : "Withdraw"}
        onConfirm={async () => { await act({ action: "close" }); toast.success("Complaint closed"); }} />
      <ConfirmDialog open={sub === "reject"} onOpenChange={(o) => !o && setSub(null)} title="Decline this complaint?" description="The tenant is told why. This cannot be undone." confirmLabel="Decline" destructive reason={{ label: "Reason", required: true, max: 500 }}
        onConfirm={async (reason) => { await act({ action: "reject", reason }); toast.success("Complaint declined"); }} />
      <ConfirmDialog open={sub === "hold"} onOpenChange={(o) => !o && setSub(null)} title="Put this on hold?" description="The tenant and owner will see why." confirmLabel="Put on hold" reason={{ label: "Why?", required: true, placeholder: "Waiting for a spare part…", max: 500 }}
        onConfirm={async (reason) => { await act({ action: "hold", reason }); toast.success("On hold"); }} />
      <ConfirmDialog open={sub === "resolve"} onOpenChange={(o) => !o && setSub(null)} title="Mark as resolved?" description="Say what you did. The tenant is asked to confirm it is fixed." confirmLabel="Resolved" reason={{ label: "What was done?", required: true, max: 500 }}
        onConfirm={async (note) => { await act({ action: "resolve", note }); toast.success("Marked resolved"); }} />
      <ConfirmDialog open={sub === "unassign"} onOpenChange={(o) => !o && setSub(null)} title="Take this back?" description="It returns to your inbox with nobody assigned." confirmLabel="Take back"
        onConfirm={async () => { await act({ action: "unassign" }); toast.success("Unassigned"); }} />
      {c && sub === "rate" && <RateDialog open onOpenChange={(o) => !o && setSub(null)} onSubmit={async (rating, feedback) => { await act({ action: "rate", rating, ...(feedback ? { feedback } : {}) }); toast.success("Thanks for the feedback"); }} />}
      {c && sub === "priority" && <PriorityDialog current={c.priority} open onOpenChange={(o) => !o && setSub(null)} onSubmit={async (priority) => { await act({ action: "priority", priority }); toast.success("Priority changed"); }} />}
      {c && sub === "assign" && <AssignDialog c={c} open onOpenChange={(o) => !o && setSub(null)} onSubmit={async (staffUserId) => { await act({ action: "assign", staffUserId }); toast.success("Assigned"); }} />}
    </ResponsiveDialog>
  );
}

function Photos({ c, onAdded }: { c: ComplaintDetail; onAdded: () => void }) {
  const [busy, setBusy] = React.useState(false);
  async function onFiles(files: File[]) {
    setBusy(true);
    try {
      for (const file of files.slice(0, 6 - c.media.length)) {
        try { const { publicId } = await uploadToCloudinary(file, "COMPLAINT_IMAGE", { complaintId: c.id }); await unwrapData(api.POST("/complaints/{id}/media", { params: { path: { id: c.id } }, body: { publicId } })); }
        catch (e) { toast.error(`${file.name}: ${errorMessage(e)}`); }
      }
    } finally { setBusy(false); onAdded(); }
  }
  if (c.media.length === 0 && !c.actions.includes("add_photo")) return null;
  return (
    <section aria-label="Photos" className="grid gap-2">
      {c.media.length > 0 && <ul className="grid grid-cols-3 gap-2">{c.media.map((m, i) => (
        <li key={m.id}><a href={m.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">{ }<img src={m.url} alt={`Photo ${i + 1}, added by the ${m.uploadedByRole.toLowerCase()}`} loading="lazy" className="aspect-square size-full object-cover" /></a></li>))}</ul>}
      {c.actions.includes("add_photo") && c.media.length < 6 && <FileDrop accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onFiles={onFiles} label={busy ? "Uploading…" : "Add photos"} hint={`${plural(6 - c.media.length, "more photo")} allowed`} className="py-4" />}
    </section>
  );
}

function Timeline({ c }: { c: ComplaintDetail }) {
  return (
    <section aria-label="Progress" className="grid gap-2">
      <h3 className="font-semibold">Progress</h3>
      <ol className="grid gap-2 border-l pl-4">{[...c.history].reverse().map((h) => (
        <li key={h.id} className="relative"><span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-primary ring-2 ring-background" aria-hidden />
          <p><StatusBadge status={h.toStatus} /> <span className="text-muted-foreground">by {h.actorRole === "SYSTEM" ? "the system" : h.actorRole.toLowerCase()} · {fmtDateTime(h.createdAt)}</span></p>
          {h.note && <p className="mt-0.5 [overflow-wrap:anywhere]">{h.note}</p>}</li>))}</ol>
    </section>
  );
}

function Comments({ c, onPosted }: { c: ComplaintDetail; onPosted: () => void }) {
  const [body, setBody] = React.useState("");
  const [internal, setInternal] = React.useState(false);
  const f = useSubmit(() => unwrapData(api.POST("/complaints/{id}/comments", { params: { path: { id: c.id } }, body: { body, internal } })), () => { setBody(""); setInternal(false); onPosted(); });
  const canInternal = c.viewer === "OWNER" || c.viewer === "STAFF";
  return (
    <section aria-label="Comments" className="grid gap-3">
      <h3 className="font-semibold">Comments</h3>
      {c.comments.length === 0 ? <p className="text-muted-foreground">No comments yet.</p> : (
        <ul className="grid gap-2">{c.comments.map((m) => (
          <li key={m.id} className={`rounded-xl p-3 ${m.internal ? "border border-dashed bg-warning/10" : "bg-muted/50"}`}>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">{m.authorName}</span><span>{titleCase(m.authorRole)}</span>{m.internal && <Badge tone="warning">Staff only</Badge>}<span>{timeAgo(m.createdAt)}</span></p>
            <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</p></li>))}</ul>)}
      {c.actions.includes("comment") && (
        <form onSubmit={f.submit} className="grid gap-2" noValidate>
          {f.error && <Alert tone="danger">{f.error}</Alert>}
          <Textarea aria-label="Add a comment" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={2} placeholder="Write a comment…" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {canInternal ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="size-4" />Visible to staff and owner only</label> : <span />}
            <Button type="submit" size="sm" loading={f.busy} disabled={!body.trim()}>Post</Button>
          </div>
        </form>
      )}
    </section>
  );
}

function ReopenDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (reason: string, range: { availableFrom: string; availableTo: string; allowEntryIfAway: boolean }) => Promise<void> }) {
  const [reason, setReason] = React.useState("");
  const [free, setFree] = React.useState<FreeTime>(defaultFreeTime());
  const f = useSubmit(async () => {
    if (reason.trim().length < 3) throw new ApiError(422, "VALIDATION_FAILED", "Tell us what is still wrong");
    const range = freeTimeRange(free);
    if (typeof range === "string") throw new ApiError(422, "VALIDATION_FAILED", range);
    await onSubmit(reason.trim(), range);
  }, () => onOpenChange(false));
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="It isn’t fixed" description="Tell us what is still wrong and when someone can come back. It goes back to the owner.">
      <form onSubmit={f.submit} className="grid max-h-[68dvh] gap-4 overflow-y-auto p-0.5" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <FormField label="What is still wrong?" htmlFor="ro-why" required><Textarea id="ro-why" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} /></FormField>
        <FreeTimeFields value={free} onChange={setFree} idPrefix="ro" />
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Reopen" />
      </form>
    </ResponsiveDialog>
  );
}

function AvailabilityDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (range: { availableFrom: string; availableTo: string; allowEntryIfAway: boolean }) => Promise<void> }) {
  const [free, setFree] = React.useState<FreeTime>(defaultFreeTime());
  const f = useSubmit(async () => {
    const range = freeTimeRange(free);
    if (typeof range === "string") throw new ApiError(422, "VALIDATION_FAILED", range);
    await onSubmit(range);
  }, () => onOpenChange(false));
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Change your free time" description="If a visit was already booked outside this time, staff are asked to book a new one.">
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <FreeTimeFields value={free} onChange={setFree} idPrefix="av" error={f.fields.availableFrom ?? f.fields.availableTo} />
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Save" />
      </form>
    </ResponsiveDialog>
  );
}

/** Staff and owners book the visit inside the tenant's free time; the server re-checks it and tells the tenant. */
function ScheduleDialog({ c, open, onOpenChange, onSubmit }: { c: ComplaintDetail; open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (start: string, end: string) => Promise<void> }) {
  const [init] = React.useState(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = (iso: string) => { const d = new Date(iso); return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; };
    const base = c.visit?.start ?? c.availability?.from ?? new Date(Date.now() + 3_600_000).toISOString();
    return { s: local(base), e: local(c.visit?.end ?? new Date(new Date(base).getTime() + 3_600_000).toISOString()) };
  });
  const [date, setDate] = React.useState(init.s.date);
  const [from, setFrom] = React.useState(init.s.time);
  const [to, setTo] = React.useState(init.e.time);
  const f = useSubmit(async () => {
    const a = toInstant(date, from);
    const b = toInstant(date, to);
    if (!a || !b) throw new ApiError(422, "VALIDATION_FAILED", "Choose a day and a start and end time");
    await onSubmit(a, b);
  }, () => onOpenChange(false));
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={c.visit ? "Change the visit time" : "Book a visit"} description={c.availability ? `The tenant is free ${fmtSpan(c.availability.from, c.availability.to)}. Pick a time inside it.` : "Pick a time that suits you both."}>
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        {c.availability && !c.availability.allowEntryIfAway && <Alert tone="info">The tenant wants someone to be home during the visit.</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Day" htmlFor="sv-date" error={f.fields.visitStart}><Input id="sv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FormField>
          <FormField label="From" htmlFor="sv-from"><Input id="sv-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></FormField>
          <FormField label="Until" htmlFor="sv-to" error={f.fields.visitEnd}><Input id="sv-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} /></FormField>
        </div>
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label={c.visit ? "Save visit" : "Book visit"} />
      </form>
    </ResponsiveDialog>
  );
}

function RateDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (rating: number, feedback: string) => Promise<void> }) {
  const [rating, setRating] = React.useState<number | null>(null);
  const [feedback, setFeedback] = React.useState("");
  const f = useSubmit(async () => { if (!rating) throw new ApiError(422, "VALIDATION_FAILED", "Pick a star rating"); await onSubmit(rating, feedback.trim()); }, () => onOpenChange(false));
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Rate the fix" description="Was the problem fixed well?">
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <StarInput value={rating} onChange={setRating} label="Rating" />
        <FormField label="Anything to add?" htmlFor="cr-fb"><Textarea id="cr-fb" value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={500} rows={3} /></FormField>
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Send rating" />
      </form>
    </ResponsiveDialog>
  );
}

function PriorityDialog({ current, open, onOpenChange, onSubmit }: { current: Priority; open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (p: Priority) => Promise<void> }) {
  const [p, setP] = React.useState<Priority>(current);
  const f = useSubmit(() => onSubmit(p), () => onOpenChange(false));
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Change priority" description="Urgent complaints must be answered within 4 hours, high within a day.">
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <Select value={p} onValueChange={(v) => setP(v as Priority)}><SelectTrigger aria-label="Priority"><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map((x) => <SelectItem key={x} value={x}>{titleCase(x)}</SelectItem>)}</SelectContent></Select>
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Save" />
      </form>
    </ResponsiveDialog>
  );
}

function AssignDialog({ c, open, onOpenChange, onSubmit }: { c: ComplaintDetail; open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (id: string) => Promise<void> }) {
  const team = useQuery({ queryKey: ["owner", "staff"], queryFn: () => unwrapData(api.GET("/owner/staff")) });
  const options = (team.data?.staff ?? []).filter((s) => s.status === "ACTIVE" && s.hostels.some((h) => h.id === c.hostel.id));
  const [id, setId] = React.useState("");
  const f = useSubmit(() => onSubmit(id), () => onOpenChange(false));
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Assign to staff" description="Only people working at this property are listed.">
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        {team.isPending ? <Skeleton className="h-10" /> : options.length === 0 ? <Alert tone="info">Nobody is working at this property yet. Invite staff or engage a vendor on the Staff page.</Alert>
          : <Select value={id} onValueChange={setId}><SelectTrigger aria-label="Staff member"><SelectValue placeholder="Choose a person" /></SelectTrigger><SelectContent>{options.map((s) => <SelectItem key={s.userId} value={s.userId}>{s.name ?? s.email} · {tradeLabel(s.trade)} · {s.openJobs} open</SelectItem>)}</SelectContent></Select>}
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Assign" />
      </form>
    </ResponsiveDialog>
  );
}

/** Shared list screen body: status tabs + dialog wiring. */
export function useOpenFromUrl(param = "open") {
  const fromUrl = useSearchParams().get(param);
  const [id, setId] = React.useState<string | null>(fromUrl);
  return [id, setId] as const;
}
