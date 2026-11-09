"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ExternalLink, FileText, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { fmtDateTime, timeAgo, titleCase } from "@/lib/format";

const TABS = ["PENDING", "APPROVED", "REJECTED"] as const;

export function KycQueue() {
  const [status, setStatus] = React.useState<(typeof TABS)[number]>("PENDING");
  const q = useInfiniteQuery({
    queryKey: ["admin", "kyc", status, "list"], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/admin/kyc", { params: { query: { status, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="grid gap-6">
      <PageHeader title="Host verification" description="Check each host's ID and business before their listings can go live." />
      <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)}><TabsList>{TABS.map((t) => <TabsTrigger key={t} value={t}>{titleCase(t)}</TabsTrigger>)}</TabsList></Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3"><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-20 rounded-2xl" /></div>
        : items.length === 0 ? <EmptyState icon={ShieldCheck} title="Nothing here" description={status === "PENDING" ? "No hosts are waiting for verification." : "No hosts with this status."} />
        : <ul className="grid gap-3">{items.map((o) => <li key={o.ownerId}><Link href={`/admin/kyc/${o.ownerId}`} className="pressable flex items-center justify-between gap-3 rounded-2xl border bg-card p-4 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0"><span className="block truncate font-semibold">{o.businessName ?? o.fullName ?? o.email}</span><span className="block truncate text-sm text-muted-foreground">{o.fullName} · {o.email} · {o.documentCount} document{o.documentCount === 1 ? "" : "s"}</span></span><span className="flex shrink-0 flex-col items-end gap-1"><StatusBadge status={o.kycStatus} /><span className="text-xs text-muted-foreground">{timeAgo(o.updatedAt)}</span></span></Link></li>)}</ul>}
      <LoadMore query={q} />
    </div>
  );
}

export function KycReview() {
  const { ownerId } = useParams<{ ownerId: string }>();
  const qc = useQueryClient();
  const [dlg, setDlg] = React.useState<"approve" | "reject" | null>(null);
  // Document links are short-lived (10 minutes) and every view is audited: load them once, and refresh on demand.
  const q = useQuery({ queryKey: ["admin", "kyc", ownerId], staleTime: 5 * 60_000, queryFn: () => unwrapData(api.GET("/admin/kyc/{ownerId}", { params: { path: { ownerId } } })) });
  const decide = useMutation({
    mutationFn: ({ approve, reason }: { approve: boolean; reason: string }) => (approve ? unwrapData(api.POST("/admin/kyc/{ownerId}/approve", { params: { path: { ownerId } } })) : unwrapData(api.POST("/admin/kyc/{ownerId}/reject", { params: { path: { ownerId } }, body: { reason } }))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "kyc"] }); toast.success("Decision recorded. The host has been notified."); },
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const k = q.data;
  if (!k) return <div className="grid gap-4"><Skeleton className="h-9 w-72" /><Skeleton className="h-72" /></div>;
  return (
    <div className="grid max-w-3xl gap-6">
      <Link href="/admin/kyc" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Verification queue</Link>
      <PageHeader title={k.businessName ?? k.fullName ?? k.email} description={`${k.fullName ?? ""} · ${k.email}${k.phone ? ` · ${k.phone}` : ""}`} actions={<StatusBadge status={k.kycStatus} />} />
      <Alert tone="info">Documents are private. These links expire in {Math.round((k.documents[0]?.downloadUrlExpiresInSeconds ?? 600) / 60)} minutes, and viewing them is recorded in the audit log.</Alert>
      <Card><CardHeader><CardTitle>Business</CardTitle></CardHeader><CardContent><dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-muted-foreground">Name</dt><dd className="font-medium [overflow-wrap:anywhere]">{k.businessName ?? "—"}</dd></div><div><dt className="text-muted-foreground">GSTIN</dt><dd className="font-mono text-xs font-medium">{k.gstin ?? "—"}</dd></div><div><dt className="text-muted-foreground">PAN (last 4)</dt><dd className="font-mono text-xs font-medium">{k.panLast4 ?? "—"}</dd></div></dl></CardContent></Card>
      <Card><CardHeader><CardTitle>Documents ({k.documents.length})</CardTitle></CardHeader><CardContent className="grid gap-4">
        {k.documents.length === 0 ? <p className="text-sm text-muted-foreground">No documents uploaded.</p> : k.documents.map((d) => (
          <div key={d.id} className="grid gap-3 rounded-xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-medium"><FileText className="size-4 text-muted-foreground" />{titleCase(d.type)}</span><span className="text-xs text-muted-foreground">{(d.format ?? "").toUpperCase()} · {fmtDateTime(d.uploadedAt, true)}</span></div>
            {d.format && d.format !== "pdf" &&   <a href={d.downloadUrl} target="_blank" rel="noopener noreferrer"><img src={d.downloadUrl} alt={`${titleCase(d.type)} document`} className="max-h-80 w-full rounded-lg border bg-muted object-contain" loading="lazy" referrerPolicy="no-referrer" /></a>}
            <Button asChild variant="outline" size="sm" className="w-fit"><a href={d.downloadUrl} target="_blank" rel="noopener noreferrer"><ExternalLink />Open full size</a></Button>
          </div>
        ))}
      </CardContent></Card>
      {k.rejectionReason && k.kycStatus === "REJECTED" && <Alert tone="warning" title="Previous rejection">{k.rejectionReason}</Alert>}
      {k.kycStatus === "PENDING" && <div className="flex flex-wrap gap-2"><Button size="lg" onClick={() => setDlg("approve")}><Check />Approve</Button><Button size="lg" variant="outline" onClick={() => setDlg("reject")}><X />Reject</Button></div>}
      <ConfirmDialog open={dlg === "approve"} onOpenChange={(o) => !o && setDlg(null)} title="Approve this host?" confirmLabel="Approve" description="They can then submit their listings for review." onConfirm={() => decide.mutateAsync({ approve: true, reason: "" })} />
      <ConfirmDialog open={dlg === "reject"} onOpenChange={(o) => !o && setDlg(null)} destructive title="Reject verification?" confirmLabel="Reject" description="The host sees your reason and can correct their documents and submit again." reason={{ label: "Reason", required: true, max: 500, placeholder: "e.g. The ID photo is blurry" }} onConfirm={(r) => decide.mutateAsync({ approve: false, reason: r })} />
    </div>
  );
}
