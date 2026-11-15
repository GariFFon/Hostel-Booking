"use client";
import * as React from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { FormField, describe } from "@/components/common/form-field";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { addDays, fmtDate, localToday, money } from "@/lib/format";
import { isLongTerm } from "@/lib/property";
import type { Item } from "@/lib/api/types";
import { Actions, useSubmit } from "./form-utils";
import { MoveOutDialog, NoticeDialog } from "@/features/tenancy/move-out-dialogs";
import { DocButton } from "@/features/rent/payment-actions";
import { OwnerSettlementDialog } from "@/features/tenancy/settlement";

type Application = Item<"/owner/tenancy-applications">;
type Tenancy = Item<"/owner/tenancies">;
type Method = "CASH" | "UPI" | "BANK";
const rupees = (s: string) => Math.round(Number(s) * 100);
const STATUSES = ["INVITED", "PENDING_MOVE_IN", "ACTIVE", "NOTICE", "ENDED", "CANCELLED"] as const;

export function OwnerTenants() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<"requests" | "stays">("requests");
  const [hostelId, setHostelId] = React.useState("all");
  const [status, setStatus] = React.useState<string>("all");
  const [approve, setApprove] = React.useState<Application | null>(null);
  const [reject, setReject] = React.useState<Application | null>(null);
  const [add, setAdd] = React.useState(false);
  const [terms, setTerms] = React.useState(false);
  const [edit, setEdit] = React.useState<Tenancy | null>(null);
  const [deposit, setDeposit] = React.useState<Tenancy | null>(null);
  const [activate, setActivate] = React.useState<Tenancy | null>(null);
  const [cancel, setCancel] = React.useState<Tenancy | null>(null);
  const [notice, setNotice] = React.useState<Tenancy | null>(null);
  const [moveOut, setMoveOut] = React.useState<Tenancy | null>(null);
  const [settle, setSettle] = React.useState<Tenancy | null>(null);

  const hostels = useQuery({ queryKey: ["owner", "hostels", "options"], staleTime: 60_000, queryFn: () => unwrapData(api.GET("/owner/hostels", { params: { query: { limit: 50 } } })) });
  const longTerm = (hostels.data ?? []).filter((h) => isLongTerm(h.propertyType));
  const sync = () => { qc.invalidateQueries({ queryKey: ["owner", "tenancy"] }); };

  const apps = useInfiniteQuery({
    queryKey: ["owner", "tenancy", "apps", hostelId], initialPageParam: undefined as string | undefined, enabled: tab === "requests",
    queryFn: ({ pageParam }) => unwrap(api.GET("/owner/tenancy-applications", { params: { query: { limit: 15, status: "REQUESTED" as const, ...(hostelId !== "all" ? { hostelId } : {}), ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const stays = useInfiniteQuery({
    queryKey: ["owner", "tenancy", "stays", hostelId, status], initialPageParam: undefined as string | undefined, enabled: tab === "stays",
    queryFn: ({ pageParam }) => unwrap(api.GET("/owner/tenancies", { params: { query: { limit: 15, ...(status !== "all" ? { status: status as (typeof STATUSES)[number] } : {}), ...(hostelId !== "all" ? { hostelId } : {}), ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const q = tab === "requests" ? apps : stays;
  const appItems = apps.data?.pages.flatMap((p) => p.data) ?? [];
  const stayItems = stays.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="grid gap-6">
      <PageHeader title="Tenants" description="Requests for beds, and the people who live at your hostels and PGs."
        actions={<div className="flex gap-2">{hostelId !== "all" && <Button variant="outline" onClick={() => setTerms(true)}>Terms</Button>}<Button onClick={() => setAdd(true)} disabled={longTerm.length === 0}><UserPlus />Add tenant</Button></div>} />
      {hostels.isSuccess && longTerm.length === 0 && <Alert tone="info">Tenants live at hostels and PGs. Create a Hostel or PG listing first (hotels take nightly bookings instead).</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "requests" | "stays")}><TabsList><TabsTrigger value="requests">Requests</TabsTrigger><TabsTrigger value="stays">Stays</TabsTrigger></TabsList></Tabs>
        <div className="flex flex-wrap gap-2">
          {longTerm.length > 1 && <Select value={hostelId} onValueChange={setHostelId}><SelectTrigger className="h-10 w-auto min-w-44 md:h-9" aria-label="Filter by property"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All properties</SelectItem>{longTerm.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent></Select>}
          {tab === "stays" && <Select value={status} onValueChange={setStatus}><SelectTrigger className="h-10 w-auto min-w-36 md:h-9" aria-label="Filter by status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any status</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}><StatusBadge status={s} /></SelectItem>)}</SelectContent></Select>}
        </div>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
        : tab === "requests" ? (appItems.length === 0 ? <EmptyState icon={Users} title="No requests waiting" description="When a student asks for a bed, it shows up here." />
          : <ul className="grid gap-3">{appItems.map((a) => <li key={a.id} className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><p className="flex flex-wrap items-center gap-2"><span className="font-semibold [overflow-wrap:anywhere]">{a.applicant.name ?? a.applicant.email}</span><StatusBadge status={a.status} /></p>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{a.applicant.email}{a.applicant.phone ? ` · ${a.applicant.phone}` : ""}</p></div>
              <p className="text-right text-sm text-muted-foreground">{a.hostel.name}<br />{a.roomType.name}</p>
            </div>
            <dl className="tnum grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Move-in</dt><dd>{fmtDate(a.moveInDate, "long")}</dd></div>
              {a.tenureMonths && <div><dt className="text-muted-foreground">Planned stay</dt><dd>{a.tenureMonths} months</dd></div>}
              {a.occupation && <div><dt className="text-muted-foreground">Studying/working</dt><dd className="[overflow-wrap:anywhere]">{a.occupation}</dd></div>}
              <div><dt className="text-muted-foreground">Emergency contact</dt><dd className="[overflow-wrap:anywhere]">{a.emergencyContact.name} · {a.emergencyContact.phone}</dd></div>
            </dl>
            {a.message && <p className="rounded-xl bg-muted/50 p-3 text-sm [overflow-wrap:anywhere]">{a.message}</p>}
            {a.actions.length > 0 && <div className="flex flex-wrap gap-2 border-t pt-3"><Button size="sm" onClick={() => setApprove(a)}><Check />Approve</Button><Button size="sm" variant="outline" onClick={() => setReject(a)}><X />Decline</Button></div>}
          </li>)}</ul>)
        : stayItems.length === 0 ? <EmptyState icon={Users} title="No stays here" description="Approve a request or add a tenant to see their stay." />
        : <ul className="grid gap-3">{stayItems.map((t) => <li key={t.id} className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><p className="flex flex-wrap items-center gap-2"><span className="font-semibold [overflow-wrap:anywhere]">{t.tenant?.name ?? t.tenant?.email ?? t.inviteEmail}</span><StatusBadge status={t.status} /></p>
              <p className="text-sm text-muted-foreground">{t.hostel.name} · {t.roomType.name} · bed {t.unit.label}</p></div>
            <div className="text-right"><p className="tnum text-lg font-semibold">{money(t.rentPaise)}<span className="text-sm font-normal text-muted-foreground"> / month</span></p><p className="font-mono text-xs text-muted-foreground">{t.code}</p></div>
          </div>
          <p className="tnum text-sm text-muted-foreground">From {fmtDate(t.startDate)} · deposit {t.deposit.status === "NONE" ? "none" : `${money(t.depositPaise)} ${t.deposit.status === "RECEIVED" ? "received" : "due"}`} · rent due on the {t.dueDay}th</p>
          {t.depositWarning && <Alert tone="warning">{t.depositWarning}</Alert>}
          {t.notice && t.status === "NOTICE" && <Alert tone="info" title={`Moving out on ${fmtDate(t.notice.moveOutDate ?? t.startDate, "long")}`}>{t.notice.by === "TENANT" ? "The tenant gave notice." : "You served notice."}{t.notice.reason ? ` ${t.notice.reason}` : ""}</Alert>}
          {t.status === "ENDED" && t.movedOutAt && <p className="text-sm text-muted-foreground">Moved out on {fmtDate(t.endDate ?? t.startDate, "long")}.{t.settlement ? ` Deposit settlement: ${t.settlement.status.toLowerCase().replace("_", " ")}.` : ""}</p>}
          {t.actions.length > 0 && <div className="flex flex-wrap gap-2 border-t pt-3">
            {t.actions.includes("record_deposit") && <Button size="sm" variant="outline" onClick={() => setDeposit(t)}>Record deposit</Button>}
            {t.actions.includes("activate") && <Button size="sm" onClick={() => setActivate(t)}>Record move-in</Button>}
            {t.deposit.status === "RECEIVED" && <DocButton kind="deposit" id={t.id} who="owner" label="Deposit receipt" />}
            {t.actions.includes("settle") && <Button size="sm" onClick={() => setSettle(t)}>{t.settlement?.status === "COMPLETED" ? "View deposit settlement" : "Settle the deposit"}</Button>}
            {t.actions.includes("serve_notice") && <Button size="sm" variant="outline" onClick={() => setNotice(t)}>Serve notice</Button>}
            {t.actions.includes("withdraw_notice") && <Button size="sm" variant="outline" onClick={async () => { try { await unwrapData(api.POST("/owner/tenancies/{id}/notice/withdraw", { params: { path: { id: t.id } } })); sync(); toast.success("Notice withdrawn"); } catch (e) { toast.error(errorMessage(e)); } }}>Withdraw notice</Button>}
            {t.actions.includes("move_out") && <Button size="sm" variant="outline" onClick={() => setMoveOut(t)}>Record move-out</Button>}
            {t.actions.includes("edit") && <Button size="sm" variant="ghost" onClick={() => setEdit(t)}>Edit terms</Button>}
            {t.actions.includes("cancel") && <Button size="sm" variant="ghost" onClick={() => setCancel(t)}>Cancel</Button>}
          </div>}
        </li>)}</ul>}
      <LoadMore query={q} />

      {approve && <ApproveDialog a={approve} open onOpenChange={(o) => !o && setApprove(null)} onDone={() => { sync(); setApprove(null); toast.success("Approved. A bed is reserved for them."); }} />}
      <ConfirmDialog open={!!reject} onOpenChange={(o) => !o && setReject(null)} title="Decline this request?" description="The student is told why." confirmLabel="Decline" destructive reason={{ label: "Reason", required: true, placeholder: "e.g. We only take final-year students" }}
        onConfirm={async (reason) => { await unwrapData(api.POST("/owner/tenancy-applications/{id}/reject", { params: { path: { id: reject!.id } }, body: { reason } })); sync(); toast.success("Declined"); }} />
      <ConfirmDialog open={!!activate} onOpenChange={(o) => !o && setActivate(null)} title="Record move-in?" description={activate ? `${activate.tenant?.name ?? "The tenant"} moves into bed ${activate.unit.label} and the stay starts today.` : undefined} confirmLabel="Record move-in"
        onConfirm={async () => { await unwrapData(api.POST("/owner/tenancies/{id}/activate", { params: { path: { id: activate!.id } } })); sync(); toast.success("Stay started"); }} />
      <ConfirmDialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)} title="Cancel this stay?" description="The bed becomes free. Only stays that have not started can be cancelled." confirmLabel="Cancel stay" destructive reason={{ label: "Reason", required: true }}
        onConfirm={async (reason) => { await unwrapData(api.POST("/owner/tenancies/{id}/cancel", { params: { path: { id: cancel!.id } }, body: { reason } })); sync(); toast.success("Stay cancelled"); }} />
      {notice && <NoticeDialog t={notice} as="OWNER" open onOpenChange={(o) => !o && setNotice(null)} onDone={sync} />}
      {moveOut && <MoveOutDialog t={moveOut} tenant={moveOut.tenant?.name ?? moveOut.tenant?.email ?? "The tenant"} open onOpenChange={(o) => !o && setMoveOut(null)} onDone={sync} />}
      {settle && <OwnerSettlementDialog tenancyId={settle.id} tenant={settle.tenant?.name ?? settle.tenant?.email ?? "The tenant"} open onOpenChange={(o) => !o && setSettle(null)} onChanged={sync} />}
      {deposit && <DepositDialog t={deposit} open onOpenChange={(o) => !o && setDeposit(null)} onDone={() => { sync(); setDeposit(null); toast.success("Deposit recorded"); }} />}
      {edit && <EditTermsDialog t={edit} open onOpenChange={(o) => !o && setEdit(null)} onDone={() => { sync(); setEdit(null); toast.success("Terms updated"); }} />}
      {add && <AddTenantDialog hostels={longTerm} open onOpenChange={setAdd} onDone={() => { sync(); setAdd(false); setTab("stays"); toast.success("Tenant added. They were asked to accept."); }} />}
      {terms && hostelId !== "all" && <TermsDialog hostelId={hostelId} open onOpenChange={setTerms} />}
    </div>
  );
}

function ApproveDialog({ a, open, onOpenChange, onDone }: { a: Application; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [rent, setRent] = React.useState("");
  const [dep, setDep] = React.useState("");
  const [start, setStart] = React.useState("");
  const [unitId, setUnitId] = React.useState("auto");
  const free = useQuery({ queryKey: ["owner", "tenancy", "free-units", a.roomType.id], queryFn: () => unwrapData(api.GET("/owner/room-types/{id}/free-units", { params: { path: { id: a.roomType.id } } })) });
  const f = useSubmit(() => unwrapData(api.POST("/owner/tenancy-applications/{id}/approve", { params: { path: { id: a.id } }, body: { ...(unitId !== "auto" ? { unitId } : {}), ...(rent ? { rentPaise: rupees(rent) } : {}), ...(dep !== "" ? { depositPaise: rupees(dep) } : {}), ...(start ? { startDate: start } : {}) } })), onDone);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Approve request" description={`${a.applicant.name ?? a.applicant.email} · ${a.roomType.name}. A free bed is reserved automatically. Leave fields empty to use the room's rent and your default deposit.`}>
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <FormField label="Bed" htmlFor="ap-unit" error={f.fields.unitId} hint={free.isSuccess && free.data.length === 0 ? "No beds are free. Add or free a bed first." : undefined}>
          <Select value={unitId} onValueChange={setUnitId}><SelectTrigger id="ap-unit"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="auto">Assign automatically</SelectItem>{(free.data ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.label}{u.floor !== null ? ` · floor ${u.floor}` : ""}</SelectItem>)}</SelectContent></Select>
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Rent per month (₹)" htmlFor="ap-rent" error={f.fields.rentPaise} hint="Optional override"><Input inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} {...describe("ap-rent", f.fields.rentPaise, true)} /></FormField>
          <FormField label="Deposit (₹)" htmlFor="ap-dep" error={f.fields.depositPaise} hint="Optional override; 0 for none"><Input inputMode="decimal" value={dep} onChange={(e) => setDep(e.target.value)} {...describe("ap-dep", f.fields.depositPaise, true)} /></FormField>
        </div>
        <FormField label="Start date" htmlFor="ap-start" error={f.fields.startDate} hint={`Asked for ${fmtDate(a.moveInDate, "long")}`}><Input type="date" min={localToday()} value={start} onChange={(e) => setStart(e.target.value)} {...describe("ap-start", f.fields.startDate, true)} /></FormField>
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Approve" />
      </form>
    </ResponsiveDialog>
  );
}

function DepositDialog({ t, open, onOpenChange, onDone }: { t: Tenancy; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [method, setMethod] = React.useState<Method>("UPI");
  const [reference, setReference] = React.useState("");
  const f = useSubmit(() => unwrapData(api.POST("/owner/tenancies/{id}/deposit", { params: { path: { id: t.id } }, body: { method, ...(reference ? { reference } : {}) } })), onDone);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Record deposit" description={`${money(t.depositPaise)} received from ${t.tenant?.name ?? t.inviteEmail}.`}>
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <FormField label="How was it paid?" htmlFor="dp-method"><Select value={method} onValueChange={(v) => setMethod(v as Method)}><SelectTrigger id="dp-method"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UPI">UPI</SelectItem><SelectItem value="CASH">Cash</SelectItem><SelectItem value="BANK">Bank transfer</SelectItem></SelectContent></Select></FormField>
        <FormField label="Reference" htmlFor="dp-ref" hint="Optional: UTR, receipt number…"><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} {...describe("dp-ref", undefined, true)} /></FormField>
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Record" />
      </form>
    </ResponsiveDialog>
  );
}

function EditTermsDialog({ t, open, onOpenChange, onDone }: { t: Tenancy; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [rent, setRent] = React.useState(String(t.rentPaise / 100));
  const [dep, setDep] = React.useState(String(t.depositPaise / 100));
  const [due, setDue] = React.useState(String(t.dueDay));
  const [grace, setGrace] = React.useState(String(t.graceDays));
  const [notice, setNotice] = React.useState(String(t.noticeDays));
  const [start, setStart] = React.useState(t.startDate);
  const locked = t.deposit.status === "RECEIVED";
  const f = useSubmit(() => unwrapData(api.PATCH("/owner/tenancies/{id}", { params: { path: { id: t.id } }, body: { rentPaise: rupees(rent), ...(locked ? {} : { depositPaise: rupees(dep) }), dueDay: Number(due), graceDays: Number(grace), noticeDays: Number(notice), startDate: start, expectedVersion: t.version } })), onDone);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Edit terms" description="Terms can change until move-in. The deposit locks once it is received.">
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        <div className="grid max-h-[60dvh] gap-4 overflow-y-auto p-0.5 sm:grid-cols-2">
          {f.error && <div className="sm:col-span-2"><Alert tone="danger">{f.error}</Alert></div>}
          <FormField label="Rent per month (₹)" htmlFor="et-rent" error={f.fields.rentPaise}><Input inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} {...describe("et-rent", f.fields.rentPaise)} /></FormField>
          <FormField label="Deposit (₹)" htmlFor="et-dep" error={f.fields.depositPaise} hint={locked ? "Already received" : undefined}><Input inputMode="decimal" disabled={locked} value={dep} onChange={(e) => setDep(e.target.value)} {...describe("et-dep", f.fields.depositPaise, locked)} /></FormField>
          <FormField label="Rent due day (1-28)" htmlFor="et-due" error={f.fields.dueDay}><Input inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value)} {...describe("et-due", f.fields.dueDay)} /></FormField>
          <FormField label="Grace days" htmlFor="et-grace" error={f.fields.graceDays}><Input inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} {...describe("et-grace", f.fields.graceDays)} /></FormField>
          <FormField label="Notice days" htmlFor="et-notice" error={f.fields.noticeDays}><Input inputMode="numeric" value={notice} onChange={(e) => setNotice(e.target.value)} {...describe("et-notice", f.fields.noticeDays)} /></FormField>
          <FormField label="Start date" htmlFor="et-start" error={f.fields.startDate}><Input type="date" min={localToday()} value={start} onChange={(e) => setStart(e.target.value)} {...describe("et-start", f.fields.startDate)} /></FormField>
        </div>
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Save" />
      </form>
    </ResponsiveDialog>
  );
}

function AddTenantDialog({ hostels, open, onOpenChange, onDone }: { hostels: { id: string; name: string }[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [hostelId, setHostelId] = React.useState(hostels[0]?.id ?? "");
  const rooms = useQuery({ queryKey: ["owner", "rooms", hostelId], enabled: !!hostelId, queryFn: () => unwrapData(api.GET("/owner/hostels/{id}/room-types", { params: { path: { id: hostelId } } })) });
  const [roomTypeId, setRoom] = React.useState("");
  const [unitId, setUnitId] = React.useState("auto");
  const [email, setEmail] = React.useState("");
  const [start, setStart] = React.useState(localToday());
  const [rent, setRent] = React.useState("");
  const [dep, setDep] = React.useState("");
  const [received, setReceived] = React.useState(false);
  const [method, setMethod] = React.useState<Method>("CASH");
  const room = roomTypeId || rooms.data?.[0]?.id || "";
  const free = useQuery({ queryKey: ["owner", "tenancy", "free-units", room], enabled: !!room, queryFn: () => unwrapData(api.GET("/owner/room-types/{id}/free-units", { params: { path: { id: room } } })) });
  const f = useSubmit(() => unwrapData(api.POST("/owner/tenancies", { body: {
    roomTypeId: room, ...(unitId !== "auto" ? { unitId } : {}), tenantEmail: email.trim(), startDate: start, ...(rent ? { rentPaise: rupees(rent) } : {}), ...(dep !== "" ? { depositPaise: rupees(dep) } : {}), ...(received ? { depositReceived: { method } } : {}),
  } })), onDone);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Add a tenant" description="For someone who already lives with you or applied off-platform. They get an email and accept the stay. Start dates in the past are fine.">
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        <div className="grid max-h-[60dvh] gap-4 overflow-y-auto overscroll-contain p-0.5">
          {f.error && <Alert tone="danger">{f.error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Property" htmlFor="at-h"><Select value={hostelId} onValueChange={(v) => { setHostelId(v); setRoom(""); }}><SelectTrigger id="at-h"><SelectValue /></SelectTrigger><SelectContent>{hostels.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent></Select></FormField>
            <FormField label="Room" htmlFor="at-r" error={f.fields.roomTypeId}><Select value={room} onValueChange={(v) => { setRoom(v); setUnitId("auto"); }}><SelectTrigger id="at-r"><SelectValue placeholder={rooms.isPending ? "Loading…" : "Select"} /></SelectTrigger><SelectContent>{(rooms.data ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name} · {money(r.basePricePaise)}/month</SelectItem>)}</SelectContent></Select></FormField>
          </div>
          <FormField label="Bed" htmlFor="at-u" error={f.fields.unitId} hint={free.isSuccess && free.data.length === 0 ? "No beds are free in this room." : undefined}>
            <Select value={unitId} onValueChange={setUnitId}><SelectTrigger id="at-u"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="auto">Assign automatically</SelectItem>{(free.data ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.label}{u.floor !== null ? ` · floor ${u.floor}` : ""}</SelectItem>)}</SelectContent></Select>
          </FormField>
          <FormField label="Tenant's email" htmlFor="at-e" error={f.fields.tenantEmail} required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" {...describe("at-e", f.fields.tenantEmail)} /></FormField>
          <FormField label="Start date" htmlFor="at-s" error={f.fields.startDate} required><Input type="date" value={start} min={addDays(localToday(), -1095)} onChange={(e) => setStart(e.target.value)} {...describe("at-s", f.fields.startDate)} /></FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Rent per month (₹)" htmlFor="at-rent" error={f.fields.rentPaise} hint="Empty = the room's rent"><Input inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} {...describe("at-rent", f.fields.rentPaise, true)} /></FormField>
            <FormField label="Deposit (₹)" htmlFor="at-dep" error={f.fields.depositPaise} hint="Empty = your default; 0 = none"><Input inputMode="decimal" value={dep} onChange={(e) => setDep(e.target.value)} {...describe("at-dep", f.fields.depositPaise, true)} /></FormField>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} className="size-4" />Deposit already received</label>
          {received && <FormField label="Paid by" htmlFor="at-m"><Select value={method} onValueChange={(v) => setMethod(v as Method)}><SelectTrigger id="at-m"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CASH">Cash</SelectItem><SelectItem value="UPI">UPI</SelectItem><SelectItem value="BANK">Bank transfer</SelectItem></SelectContent></Select></FormField>}
        </div>
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Add tenant" />
      </form>
    </ResponsiveDialog>
  );
}

function TermsDialog({ hostelId, open, onOpenChange }: { hostelId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["owner", "tenancy", "terms", hostelId], queryFn: () => unwrapData(api.GET("/owner/hostels/{id}/tenancy-terms", { params: { path: { id: hostelId } } })) });
  const [v, setV] = React.useState<Record<string, string> | null>(null);
  const cur = v ?? (q.data ? { depositMonths: String(q.data.depositMonths), noticeDays: String(q.data.noticeDays), rentDueDay: String(q.data.rentDueDay), rentGraceDays: String(q.data.rentGraceDays), rentGstPercent: String(q.data.rentGstBps / 100), lateFee: String(q.data.rentLateFeePaise / 100) } : null);
  const save = useMutation({
    mutationFn: () => unwrapData(api.PATCH("/owner/hostels/{id}/tenancy-terms", { params: { path: { id: hostelId } }, body: { depositMonths: Number(cur!.depositMonths), noticeDays: Number(cur!.noticeDays), rentDueDay: Number(cur!.rentDueDay), rentGraceDays: Number(cur!.rentGraceDays), rentGstBps: Math.round(Number(cur!.rentGstPercent) * 100), rentLateFeePaise: Math.round(Number(cur!.lateFee) * 100) } })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["owner", "tenancy", "terms"] }); toast.success("Terms saved for future stays"); onOpenChange(false); },
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...(cur ?? {}), [k]: e.target.value });
  const months = Number(cur?.depositMonths ?? 0);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Default terms" description="Used for new stays at this property. Stays that already exist keep the terms they were created with.">
      {!cur ? <Skeleton className="h-40" /> : (
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-4" noValidate>
          {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
          {months > 2 && <Alert tone="warning">More than 2 months of rent as a deposit is above the usual limit in many states. You can still save it.</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Deposit (months of rent)" htmlFor="tm-dep"><Input inputMode="numeric" value={cur.depositMonths} onChange={set("depositMonths")} {...describe("tm-dep")} /></FormField>
            <FormField label="Notice period (days)" htmlFor="tm-notice"><Input inputMode="numeric" value={cur.noticeDays} onChange={set("noticeDays")} {...describe("tm-notice")} /></FormField>
            <FormField label="Rent due day (1-28)" htmlFor="tm-due"><Input inputMode="numeric" value={cur.rentDueDay} onChange={set("rentDueDay")} {...describe("tm-due")} /></FormField>
            <FormField label="Grace days" htmlFor="tm-grace"><Input inputMode="numeric" value={cur.rentGraceDays} onChange={set("rentGraceDays")} {...describe("tm-grace")} /></FormField>
            <FormField label="GST on rent (%)" htmlFor="tm-gst" hint="0 unless your accountant says rent is taxable"><Input inputMode="decimal" value={cur.rentGstPercent} onChange={set("rentGstPercent")} {...describe("tm-gst", undefined, true)} /></FormField>
            <FormField label="Late fee (₹)" htmlFor="tm-late" hint="Added once when rent goes overdue. 0 for none"><Input inputMode="decimal" value={cur.lateFee} onChange={set("lateFee")} {...describe("tm-late", undefined, true)} /></FormField>
          </div>
          <Actions busy={save.isPending} onCancel={() => onOpenChange(false)} label="Save" />
        </form>
      )}
    </ResponsiveDialog>
  );
}

