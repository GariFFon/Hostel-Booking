"use client";
import * as React from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

/** Click-or-drop file picker with a keyboard-accessible button. Validation of type/size is done by the caller's upload helper. */
export function FileDrop({ accept, multiple, disabled, onFiles, label = "Choose a file", hint, className }: {
  accept: string; multiple?: boolean; disabled?: boolean; onFiles: (files: File[]) => void; label?: string; hint?: string; className?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onFiles(Array.from(e.dataTransfer.files)); }}
      className={cn("flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors", over ? "border-primary bg-accent/60" : "bg-card/50", disabled && "opacity-50", className)}
    >
      <UploadCloud className="size-7 text-muted-foreground" aria-hidden />
      <button type="button" disabled={disabled} onClick={() => ref.current?.click()} className="pressable rounded-lg px-2 py-1 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{label}</button>
      <p className="text-xs text-muted-foreground">or drag and drop{hint ? `. ${hint}` : ""}</p>
      <input ref={ref} type="file" accept={accept} multiple={multiple} className="sr-only" tabIndex={-1} onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) onFiles(f); e.target.value = ""; }} />
    </div>
  );
}
