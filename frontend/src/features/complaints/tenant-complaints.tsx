"use client";
import * as React from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { FileDrop } from "@/components/common/file-drop";
import { FormField, describe } from "@/components/common/form-field";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import { titleCase } from "@/lib/format";
import { uploadToCloudinary } from "@/lib/upload";
import { Actions, useSubmit } from "@/features/owner/form-utils";
import { FreeTimeFields, defaultFreeTime, freeTimeRange } from "./availability";
import { CATEGORIES, ComplaintCard, ComplaintDialog, useOpenFromUrl } from "./common";

type Priority = "LOW" | "MEDIUM" | "HIGH";
const TABS = [["open", "Open"], ["all", "All"]] as const;
const OPEN_STATUSES = ["OPEN", "ACKNOWLEDGED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "REOPENED", "RESOLVED"];

export function TenantComplaints() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<(typeof TABS)[number][0]>("open");
  const [openId, setOpenId] = useOpenFromUrl();
  const [filing, setFiling] = React.useState(false);
  const stays = useQuery({ queryKey: ["me", "tenancy", "stays"], queryFn: () => unwrapData(api.GET("/me/tenancies", { params: { query: { limit: 20 } } })) });
  const livesThere = (stays.data ?? []).some((t) => t.status === "ACTIVE" || t.status === "NOTICE");
  const q = useInfiniteQuery({
    queryKey: ["me", "complaints"], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/me/complaints", { params: { query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const all = q.data?.pages.flatMap((p) => p.data) ?? [];
  const items = tab === "open" ? all.filter((c) => OPEN_STATUSES.includes(c.status)) : all;
  const sync = () => qc.invalidateQueries({ queryKey: ["me", "complaints"] });

  return (
    <div className="grid gap-6">
      <PageHeader title="Complaints" description="Report a problem in your room or building and follow it until it is fixed."
        actions={livesThere ? <Button onClick={() => setFiling(true)}><Plus />New complaint</Button> : undefined} />
      {stays.isSuccess && !livesThere && <Alert tone="info">You can report problems once you have moved in to a hostel or PG. <Link href="/account/stay" className="font-medium underline">See your stay</Link></Alert>}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}><TabsList>{TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}</TabsList></Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={Wrench} title={tab === "open" ? "Nothing open" : "No complaints yet"} description="If something breaks, report it here with a photo and we will get it to the right person."
            action={livesThere ? <Button onClick={() => setFiling(true)}><Plus />New complaint</Button> : undefined} />
        : <ul className="grid gap-3">{items.map((c) => <ComplaintCard key={c.id} c={c} who="tenant" onOpen={() => setOpenId(c.id)} />)}</ul>}
      <LoadMore query={q} />
      {openId && <ComplaintDialog id={openId} open onOpenChange={(o) => !o && setOpenId(null)} onChanged={sync} />}
      {filing && <FileDialog open onOpenChange={setFiling} onFiled={(id) => { sync(); setFiling(false); setOpenId(id); toast.success("Complaint sent"); }} />}
    </div>
  );
}

function FileDialog({ open, onOpenChange, onFiled }: { open: boolean; onOpenChange: (o: boolean) => void; onFiled: (id: string) => void }) {
  const [category, setCategory] = React.useState<(typeof CATEGORIES)[number]>("PLUMBING");
  const [priority, setPriority] = React.useState<Priority>("MEDIUM");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [free, setFree] = React.useState(defaultFreeTime());
  const f = useSubmit(async () => {
    const range = freeTimeRange(free);
    if (typeof range === "string") throw new ApiError(422, "VALIDATION_FAILED", range);
    const c = await unwrapData(api.POST("/me/complaints", { body: { category, priority, title, description, ...range, ...(location.trim() ? { location: location.trim() } : {}) } }));
    // The complaint exists now; photos are best effort so a bad upload never loses the report.
    for (const file of files) {
      try { const { publicId } = await uploadToCloudinary(file, "COMPLAINT_IMAGE", { complaintId: c.id }); await unwrapData(api.POST("/complaints/{id}/media", { params: { path: { id: c.id } }, body: { publicId } })); }
      catch (e) { toast.error(`${file.name}: ${errorMessage(e)}`); }
    }
    return c;
  }, (c) => onFiled(c.id));
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="New complaint" description="Describe the problem. A photo helps a lot." className="sm:max-w-lg" dismissible={!f.busy}>
      <form onSubmit={f.submit} className="grid max-h-[68dvh] gap-4 overflow-y-auto overscroll-contain p-0.5" noValidate>
        {f.error && <Alert tone="danger">{f.error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="What kind of problem?" htmlFor="cf-cat"><Select value={category} onValueChange={(v) => setCategory(v as typeof category)}><SelectTrigger id="cf-cat"><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>)}</SelectContent></Select></FormField>
          <FormField label="How urgent?" htmlFor="cf-pri"><Select value={priority} onValueChange={(v) => setPriority(v as Priority)}><SelectTrigger id="cf-pri"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="LOW">Can wait</SelectItem><SelectItem value="MEDIUM">Normal</SelectItem><SelectItem value="HIGH">Needs quick action</SelectItem></SelectContent></Select></FormField>
        </div>
        <FormField label="Short title" htmlFor="cf-title" error={f.fields.title} required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Tap is leaking" {...describe("cf-title", f.fields.title)} /></FormField>
        <FormField label="What is wrong?" htmlFor="cf-desc" error={f.fields.description} required><Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={4} {...describe("cf-desc", f.fields.description)} /></FormField>
        <FormField label="Where?" htmlFor="cf-loc" hint="Optional. Defaults to your bed." error={f.fields.location}><Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={100} placeholder="Bathroom, corridor…" {...describe("cf-loc", f.fields.location, true)} /></FormField>
        <FreeTimeFields value={free} onChange={setFree} idPrefix="cf" error={f.fields.availableFrom ?? f.fields.availableTo} />
        <div className="grid gap-2">
          <FileDrop accept="image/jpeg,image/png,image/webp" multiple disabled={f.busy || files.length >= 6} onFiles={(n) => setFiles((p) => [...p, ...n].slice(0, 6))} label="Add photos" hint="Up to 6, JPG, PNG or WebP" className="py-4" />
          {files.length > 0 && <ul className="grid gap-1 text-sm">{files.map((file, i) => <li key={`${file.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-1.5"><span className="min-w-0 truncate">{file.name}</span><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}><X /></Button></li>)}</ul>}
        </div>
        <Actions busy={f.busy} onCancel={() => onOpenChange(false)} label="Send complaint" />
      </form>
    </ResponsiveDialog>
  );
}
