"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailCheck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { Segmented as Tabs, SegmentedList as TabsList, SegmentedItem as TabsTrigger } from "@/components/ui/segmented";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useSessionActions, useUser } from "@/lib/session/use-session";
import { ComplaintCard, ComplaintDialog, tradeLabel, useOpenFromUrl } from "@/features/complaints/common";

/** /staff: your jobs once you are staff; otherwise the place an invitation link lands. */
export function StaffJobs() {
  const { hasRole } = useUser();
  return hasRole("STAFF") ? <Jobs /> : <Join />;
}

function Join() {
  const router = useRouter();
  const token = useSearchParams().get("invite");
  const { refresh } = useSessionActions();
  const accept = useMutation({
    mutationFn: (t: string) => unwrapData(api.POST("/staff-invites/accept", { body: { token: t } })),
    onSuccess: async () => { await refresh(); toast.success("Welcome aboard. Your jobs will appear here."); router.replace("/staff"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="mx-auto max-w-xl py-10">
      <EmptyState icon={token ? MailCheck : Wrench} title={token ? "You were invited to join a maintenance team" : "This area is for maintenance staff"}
        description={token ? "Accept with the same email address the invitation was sent to. You will then receive jobs for the properties you were added to." : "Ask a property owner to invite you, then open the link in the invitation email."}
        action={token ? <div className="grid gap-2">{accept.isError && <Alert tone="danger">{errorMessage(accept.error)}</Alert>}<Button loading={accept.isPending} onClick={() => accept.mutate(token)}>Accept invitation</Button></div> : undefined} />
    </div>
  );
}

const TABS = [["open", "To do"], ["done", "Resolved"], ["all", "All"]] as const;

function Jobs() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<(typeof TABS)[number][0]>("open");
  const [openId, setOpenId] = useOpenFromUrl();
  const me = useQuery({ queryKey: ["staff", "me"], queryFn: () => unwrapData(api.GET("/staff/me")) });
  const q = useInfiniteQuery({
    queryKey: ["staff", "jobs", tab], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET("/staff/complaints", { params: { query: { limit: 20, ...(tab === "open" ? { open: "true" as const } : tab === "done" ? { status: "RESOLVED" as const } : {}), ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const sync = () => { qc.invalidateQueries({ queryKey: ["staff"] }); };
  const m = me.data;
  return (
    <div className="grid gap-6">
      <PageHeader title="My jobs" description={m ? `${tradeLabel(m.trade)}${m.employer ? ` for ${m.employer}` : " · platform vendor"} · ${m.hostels.length === 0 ? "no properties yet" : m.hostels.map((h) => h.name).join(", ")}` : undefined} />
      {m?.status === "INACTIVE" && <Alert tone="warning">Your account is paused, so you will not receive new jobs.</Alert>}
      {m && m.hostels.length === 0 && m.status === "ACTIVE" && <Alert tone="info">You have not been added to a property yet. Owners engage vendors from their Staff page.</Alert>}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}><TabsList>{TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}</TabsList></Tabs>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isPending ? <div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        : items.length === 0 ? <EmptyState icon={Wrench} title={tab === "open" ? "No jobs right now" : "Nothing here"} description="New jobs for your properties show up here, and you are notified when one is assigned to you." />
        : <ul className="grid gap-3">{items.map((c) => <ComplaintCard key={c.id} c={c} who="staff" onOpen={() => setOpenId(c.id)} />)}</ul>}
      <LoadMore query={q} />
      {openId && <ComplaintDialog id={openId} open onOpenChange={(o) => !o && setOpenId(null)} onChanged={sync} />}
    </div>
  );
}
