"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/api/errors";
import { ResponsiveDialog } from "./responsive-dialog";

interface Props {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; confirmLabel?: string; destructive?: boolean;
  reason?: { label: string; required?: boolean; placeholder?: string; max?: number };
  onConfirm: (reason: string) => Promise<unknown> | unknown; children?: React.ReactNode;
}

/** The dialog's inputs live here: this only mounts while the dialog is open, so every opening starts clean. */
function Body({ onOpenChange, confirmLabel = "Confirm", destructive, reason, onConfirm, children, setBusyOut }: Pick<Props, "onOpenChange" | "confirmLabel" | "destructive" | "reason" | "onConfirm" | "children"> & { setBusyOut: (b: boolean) => void }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const blocked = !!reason?.required && text.trim().length === 0;
  async function run() {
    setBusy(true); setBusyOut(true); setError(null);
    try { await onConfirm(text.trim()); onOpenChange(false); }
    catch (e) { const m = errorMessage(e); setError(m); toast.error(m); }
    finally { setBusy(false); setBusyOut(false); }
  }
  return (
    <>
      {children}
      {reason && (
        <div className="grid gap-2">
          <Label htmlFor="confirm-reason">{reason.label}{reason.required ? "" : " (optional)"}</Label>
          <Textarea id="confirm-reason" value={text} onChange={(e) => setText(e.target.value)} maxLength={reason.max ?? 500} placeholder={reason.placeholder} rows={3} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button variant={destructive ? "destructive" : "default"} loading={busy} disabled={blocked} onClick={run}>{confirmLabel}</Button>
      </div>
    </>
  );
}

/**
 * Confirmation for consequential actions. Optionally collects a reason (required or not). The action runs inside the dialog,
 * which stays open and shows the error if it fails; it closes only on success. Destructive = red button.
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, reason, onConfirm, children }: Props) {
  const [busy, setBusy] = React.useState(false);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={title} description={description} dismissible={!busy}>
      <Body onOpenChange={onOpenChange} confirmLabel={confirmLabel} destructive={destructive} reason={reason} onConfirm={onConfirm} setBusyOut={setBusy}>{children}</Body>
    </ResponsiveDialog>
  );
}
