"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { StarInput } from "@/components/common/rating";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";

export interface ReviewDraft { overall: number | null; cleanliness: number | null; location: number | null; staff: number | null; valueForMoney: number | null; title: string; comment: string }
const empty: ReviewDraft = { overall: null, cleanliness: null, location: null, staff: null, valueForMoney: null, title: "", comment: "" };
const CATS = [["cleanliness", "Cleanliness"], ["location", "Location"], ["staff", "Staff"], ["valueForMoney", "Value for money"]] as const;

/** Write a review (booking given) or edit one (reviewId given). Categories are optional; one star rating is enough. */
export function ReviewDialog({ booking, reviewId, initial, open, onOpenChange }: {
  booking?: { id: string; hostelName: string }; reviewId?: string; initial?: Partial<ReviewDraft>; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={reviewId ? "Edit your review" : `How was ${booking?.hostelName ?? "your stay"}?`} description="Honest, specific reviews help other travellers choose well." className="sm:max-w-lg" dismissible={!busy}>
      <Body booking={booking} reviewId={reviewId} initial={initial} onOpenChange={onOpenChange} setBusyOut={setBusy} />
    </ResponsiveDialog>
  );
}

/** Mounted only while the dialog is open, so it starts from the right values every time. */
function Body({ booking, reviewId, initial, onOpenChange, setBusyOut }: { booking?: { id: string; hostelName: string }; reviewId?: string; initial?: Partial<ReviewDraft>; onOpenChange: (o: boolean) => void; setBusyOut: (b: boolean) => void }) {
  const qc = useQueryClient();
  const [d, setD] = React.useState<ReviewDraft>({ ...empty, ...initial });
  const [error, setError] = React.useState<string | null>(null);
  const editing = !!reviewId;
  const save = useMutation({
    mutationFn: () => {
      const title = d.title.trim(), comment = d.comment.trim();
      if (editing) {
        // PATCH: null clears an optional field, omitted leaves it alone.
        return unwrapData(api.PATCH("/reviews/{id}", { params: { path: { id: reviewId } }, body: { overall: d.overall!, cleanliness: d.cleanliness, location: d.location, staff: d.staff, valueForMoney: d.valueForMoney, title: title || null, comment: comment || null } }));
      }
      return unwrapData(api.POST("/bookings/{id}/review", {
        params: { path: { id: booking!.id } },
        body: { overall: d.overall!, ...(d.cleanliness ? { cleanliness: d.cleanliness } : {}), ...(d.location ? { location: d.location } : {}), ...(d.staff ? { staff: d.staff } : {}), ...(d.valueForMoney ? { valueForMoney: d.valueForMoney } : {}), ...(title ? { title } : {}), ...(comment ? { comment } : {}) },
      }));
    },
    onSuccess: () => {
      for (const k of [["reviews"], ["booking"], ["bookings"], ["hostel"]]) qc.invalidateQueries({ queryKey: k });
      toast.success(editing ? "Review updated" : "Thanks for your review");
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  React.useEffect(() => { setBusyOut(save.isPending); }, [save.isPending, setBusyOut]);
  return (
    <>
      <div className="grid max-h-[65dvh] gap-5 overflow-y-auto overscroll-contain p-0.5">
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label="Overall" required><StarInput label="Overall rating" value={d.overall} onChange={(v) => setD((c) => ({ ...c, overall: v }))} /></FormField>
        <details className="group rounded-xl border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-3.5 text-sm font-medium [&::-webkit-details-marker]:hidden">Rate the details <span className="ml-2 text-xs font-normal text-muted-foreground">optional</span></summary>
          <div className="grid gap-1 border-t p-3.5">{CATS.map(([k, label]) => <div key={k} className="flex items-center justify-between gap-3"><span className="text-sm">{label}</span><StarInput label={label} optional size="size-6" value={d[k]} onChange={(v) => setD((c) => ({ ...c, [k]: v }))} /></div>)}</div>
        </details>
        <FormField label="Title" htmlFor="rv-title"><Input id="rv-title" value={d.title} maxLength={100} onChange={(e) => setD((c) => ({ ...c, title: e.target.value }))} placeholder="Sum it up in a few words" /></FormField>
        <FormField label="Your review" htmlFor="rv-body" hint={`${d.comment.length}/2000`}><Textarea id="rv-body" value={d.comment} maxLength={2000} rows={5} onChange={(e) => setD((c) => ({ ...c, comment: e.target.value }))} placeholder="What stood out? Cleanliness, noise, staff, location…" /></FormField>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
        <Button disabled={!d.overall} loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>{editing ? "Save changes" : "Post review"}</Button>
      </div>
    </>
  );
}
