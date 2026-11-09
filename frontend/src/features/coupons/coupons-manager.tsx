"use client";
import * as React from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadMore } from "@/components/common/load-more";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrap, unwrapData } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { bps, fmtDate, money } from "@/lib/format";
import { CouponDialog, type Coupon } from "./coupon-dialog";

/** One screen for hosts (their properties' coupons) and admins (platform coupons, plus moderation of host coupons). */
export function CouponsManager({ role }: { role: "OWNER" | "ADMIN" }) {
  const qc = useQueryClient();
  const base = role === "ADMIN" ? "admin" : "owner";
  const [edit, setEdit] = React.useState<Coupon | "new" | null>(null);
  const [del, setDel] = React.useState<Coupon | null>(null);
  const hostels = useQuery({ queryKey: ["owner", "hostels", "options"], enabled: role === "OWNER", staleTime: 60_000, queryFn: () => unwrapData(api.GET("/owner/hostels", { params: { query: { limit: 50 } } })) });
  const q = useInfiniteQuery({
    queryKey: [base, "coupons"], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(role === "ADMIN" ? api.GET("/admin/coupons", { params: { query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } } }) : api.GET("/owner/coupons", { params: { query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (l) => l.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const sync = () => qc.invalidateQueries({ queryKey: [base, "coupons"] });
  const toggle = useMutation({
    mutationFn: (c: Coupon) => unwrapData(role === "ADMIN" ? api.PATCH("/admin/coupons/{id}", { params: { path: { id: c.id } }, body: { isActive: !c.isActive } }) : api.PATCH("/owner/coupons/{id}", { params: { path: { id: c.id } }, body: { isActive: !c.isActive } })),
    onSuccess: sync, onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => unwrapData(role === "ADMIN" ? api.DELETE("/admin/coupons/{id}", { params: { path: { id } } }) : api.DELETE("/owner/coupons/{id}", { params: { path: { id } } })),
    onSuccess: () => { sync(); toast.success("Coupon deleted"); },
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const canCreate = role === "ADMIN" || (hostels.data?.length ?? 0) > 0;
  return (
    <div className="grid gap-6">
      <PageHeader title="Coupons" description={role === "ADMIN" ? "Platform-wide offers, paid for by the platform. Host coupons can be switched off here." : "Discount codes for your properties. The discount comes out of your payout."} actions={<Button onClick={() => setEdit("new")} disabled={!canCreate}><Plus />New coupon</Button>} />
      {role === "OWNER" && hostels.data && hostels.data.length === 0 && <p className="text-sm text-muted-foreground">Create a property first: coupons apply to one of your properties.</p>}
      {q.isPending ? <div className="grid gap-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
        : items.length === 0 ? <EmptyState icon={Tag} title="No coupons yet" description="Offer a discount to fill quiet dates or reward repeat guests." action={canCreate ? <Button onClick={() => setEdit("new")}><Plus />Create a coupon</Button> : undefined} />
        : <ul className="grid gap-3">{items.map((c) => (
          <li key={c.id} className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[1fr_auto] sm:p-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-muted px-2 py-0.5 font-mono text-sm font-semibold tracking-wide">{c.code}</span><StatusBadge status={c.status} />{c.isPublic && <Badge tone="primary">Public</Badge>}<Badge tone="outline">{c.hostel ? c.hostel.name : "Platform-wide"}</Badge></div>
              <p className="mt-2 text-sm">{c.discountType === "PERCENT" ? `${bps(c.percentBps ?? 0)} off${c.maxDiscountPaise ? ` up to ${money(c.maxDiscountPaise)}` : ""}` : `${money(c.flatPaise)} off`}{c.minBookingPaise > 0 ? ` on bookings of ${money(c.minBookingPaise)}+` : ""}</p>
              <p className="tnum mt-1 text-xs text-muted-foreground">{fmtDate(c.validFrom.slice(0, 10), "long")} – {fmtDate(c.validTo.slice(0, 10), "long")} · used {c.usedCount}{c.usageLimit ? ` of ${c.usageLimit}` : ""} · {money(c.redeemedPaise)} in discounts</p>
              {c.description && <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{c.description}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Button variant="outline" size="sm" onClick={() => toggle.mutate(c)} loading={toggle.isPending && toggle.variables?.id === c.id}>{c.isActive ? "Deactivate" : "Activate"}</Button>
              <Button variant="outline" size="sm" onClick={() => setEdit(c)}><Pencil />{role === "ADMIN" && c.hostel ? "Moderate" : "Edit"}</Button>
              <Button variant="ghost" size="icon-sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${c.code}`} onClick={() => setDel(c)}><Trash2 /></Button>
            </div>
          </li>
        ))}</ul>}
      <LoadMore query={q} />
      {edit && <CouponDialog role={role} coupon={edit === "new" ? null : edit} hostels={hostels.data?.map((h) => ({ id: h.id, name: h.name })) ?? []} open onOpenChange={(o) => !o && setEdit(null)} onSaved={() => { sync(); toast.success("Coupon saved"); }} />}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} destructive title={`Delete ${del?.code ?? "coupon"}?`} confirmLabel="Delete" description="A coupon that has been used can't be deleted, because past bookings point at it. Deactivate it instead."
        onConfirm={async () => { try { await remove.mutateAsync(del!.id); } catch (e) { if (isApiError(e) && e.status === 409) throw new Error("This coupon has been used. Deactivate it instead."); throw e; } }} />
    </div>
  );
}
