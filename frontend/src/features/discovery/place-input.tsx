"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, LocateFixed, MapPin, Search } from "lucide-react";
import { api, unwrapData } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { FieldLabel, triggerClass } from "./stay-fields";

export interface Place { city?: string; q?: string; near?: boolean }

function useDebounced<T>(v: T, ms = 200) {
  const [d, setD] = React.useState(v);
  React.useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** "Where": ARIA combobox. Cities fill the destination, a property name jumps straight to it, free text searches names. */
export function PlaceInput({ value, onChange, onNearMe, className, autoFocus }: { value: Place; onChange: (p: Place) => void; onNearMe?: () => void; className?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const label = value.near ? "Near me" : (value.city ?? value.q ?? "");
  const [text, setText] = React.useState(label);
  const [seenLabel, setSeenLabel] = React.useState(label);
  if (label !== seenLabel) { setSeenLabel(label); setText(label); } // the outside value changed (e.g. a city was picked): follow it
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const id = React.useId();
  const debounced = useDebounced(text.trim());

  const { data } = useQuery({
    queryKey: ["suggest", debounced], enabled: open && debounced.length >= 2, staleTime: 5 * 60_000,
    queryFn: async () => unwrapData(api.GET("/search/suggest", { params: { query: { q: debounced } } })),
  });
  type Opt = { key: string; label: string; sub?: string; icon: typeof MapPin; run: () => void };
  const options: Opt[] = [
    ...(onNearMe && debounced.length < 2 ? [{ key: "near", label: "Near me", sub: "Use my current location", icon: LocateFixed, run: () => { setOpen(false); onNearMe(); } }] : []),
    ...(data?.cities ?? []).map((c) => ({ key: `c-${c.city}`, label: c.city, sub: `${c.state} · ${c.count} stays`, icon: MapPin, run: () => { onChange({ city: c.city }); setText(c.city); setOpen(false); } })),
    ...(data?.hostels ?? []).map((h) => ({ key: `h-${h.id}`, label: h.name, sub: h.city, icon: Building2, run: () => { setOpen(false); router.push(`/hostels/${h.slug}`); } })),
  ];

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && open && active >= 0 && options[active]) { e.preventDefault(); options[active]!.run(); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className={cn("relative", className)}>
      <div className={cn(triggerClass, "cursor-text")} onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus()}>
        <FieldLabel icon={Search} label="Where" placeholder="">
          <input
            role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined} aria-label="Destination or property name"
            value={text} autoFocus={autoFocus} autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" placeholder="City or property"
            onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); onChange(e.target.value.trim() ? { q: e.target.value.trim() } : {}); }}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKey}
            className="w-full min-w-0 truncate bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
          />
        </FieldLabel>
      </div>
      {open && options.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute top-full right-0 left-0 z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1.5 shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150">
          {options.map((o, i) => (
            <li key={o.key} id={`${id}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); o.run(); }} onMouseEnter={() => setActive(i)}
              className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2", i === active && "bg-muted")}>
              <o.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{o.label}</span>{o.sub && <span className="block truncate text-xs text-muted-foreground">{o.sub}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
