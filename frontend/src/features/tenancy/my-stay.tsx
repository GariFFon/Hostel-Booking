"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { House, Search, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { fmtDate, money } from "@/lib/format";
import type { Item } from "@/lib/api/types";
import { MyRent } from "@/features/rent/my-rent";
import { RentPaySheet } from "@/features/rent/rent-pay-sheet";
import { DocButton } from "@/features/rent/payment-actions";
import { NoticeDialog } from "./move-out-dialogs";
import { TenantSettlement } from "./settlement";

type Tenancy = Item<"/me/tenancies">;
type Application = Item<"/me/tenancy-applications">;

export function MyStay() {
  const qc = useQueryClient();
  const router = useRouter();
  const invite = useSearchParams().get("invite");
  const stays = useQuery({ queryKey: ["me", "tenancy", "stays"], queryFn: () => unwrapData(api.GET("/me/tenancies", { params: { query: { limit: 20 } } })) });
  const apps = useQuery({ queryKey: ["me", "tenancy", "apps"], queryFn: () => unwrapData(api.GET("/me/tenancy-applications", { params: { query: { limit: 20 } } })) });
  const sync = () => qc.invalidateQueries({ queryKey: ["me", "tenancy"] });
  const fail = (e: unknown) => toast.error(errorMessage(e));

  const acceptToken = useMutation({ mutationFn: (token: string) => unwrapData(api.POST("/me/tenancy-invites/accept", { body: { token } })), onSuccess: () => { sync(); toast.success("Invitation accepted"); router.replace("/account/stay"); }, onError: fail });
  const accept = useMutation({ mutationFn: (id: string) => unwrapData(api.POST("/me/tenancies/{id}/accept", { params: { path: { id } } })), onSuccess: () => { sync(); toast.success("Invitation accepted"); }, onError: fail });
  const decline = useMutation({ mutationFn: (id: string) => unwrapData(api.POST("/me/tenancies/{id}/decline", { params: { path: { id } } })), onSuccess: () => { sync(); toast.success("Declined"); }, onError: fail });
  const withdraw = useMutation({ mutationFn: (id: string) => unwrapData(api.POST("/me/tenancy-applications/{id}/withdraw", { params: { path: { id } } })), onSuccess: () => { sync(); toast.success("Request withdrawn"); }, onError: fail });

  const loading = stays.isPending || apps.isPending;
  const error = stays.error ?? apps.error;
  const open = apps.data?.filter((a) => a.status === "REQUESTED") ?? [];
  const past = apps.data?.filter((a) => a.status !== "REQUESTED") ?? [];
  return (
    <div className="grid gap-6">
      <PageHeader title="My stay" description="Where you live, and the requests you have sent." actions={stays.data?.some((t) => t.status === "ACTIVE" || t.status === "NOTICE") ? <Button asChild variant="outline" size="sm"><Link href="/account/complaints"><Wrench />Report a problem</Link></Button> : undefined} />
      {invite && (
        <Alert tone="info" title="You were invited to a stay">
          <span className="flex flex-wrap items-center gap-3">Accept it with the same email address the owner used.<Button size="sm" loading={acceptToken.isPending} onClick={() => acceptToken.mutate(invite)}>Accept invitation</Button></span>
        </Alert>
      )}
      {error ? <ErrorState error={error} onRetry={() => { stays.refetch(); apps.refetch(); }} />
        : loading ? <div className="grid gap-3"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>
        : (stays.data?.length ?? 0) + (apps.data?.length ?? 0) === 0 ? <EmptyState icon={House} title="No stay yet" description="Find a hostel or PG and ask for a bed. Your request and your rent will show up here." action={<Button asChild><Link href="/search?propertyType=PG"><Search />Find a place</Link></Button>} />
        : <>
          {stays.data!.length > 0 && <section aria-label="Stays" className="grid gap-3">{stays.data!.map((t) => <StayCard key={t.id} t={t} busy={accept.isPending || decline.isPending} onAccept={() => accept.mutate(t.id)} onDecline={() => decline.mutate(t.id)} />)}</section>}
          {stays.data!.length > 0 && <MyRent />}
          {open.length > 0 && <section aria-label="Open requests" className="grid gap-3"><h2 className="text-lg font-semibold">Open requests</h2>{open.map((a) => <AppCard key={a.id} a={a} onWithdraw={() => withdraw.mutate(a.id)} busy={withdraw.isPending} />)}</section>}
          {past.length > 0 && <section aria-label="Earlier requests" className="grid gap-3"><h2 className="text-lg font-semibold">Earlier requests</h2>{past.map((a) => <AppCard key={a.id} a={a} />)}</section>}
        </>}
    </div>
  );
}

