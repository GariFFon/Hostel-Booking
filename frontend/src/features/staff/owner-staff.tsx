"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HardHat, Plus } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrapData } from "@/lib/api/client";
import { fmtDateTime, plural } from "@/lib/format";
import { isLongTerm } from "@/lib/property";
import type { Data } from "@/lib/api/types";
import { Actions, useSubmit } from "@/features/owner/form-utils";
import { tradeLabel } from "@/features/complaints/common";
import { InviteDialog, PropertyPicker } from "./invite-dialog";

type Team = Data<"/owner/staff">;
type Member = Team["staff"][number];
type Vendor = Data<"/owner/staff/vendors">[number];

export function OwnerStaff() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<"team" | "vendors">("team");
  const [inviting, setInviting] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; name: string; current: string[] } | null>(null);
  const [pause, setPause] = React.useState<Member | null>(null);
  const [cancel, setCancel] = React.useState<string | null>(null);
  const team = useQuery({ queryKey: ["owner", "staff"], queryFn: () => unwrapData(api.GET("/owner/staff")) });
  const vendors = useQuery({ queryKey: ["owner", "staff", "vendors"], enabled: tab === "vendors", queryFn: () => unwrapData(api.GET("/owner/staff/vendors")) });
  const hostels = useQuery({ queryKey: ["owner", "hostels", "options"], staleTime: 60_000, queryFn: () => unwrapData(api.GET("/owner/hostels", { params: { query: { limit: 50 } } })) });
  const options = (hostels.data ?? []).filter((h) => isLongTerm(h.propertyType)).map((h) => ({ id: h.id, name: h.name }));
  const sync = () => qc.invalidateQueries({ queryKey: ["owner", "staff"] });

  return (
    <div className="grid gap-6">
      <PageHeader title="Staff" description="Electricians, plumbers, cooks and others who fix what tenants report. Complaints go to the right trade automatically." actions={<Button onClick={() => setInviting(true)}><Plus />Invite staff</Button>} />
      {hostels.isSuccess && options.length === 0 && <Alert tone="info">Staff work at hostels and PGs. Create one first.</Alert>}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}><TabsList><TabsTrigger value="team">My team</TabsTrigger><TabsTrigger value="vendors">Platform vendors</TabsTrigger></TabsList></Tabs>

      {tab === "team" && (team.isError ? <ErrorState error={team.error} onRetry={() => team.refetch()} />
        : team.isPending ? <div className="grid gap-3"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>
        : <>
          {team.data.invites.length > 0 && <section aria-label="Pending invitations" className="grid gap-2"><h2 className="text-lg font-semibold">Waiting to join</h2>
            <ul className="grid gap-2">{team.data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-3.5">
                <span className="min-w-0"><span className="block font-medium [overflow-wrap:anywhere]">{i.email}</span><span className="block text-sm text-muted-foreground">{tradeLabel(i.trade)} · {i.hostels.map((h) => h.name).join(", ")} · expires {fmtDateTime(i.expiresAt)}</span></span>
                <Button size="sm" variant="ghost" onClick={() => setCancel(i.id)}>Cancel</Button></li>))}</ul></section>}
          {team.data.staff.length === 0 ? <EmptyState icon={HardHat} title="No staff yet" description="Invite someone by email, or engage a platform vendor. Until then, complaints wait in your inbox." action={<Button onClick={() => setInviting(true)}><Plus />Invite staff</Button>} />
            : <ul className="grid gap-3">{team.data.staff.map((s) => (
              <MemberCard key={s.userId} s={s} onProps={() => setEditing({ id: s.userId, name: s.name ?? s.email, current: s.hostels.map((h) => h.id) })} onPause={() => setPause(s)} />))}</ul>}
        </>)}

      {tab === "vendors" && (vendors.isError ? <ErrorState error={vendors.error} onRetry={() => vendors.refetch()} />
        : vendors.isPending ? <Skeleton className="h-24 rounded-2xl" />
        : vendors.data.length === 0 ? <EmptyState icon={HardHat} title="No vendors available" description="Vendors are professionals onboarded by the platform. None are available right now." />
        : <ul className="grid gap-3">{vendors.data.map((v) => <VendorCard key={v.userId} v={v} onEngage={() => setEditing({ id: v.userId, name: v.name ?? "Vendor", current: v.hostels.map((h) => h.id) })} />)}</ul>)}

      {inviting && <InviteDialog hostels={options} open onOpenChange={setInviting} onDone={sync} />}
      {editing && <HostelsDialog who={editing} options={options} open onOpenChange={(o) => !o && setEditing(null)} onDone={() => { sync(); setEditing(null); }} />}
      <ConfirmDialog open={!!pause} onOpenChange={(o) => !o && setPause(null)} title={pause?.status === "ACTIVE" ? `Pause ${pause.name ?? pause.email}?` : `Resume ${pause?.name ?? pause?.email}?`}
        description={pause?.status === "ACTIVE" ? "Their open jobs come back to your inbox and they stop receiving new ones." : "They can receive jobs again once you add them to a property."} confirmLabel={pause?.status === "ACTIVE" ? "Pause" : "Resume"} destructive={pause?.status === "ACTIVE"}
        onConfirm={async () => { await unwrapData(api.POST("/owner/staff/{id}/status", { params: { path: { id: pause!.userId } }, body: { status: pause!.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" } })); sync(); toast.success("Updated"); }} />
      <ConfirmDialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)} title="Cancel this invitation?" description="The link in the email stops working." confirmLabel="Cancel invitation" destructive
        onConfirm={async () => { await unwrapData(api.DELETE("/owner/staff/invites/{id}", { params: { path: { id: cancel! } } })); sync(); toast.success("Invitation cancelled"); }} />
    </div>
  );
}

function MemberCard({ s, onProps, onPause }: { s: Member; onProps: () => void; onPause: () => void }) {
  return (
    <li className="grid gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="flex flex-wrap items-center gap-2"><span className="font-semibold [overflow-wrap:anywhere]">{s.name ?? s.email}</span><Badge tone="outline">{tradeLabel(s.trade)}</Badge>{s.kind === "VENDOR" && <Badge tone="info">Platform vendor</Badge>}<StatusBadge status={s.status} /></p>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{s.email}{s.phone ? ` · ${s.phone}` : ""}</p></div>
        <p className="tnum text-sm text-muted-foreground">{plural(s.openJobs, "open job")}</p>
      </div>
      <p className="text-sm">{s.hostels.length === 0 ? <span className="text-muted-foreground">Not assigned to any property</span> : <>Works at <span className="font-medium">{s.hostels.map((h) => h.name).join(", ")}</span></>}</p>
      <div className="flex flex-wrap gap-2 border-t pt-3"><Button size="sm" variant="outline" onClick={onProps}>Change properties</Button>{s.kind === "OWN" && <Button size="sm" variant="ghost" onClick={onPause}>{s.status === "ACTIVE" ? "Pause" : "Resume"}</Button>}</div>
    </li>
  );
}

function VendorCard({ v, onEngage }: { v: Vendor; onEngage: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4">
      <div className="min-w-0"><p className="flex flex-wrap items-center gap-2"><span className="font-semibold [overflow-wrap:anywhere]">{v.name ?? "Vendor"}</span><Badge tone="outline">{tradeLabel(v.trade)}</Badge></p>
        <p className="text-sm text-muted-foreground">{v.hostels.length === 0 ? "Not engaged at your properties" : `Engaged at ${v.hostels.map((h) => h.name).join(", ")}`}</p></div>
      <Button size="sm" variant={v.hostels.length ? "outline" : "default"} onClick={onEngage}>{v.hostels.length ? "Change properties" : "Engage"}</Button>
    </li>
  );
}

function HostelsDialog({ who, options, open, onOpenChange, onDone }: { who: { id: string; name: string; current: string[] }; options: { id: string; name: string }[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [picked, setPicked] = React.useState<string[]>(who.current);
  const f = useSubmit(() => unwrapData(api.PUT("/owner/staff/{id}/hostels", { params: { path: { id: who.id } }, body: { hostelIds: picked } })), () => { toast.success("Saved"); onDone(); });
  const removed = who.current.filter((id) => !picked.includes(id)).length;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={`Where does ${who.name} work?`} description="They receive jobs only for the properties ticked here.">
      <form onSubmit={f.submit} className="grid gap-4" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <PropertyPicker hostels={options} value={picked} onChange={setPicked} />
        {removed > 0 && <Alert tone="warning">Open jobs at the properties you remove come back to your inbox.</Alert>}
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Save" />
      </form>
    </ResponsiveDialog>
  );
}

