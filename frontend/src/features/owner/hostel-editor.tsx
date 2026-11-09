"use client";
import * as React from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, ExternalLink, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrapData } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { HostelForm } from "./hostel-form";
import { fromHostel, toPayload } from "./hostel-schema";
import { MIN_PHOTOS, PhotosTab } from "./photos-tab";
import { RoomsTab } from "./rooms-tab";

export function HostelEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const tab = sp.get("tab") ?? "details";
  const qc = useQueryClient();
  const [confirm, setConfirm] = React.useState<"submit" | "withdraw" | "delete" | null>(null);
  const [problems, setProblems] = React.useState<{ path: string; message: string }[] | null>(null);

  const q = useQuery({ queryKey: ["owner", "hostel", id], queryFn: () => unwrapData(api.GET("/owner/hostels/{id}", { params: { path: { id } } })) });
  const kyc = useQuery({ queryKey: ["owner", "profile"], queryFn: () => unwrapData(api.GET("/owner/profile")) });
  const h = q.data;
  const initial = React.useMemo(() => (h ? fromHostel(h) : undefined), [h]);
  const sync = () => { qc.invalidateQueries({ queryKey: ["owner", "hostel", id] }); qc.invalidateQueries({ queryKey: ["owner", "hostels"] }); };

  const save = useMutation({
    mutationFn: (v: Parameters<typeof toPayload>[0]) => unwrapData(api.PATCH("/owner/hostels/{id}", { params: { path: { id } }, body: toPayload(v) })),
    onSuccess: () => { sync(); toast.success("Changes saved"); },
  });
  const submit = useMutation({
    mutationFn: () => unwrapData(api.POST("/owner/hostels/{id}/submit", { params: { path: { id } } })),
    onSuccess: () => { sync(); setProblems(null); toast.success("Submitted. We'll review it shortly."); },
    onError: (e) => { if (isApiError(e) && Array.isArray(e.details)) setProblems(e.details as { path: string; message: string }[]); throw e; },
  });
  const withdraw = useMutation({ mutationFn: () => unwrapData(api.POST("/owner/hostels/{id}/withdraw", { params: { path: { id } } })), onSuccess: () => { sync(); toast.success("Back to draft"); } });
  const remove = useMutation({ mutationFn: () => unwrapData(api.DELETE("/owner/hostels/{id}", { params: { path: { id } } })), onSuccess: () => { qc.invalidateQueries({ queryKey: ["owner", "hostels"] }); toast.success("Property deleted"); router.replace("/owner/hostels"); } });

  const setTab = (t: string) => router.replace(`${path}?tab=${t}`, { scroll: false });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!h) return <div className="grid gap-4"><Skeleton className="h-9 w-72" /><Skeleton className="h-96" /></div>;

  const photos = h.media.filter((m) => !m.roomTypeId).length;
  const activeRooms = h.roomTypes.filter((r) => r.isActive).length;
  const checks = [
    { ok: kyc.data?.kycStatus === "APPROVED", label: "Identity verified", href: "/owner/verification", hint: kyc.data?.kycStatus === "PENDING" ? "In review" : "Submit your documents" },
    { ok: photos >= MIN_PHOTOS, label: `At least ${MIN_PHOTOS} photos`, tab: "photos", hint: `${photos} added` },
    { ok: activeRooms >= 1, label: "A bookable room type", tab: "rooms", hint: activeRooms ? `${activeRooms} bookable` : "None yet" },
  ];
  const ready = checks.every((c) => c.ok);
  const editable = h.status !== "PENDING_REVIEW";

  return (
    <div className="grid gap-6">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{h.name}<StatusBadge status={h.status} /></span>}
        description={`${h.address.city}, ${h.address.state}`}
        actions={<>
          {h.status === "APPROVED" && <Button asChild variant="outline"><Link href={`/hostels/${h.slug}`} target="_blank"><ExternalLink />View live</Link></Button>}
          {(h.status === "DRAFT" || h.status === "REJECTED") && <Button onClick={() => { setProblems(null); setConfirm("submit"); }} disabled={!ready}><Send />Submit for review</Button>}
          {h.status === "PENDING_REVIEW" && <Button variant="outline" onClick={() => setConfirm("withdraw")}><Undo2 />Withdraw</Button>}
        </>}
      />

      {h.status === "REJECTED" && <Alert tone="danger" title="Not approved">{h.rejectionReason ?? "Please review your listing."} Make the changes below and submit again.</Alert>}
      {h.status === "SUSPENDED" && <Alert tone="danger" title="This listing is suspended">{h.rejectionReason ?? "Contact support for details."} Guests can't see or book it.</Alert>}
      {h.status === "PENDING_REVIEW" && <Alert tone="info" title="In review">Our team is checking this listing. You can withdraw it to keep editing.</Alert>}
      {h.status === "APPROVED" && <Alert tone="info">This listing is live. Changes to details, photos and prices apply to guests immediately.</Alert>}

      {(h.status === "DRAFT" || h.status === "REJECTED") && (
        <div className="rounded-2xl border bg-card p-4 sm:p-5">
          <p className="text-sm font-semibold">Before you submit</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">{checks.map((c) => {
            const body = <><span className="mt-0.5">{c.ok ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5 text-muted-foreground/50" />}</span><span><span className="block text-sm font-medium">{c.label}</span><span className="block text-xs text-muted-foreground">{c.hint}</span></span></>;
            const cls = cn("flex items-start gap-2.5 rounded-xl border p-3 text-left", !c.ok && "pressable hover:bg-muted/50");
            return <li key={c.label}>{c.ok ? <div className={cls}>{body}</div> : c.href ? <Link href={c.href} className={cls}>{body}</Link> : <button type="button" onClick={() => setTab(c.tab!)} className={cn(cls, "w-full")}>{body}</button>}</li>;
          })}</ul>
        </div>
      )}
      {problems && <Alert tone="danger" title="Your listing isn't ready yet"><ul className="mt-1 list-disc pl-5">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul></Alert>}

      <Tabs value={["details", "photos", "rooms"].includes(tab) ? tab : "details"} onValueChange={setTab}>
        <TabsList><TabsTrigger value="details">Details</TabsTrigger><TabsTrigger value="photos">Photos{photos ? ` (${photos})` : ""}</TabsTrigger><TabsTrigger value="rooms">Rooms & prices{h.roomTypes.length ? ` (${h.roomTypes.length})` : ""}</TabsTrigger></TabsList>
        <TabsContent value="details" className="mt-6">
          {editable ? <HostelForm initial={initial} submitLabel="Save changes" onSubmit={(v) => save.mutateAsync(v)} /> : <Alert tone="info">Withdraw the listing to edit its details.</Alert>}
          <div className="mt-12 rounded-2xl border border-destructive/30 p-5">
            <p className="font-semibold">Delete this property</p><p className="mt-1 text-sm text-muted-foreground">Removes it for good. Not possible while guests have upcoming stays.</p>
            <Button variant="outline" className="mt-3 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirm("delete")}>Delete property</Button>
          </div>
        </TabsContent>
        <TabsContent value="photos" className="mt-6"><PhotosTab hostelId={id} /></TabsContent>
        <TabsContent value="rooms" className="mt-6"><RoomsTab hostelId={id} /></TabsContent>
      </Tabs>

      <ConfirmDialog open={confirm === "submit"} onOpenChange={(o) => !o && setConfirm(null)} title="Submit for review?" confirmLabel="Submit" description="Our team checks every listing before it goes live, usually within a day or two." onConfirm={() => submit.mutateAsync()} />
      <ConfirmDialog open={confirm === "withdraw"} onOpenChange={(o) => !o && setConfirm(null)} title="Withdraw from review?" confirmLabel="Withdraw" description="It goes back to a draft so you can keep editing." onConfirm={() => withdraw.mutateAsync()} />
      <ConfirmDialog open={confirm === "delete"} onOpenChange={(o) => !o && setConfirm(null)} destructive title={`Delete ${h.name}?`} confirmLabel="Delete property" description="This can't be undone." onConfirm={() => remove.mutateAsync()} />
    </div>
  );
}