function StayCard({ t, busy, onAccept, onDecline }: { t: Tenancy; busy: boolean; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="flex flex-wrap items-center gap-2"><Link href={`/hostels/${t.hostel.slug}`} className="font-semibold [overflow-wrap:anywhere] hover:underline">{t.hostel.name}</Link><StatusBadge status={t.status} /></p>
          <p className="text-sm text-muted-foreground">{t.roomType.name} · bed {t.unit.label} · {t.hostel.city}</p></div>
        <div className="text-right"><p className="tnum text-lg font-semibold">{money(t.rentPaise)}<span className="text-sm font-normal text-muted-foreground"> / month</span></p><p className="font-mono text-xs text-muted-foreground">{t.code}</p></div>
      </div>
      <dl className="tnum grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Move-in</dt><dd>{fmtDate(t.startDate, "long")}</dd></div>
        <div><dt className="text-muted-foreground">Rent due</dt><dd>{t.dueDay}{t.dueDay === 1 ? "st" : t.dueDay === 2 ? "nd" : t.dueDay === 3 ? "rd" : "th"} of the month</dd></div>
        <div><dt className="text-muted-foreground">Deposit</dt><dd>{t.deposit.status === "NONE" ? "None" : `${money(t.depositPaise)} · ${t.deposit.status === "RECEIVED" ? "received" : "due"}`}</dd></div>
      </dl>
      <StayExtras t={t} />
      {t.status === "PENDING_MOVE_IN" && <p className="text-sm text-muted-foreground">Your bed is reserved. {t.deposit.status === "DUE" ? "Pay the deposit to the owner before move-in; they will record it." : "The owner will confirm your move-in."}</p>}
      {(t.actions.includes("accept") || t.actions.includes("decline")) && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {t.actions.includes("accept") && <Button size="sm" loading={busy} onClick={onAccept}>Accept</Button>}
          {t.actions.includes("decline") && <Button size="sm" variant="outline" disabled={busy} onClick={onDecline}>Decline</Button>}
        </div>
      )}
    </div>
  );
}

function AppCard({ a, onWithdraw, busy }: { a: Application; onWithdraw?: () => void; busy?: boolean }) {
  return (
    <div className="grid gap-2 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2"><Link href={`/hostels/${a.hostel.slug}`} className="font-medium [overflow-wrap:anywhere] hover:underline">{a.hostel.name}</Link><StatusBadge status={a.status === "APPROVED" ? "APPLICATION_APPROVED" : a.status} /></p>
        {a.actions.includes("withdraw") && onWithdraw && <Button size="sm" variant="outline" loading={busy} onClick={onWithdraw}>Withdraw</Button>}
      </div>
      <p className="tnum text-sm text-muted-foreground">{a.roomType.name} · move in {fmtDate(a.moveInDate)}</p>
      {a.decisionNote && <p className="text-sm">Owner&apos;s note: {a.decisionNote}</p>}
    </div>
  );
}

/** Notice, the online deposit payment, and the deposit settlement: everything about leaving, or paying in, on one card. */
function StayExtras({ t }: { t: Tenancy }) {
  const qc = useQueryClient();
  const [notice, setNotice] = React.useState(false);
  const [pay, setPay] = React.useState(false);
  const sync = () => qc.invalidateQueries({ queryKey: ["me", "tenancy"] });
  const withdraw = useMutation({ mutationFn: () => unwrapData(api.POST("/me/tenancies/{id}/notice/withdraw", { params: { path: { id: t.id } } })), onSuccess: () => { sync(); toast.success("Notice withdrawn. Your stay continues."); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <>
      {t.notice && <Alert tone="warning" title={t.status === "ENDED" ? "You moved out" : `Moving out on ${fmtDate(t.notice.moveOutDate ?? t.endDate ?? t.startDate, "long")}`}>
        <span className="flex flex-wrap items-center gap-3">{t.notice.by === "OWNER" ? "The owner gave notice." : "You gave notice."}{t.notice.reason ? ` ${t.notice.reason}` : ""}
          {t.actions.includes("withdraw_notice") && <Button size="sm" variant="outline" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>Withdraw notice</Button>}</span></Alert>}
      {t.status === "ENDED" && !t.notice && t.movedOutAt && <p className="text-sm text-muted-foreground">You moved out on {fmtDate(t.endDate ?? t.startDate, "long")}.</p>}
      {(t.actions.includes("pay_deposit") || t.actions.includes("give_notice")) && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {t.actions.includes("pay_deposit") && <Button size="sm" onClick={() => setPay(true)}>Pay deposit online</Button>}
          {t.actions.includes("give_notice") && <Button size="sm" variant="outline" onClick={() => setNotice(true)}>Give notice</Button>}
        </div>
      )}
      {t.deposit.status === "RECEIVED" && <div><DocButton kind="deposit" id={t.id} who="me" /></div>}
      {t.settlement && <TenantSettlement tenancyId={t.id} />}
      {notice && <NoticeDialog t={t} as="TENANT" open onOpenChange={setNotice} onDone={sync} />}
      {pay && <RentPaySheet deposit={{ tenancyId: t.id, amountPaise: t.depositPaise, code: t.code }} open onOpenChange={setPay} />}
    </>
  );
}
