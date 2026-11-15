"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { errorMessage, isApiError } from "@/lib/api/errors";

/** Runs a dialog's submit: tracks busy/error, and maps the server's per-field validation messages back onto the form. */
export function useSubmit<T>(run: () => Promise<T>, done: (r: T) => void) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null); setFields({});
    try { done(await run()); }
    catch (err) { setError(errorMessage(err)); if (isApiError(err) && err.fieldErrors) setFields(err.fieldErrors); }
    finally { setBusy(false); }
  };
  return { busy, error, fields, submit };
}

export const Actions = ({ busy, onCancel, label }: { busy: boolean; onCancel: () => void; label: string }) => (
  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button><Button type="submit" loading={busy}>{label}</Button></div>
);
