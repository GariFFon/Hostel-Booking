"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HardHat, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrapData } from "@/lib/api/client";
import { plural } from "@/lib/format";
import type { Data } from "@/lib/api/types";
import { tradeLabel } from "@/features/complaints/common";
import { InviteDialog } from "./invite-dialog";

type Row = Data<"/admin/staff">[number];

/** Every maintenance person on the platform, and the place admins onboard vendors that owners can engage. */
export function AdminStaff() {
  const qc = useQueryClient();
  const [inviting, setInviting] = React.useState(false);
  const [toggle, setToggle] = React.useState<Row | null>(null);
  const q = useQuery({ queryKey: ["admin", "staff"], queryFn: () => unwrapData(api.GET("/admin/staff")) });
  const sync = () => qc.invalidateQueries({ queryKey: ["admin", "staff"] });
  return (
    <div className="grid gap-6">
      <PageHeader title="Staff and vendors" description="Vendors you invite here can be engaged by any owner. Owners manage their own staff." actions={<Button onClick={() => setInviting(true)}><Plus />Invite a vendor</Button>} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>
        : q.data.length === 0 ? <EmptyState icon={HardHat} title="Nobody yet" description="Invite a vendor to get started." action={<Button onClick={() => setInviting(true)}><Plus />Invite a vendor</Button>} />
        : <ul className="grid gap-3">{q.data.map((s) => (
          <li key={s.userId} className="grid gap-2 rounded-2xl border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><p className="flex flex-wrap items-center gap-2"><span className="font-semibold [overflow-wrap:anywhere]">{s.name ?? s.email}</span><Badge tone="outline">{tradeLabel(s.trade)}</Badge><Badge tone={s.kind === "VENDOR" ? "info" : "neutral"}>{s.kind === "VENDOR" ? "Vendor" : `Staff of ${s.ownerName ?? "an owner"}`}</Badge><StatusBadge status={s.status} /></p>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{s.email}</p></div>
              <p className="tnum text-sm text-muted-foreground">{plural(s.openJobs, "open job")}</p></div>
            <p className="text-sm text-muted-foreground">{s.hostels.length === 0 ? "Not assigned to a property" : s.hostels.map((h) => h.name).join(", ")}</p>
            <div className="border-t pt-2"><Button size="sm" variant="ghost" onClick={() => setToggle(s)}>{s.status === "ACTIVE" ? "Deactivate" : "Reactivate"}</Button></div>
          </li>))}</ul>}
      {inviting && <InviteDialog open onOpenChange={setInviting} onDone={sync} />}
      <ConfirmDialog open={!!toggle} onOpenChange={(o) => !o && setToggle(null)} title={toggle?.status === "ACTIVE" ? "Deactivate this person?" : "Reactivate this person?"} description={toggle?.status === "ACTIVE" ? "Their open jobs go back to the owners and they stop receiving new ones." : "They can receive jobs again where they are assigned."} confirmLabel={toggle?.status === "ACTIVE" ? "Deactivate" : "Reactivate"} destructive={toggle?.status === "ACTIVE"}
        onConfirm={async () => { await unwrapData(api.POST("/admin/staff/{id}/status", { params: { path: { id: toggle!.userId } }, body: { status: toggle!.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" } })); sync(); toast.success("Updated"); }} />
    </div>
  );
}
