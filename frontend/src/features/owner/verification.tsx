"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FileDrop } from "@/components/common/file-drop";
import { FormField, describe } from "@/components/common/form-field";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { titleCase } from "@/lib/format";
import { uploadToCloudinary } from "@/lib/upload";
import { useSessionActions } from "@/lib/session/use-session";

const DOC_TYPES = [["GOVERNMENT_ID", "Government ID (required)"], ["PROPERTY_PROOF", "Property proof"], ["BUSINESS_LICENSE", "Business licence"], ["GST_CERTIFICATE", "GST certificate"], ["OTHER", "Other"]] as const;
const schema = z.object({
  businessName: z.string().trim().min(2, "Enter your business or owner name").max(120),
  gstin: z.string().trim().toUpperCase().regex(/^([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])?$/, "Enter a valid 15-character GSTIN, or leave blank").optional(),
  panLast4: z.string().trim().toUpperCase().regex(/^([A-Z0-9]{4})?$/, "Enter exactly the last 4 characters").optional(),
});

export function Verification() {
  const qc = useQueryClient();
  const { refresh } = useSessionActions();
  const q = useQuery({ queryKey: ["owner", "profile"], queryFn: () => unwrapData(api.GET("/owner/profile")) });
  const p = q.data;
  const locked = p?.kycStatus === "PENDING" || p?.kycStatus === "APPROVED";
  const [docType, setDocType] = React.useState<(typeof DOC_TYPES)[number][0]>("GOVERNMENT_ID");
  const [uploading, setUploading] = React.useState<{ name: string; pct: number } | null>(null);
  const sync = () => { qc.invalidateQueries({ queryKey: ["owner", "profile"] }); refresh(); };

  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), values: { businessName: p?.businessName ?? "", gstin: p?.gstin ?? "", panLast4: p?.panLast4 ?? "" } });
  const save = useMutation({
    mutationFn: (v: z.infer<typeof schema>) => unwrapData(api.PATCH("/owner/profile", { body: { businessName: v.businessName, gstin: v.gstin || null, panLast4: v.panLast4 || null } })),
    onSuccess: () => { toast.success("Details saved"); sync(); },
    onError: (e) => { if (isApiError(e)) for (const [k, m] of Object.entries(e.fieldErrors)) form.setError(k as "gstin", { message: m }); else toast.error(errorMessage(e)); },
  });
  const removeDoc = useMutation({ mutationFn: (id: string) => unwrapData(api.DELETE("/owner/kyc/documents/{id}", { params: { path: { id } } })), onSuccess: sync, onError: (e) => toast.error(errorMessage(e)) });
  const submit = useMutation({ mutationFn: () => unwrapData(api.POST("/owner/kyc/submit")), onSuccess: () => { toast.success("Submitted for review"); sync(); }, onError: (e) => toast.error(errorMessage(e)) });

  async function onFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    try {
      setUploading({ name: file.name, pct: 0 });
      const { publicId } = await uploadToCloudinary(file, "KYC_DOCUMENT", { onProgress: (pct) => setUploading({ name: file.name, pct }) });
      await unwrapData(api.POST("/owner/kyc/documents", { body: { type: docType, publicId } }));
      toast.success("Document added"); sync();
    } catch (e) { toast.error(errorMessage(e)); }
    finally { setUploading(null); }
  }

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!p) return <div className="grid gap-4"><Skeleton className="h-9 w-56" /><Skeleton className="h-64" /></div>;
  const { register, handleSubmit, formState: { errors, isDirty } } = form;
  const hasId = p.documents.some((d) => d.type === "GOVERNMENT_ID");
  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title="Verification" description="We check every host's identity and business before listings go live. Your documents are stored privately and only reviewed by our team." actions={<StatusBadge status={p.kycStatus} />} />
      {p.kycStatus === "APPROVED" && <Alert tone="success" title="You're verified">You can publish properties. To change these details, contact support.</Alert>}
      {p.kycStatus === "PENDING" && <Alert tone="info" title="In review">We&apos;ll email you as soon as we&apos;ve decided. You can&apos;t edit while it&apos;s under review.</Alert>}
      {p.kycStatus === "REJECTED" && <Alert tone="danger" title="Not approved yet">{p.rejectionReason ?? "Please check your documents."} Update them below and submit again.</Alert>}

      <Card><CardHeader><CardTitle>Business details</CardTitle><CardDescription>As they appear on your documents.</CardDescription></CardHeader><CardContent>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-4">
          <FormField label="Business or owner name" htmlFor="businessName" error={errors.businessName?.message} required><Input {...register("businessName")} {...describe("businessName", errors.businessName?.message)} disabled={locked} /></FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="GSTIN" htmlFor="gstin" error={errors.gstin?.message} hint="Optional. Shown on tax invoices."><Input {...register("gstin")} {...describe("gstin", errors.gstin?.message, true)} disabled={locked} autoCapitalize="characters" maxLength={15} className="font-mono uppercase" /></FormField>
            <FormField label="PAN, last 4 characters" htmlFor="pan" error={errors.panLast4?.message} hint="We never store the full number."><Input {...register("panLast4")} {...describe("pan", errors.panLast4?.message, true)} disabled={locked} maxLength={4} className="font-mono uppercase" autoCapitalize="characters" /></FormField>
          </div>
          {!locked && <div><Button type="submit" variant="outline" loading={save.isPending} disabled={!isDirty}>Save details</Button></div>}
        </form>
      </CardContent></Card>

      <Card><CardHeader><CardTitle>Documents</CardTitle><CardDescription>JPG, PNG or PDF, up to 8 MB each. A government ID is required.</CardDescription></CardHeader><CardContent className="grid gap-4">
        {p.documents.length > 0 && (
          <ul className="grid gap-2">{p.documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-xl border p-3"><FileText className="size-5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{titleCase(d.type)}</span><span className="block text-xs text-muted-foreground">{(d.format ?? "").toUpperCase()}{d.bytes ? ` · ${(d.bytes / 1024).toFixed(0)} KB` : ""}</span></span>
              {!locked && <Button variant="ghost" size="icon-sm" aria-label={`Remove ${titleCase(d.type)}`} onClick={() => removeDoc.mutate(d.id)} disabled={removeDoc.isPending}><Trash2 /></Button>}</li>
          ))}</ul>
        )}
        {!locked && (
          <>
            <FormField label="Document type" htmlFor="doctype"><Select value={docType} onValueChange={(v) => setDocType(v as typeof docType)}><SelectTrigger id="doctype"><SelectValue /></SelectTrigger><SelectContent>{DOC_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></FormField>
            <FileDrop accept="image/jpeg,image/png,application/pdf" disabled={!!uploading} onFiles={onFiles} label={uploading ? `Uploading ${uploading.name}… ${uploading.pct}%` : "Upload a document"} hint="JPG, PNG or PDF" />
          </>
        )}
      </CardContent></Card>

      {!locked && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" loading={submit.isPending} disabled={!hasId || !p.businessName || form.formState.isDirty} onClick={() => submit.mutate()}><CheckCircle2 />Submit for review</Button>
          {!hasId ? <span className="text-sm text-muted-foreground">Add a government ID first.</span> : form.formState.isDirty ? <span className="text-sm text-muted-foreground">Save your details first.</span> : null}
        </div>
      )}
    </div>
  );
}
