"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/error-state";
import { FormField } from "@/components/common/form-field";
import { PageHeader } from "@/components/common/page-header";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { AmenityIcon } from "@/features/hostel/amenity-icon";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { titleCase } from "@/lib/format";
import type { Item } from "@/lib/api/types";

type Amenity = Item<"/amenities">;
const CATEGORIES = ["COMFORT", "SAFETY", "FOOD", "WORK", "WELLNESS", "TRANSPORT"] as const;

function AmenityDialog({ amenity, onClose, onSaved }: { amenity: Amenity | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = React.useState(amenity?.code ?? "");
  const [label, setLabel] = React.useState(amenity?.label ?? "");
  const [category, setCategory] = React.useState<(typeof CATEGORIES)[number]>((amenity?.category as (typeof CATEGORIES)[number]) ?? "COMFORT");
  const [error, setError] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => (amenity
      ? unwrapData(api.PATCH("/admin/amenities/{id}", { params: { path: { id: amenity.id } }, body: { label, category } }))
      : unwrapData(api.POST("/admin/amenities", { body: { code: code.trim().toUpperCase(), label: label.trim(), category } }))),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const valid = label.trim().length >= 2 && (amenity || /^[A-Za-z][A-Za-z0-9_]{1,39}$/.test(code.trim()));
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={amenity ? "Edit amenity" : "New amenity"} className="sm:max-w-md" dismissible={!save.isPending}>
      <div className="grid gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label="Code" htmlFor="am-code" hint={amenity ? "Codes can't change: listings and search filters use them." : "Upper-case letters, digits and underscores, e.g. ROOFTOP_BAR."}><Input id="am-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={!!amenity} className="font-mono uppercase" maxLength={40} /></FormField>
        <FormField label="Label" htmlFor="am-label" required><Input id="am-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} /></FormField>
        <FormField label="Category" htmlFor="am-cat"><Select value={category} onValueChange={(v) => setCategory(v as typeof category)}><SelectTrigger id="am-cat"><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{titleCase(c)}</SelectItem>)}</SelectContent></Select></FormField>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>{amenity ? "Save" : "Create"}</Button></div>
      </div>
    </ResponsiveDialog>
  );
}

export function AmenitiesAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["amenities"], queryFn: () => unwrapData(api.GET("/amenities")) });
  const [edit, setEdit] = React.useState<Amenity | "new" | null>(null);
  const [del, setDel] = React.useState<Amenity | null>(null);
  const sync = () => { qc.invalidateQueries({ queryKey: ["amenities"] }); toast.success("Saved"); };
  const remove = useMutation({ mutationFn: (id: string) => unwrapData(api.DELETE("/admin/amenities/{id}", { params: { path: { id } } })), onSuccess: () => { qc.invalidateQueries({ queryKey: ["amenities"] }); toast.success("Amenity deleted"); } });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const groups = CATEGORIES.map((c) => [c, (q.data ?? []).filter((a) => a.category === c)] as const).filter(([, list]) => list.length);
  return (
    <div className="grid gap-6">
      <PageHeader title="Amenities" description="The facilities hosts can tick and guests can filter by." actions={<Button onClick={() => setEdit("new")}><Plus />New amenity</Button>} />
      {q.isPending ? <Skeleton className="h-64" /> : groups.map(([cat, list]) => (
        <section key={cat} className="grid gap-2"><h2 className="text-sm font-semibold text-muted-foreground">{titleCase(cat)}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">{list.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-xl border bg-card p-3"><AmenityIcon code={a.code} className="size-5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.label}</span><span className="block font-mono text-[11px] text-muted-foreground">{a.code}</span></span>
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${a.label}`} onClick={() => setEdit(a)}><Pencil /></Button><Button variant="ghost" size="icon-sm" className="text-destructive" aria-label={`Delete ${a.label}`} onClick={() => setDel(a)}><Trash2 /></Button></li>
          ))}</ul></section>
      ))}
      {edit && <AmenityDialog amenity={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={sync} />}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} destructive title={`Delete ${del?.label ?? "amenity"}?`} confirmLabel="Delete" description="It is removed from every listing that uses it." onConfirm={() => remove.mutateAsync(del!.id)} />
    </div>
  );
}
