"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Photo { id: string; cardUrl: string; fullUrl: string; altText: string | null }

/** Grid placement so any number of photos (1..5) fills the 4x2 area with no holes. */
function cell(i: number, n: number) {
  if (n < 3 || i > 0 && n >= 5) return "";
  if (i === 0) return "col-span-2 row-span-2";
  return n === 3 ? "col-span-2" : i === 1 ? "col-span-2" : ""; // n = 3: two stacked; n = 4: one wide + two small
}

/** Desktop: a bento grid. Phones: a native swipe carousel. Both open the same full-screen viewer. */
export function Gallery({ photos, name }: { photos: Photo[]; name: string }) {
  const [open, setOpen] = React.useState<number | null>(null);
  const [index, setIndex] = React.useState(0);
  const show = (i: number) => { setIndex(i); setOpen(i); };
  if (photos.length === 0) return <div className="flex aspect-[16/7] items-center justify-center rounded-2xl bg-muted text-muted-foreground">No photos yet</div>;
  const alt = (p: Photo, i: number) => p.altText || `${name}, photo ${i + 1}`;
  return (
    <>
      {/* phones */}
      <div className="relative -mx-4 sm:mx-0 md:hidden">
        <div className="flex aspect-[4/3] snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] sm:rounded-2xl [&::-webkit-scrollbar]:hidden">
          {photos.map((p, i) => (
            <button key={p.id} type="button" onClick={() => show(i)} className="size-full shrink-0 snap-center outline-none" aria-label={`Open photo ${i + 1} of ${photos.length}`}>
              { }
              <img src={p.cardUrl} alt={alt(p, i)} loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"} decoding="async" className="size-full object-cover" />
            </button>
          ))}
        </div>
        <span className="tnum pointer-events-none absolute right-3 bottom-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">{photos.length} photos</span>
      </div>
      {/* desktop */}
      <div className={cn("relative hidden aspect-[16/7] gap-2 overflow-hidden rounded-2xl md:grid", photos.length >= 3 ? "grid-cols-4 grid-rows-2" : photos.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
        {photos.slice(0, 5).map((p, i) => (
          <button key={p.id} type="button" onClick={() => show(i)} aria-label={`Open photo ${i + 1}`}
            className={cn("group relative overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", cell(i, Math.min(photos.length, 5)))}>
            { }
            <img src={p.cardUrl} alt={alt(p, i)} loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"} decoding="async" className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
          </button>
        ))}
        {photos.length > 1 && <Button variant="outline" size="sm" className="absolute right-3 bottom-3 bg-background/90 backdrop-blur" onClick={() => show(0)}><Images /> Show all {photos.length} photos</Button>}
      </div>
      <Viewer photos={photos} name={name} start={index} open={open !== null} i={index} setI={setIndex} onClose={() => setOpen(null)} />
    </>
  );
}

function Viewer({ photos, name, start, open, i, setI, onClose }: { photos: Photo[]; name: string; start: number; open: boolean; i: number; setI: (n: number) => void; onClose: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { const el = ref.current; if (el) el.scrollTo({ left: start * el.clientWidth, behavior: "instant" as ScrollBehavior }); }, 30);
    return () => clearTimeout(t);
  }, [open, start]);
  const go = (n: number) => { const el = ref.current; if (el) el.scrollTo({ left: Math.max(0, Math.min(photos.length - 1, n)) * el.clientWidth, behavior: "smooth" }); };
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150" />
        <D.Content className="fixed inset-0 z-50 flex flex-col outline-none" onKeyDown={(e) => { if (e.key === "ArrowRight") go(i + 1); if (e.key === "ArrowLeft") go(i - 1); }}>
          <D.Title className="sr-only">{name} photos</D.Title><D.Description className="sr-only">Swipe or use the arrow keys to browse photos.</D.Description>
          <div className="safe-top flex items-center justify-between px-4 py-3 text-white">
            <span className="tnum text-sm">{i + 1} / {photos.length}</span>
            <D.Close className="pressable flex size-11 items-center justify-center rounded-full outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white" aria-label="Close photos"><X /></D.Close>
          </div>
          <div ref={ref} onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))} className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {photos.map((p, k) => (
              <div key={p.id} className="flex size-full shrink-0 snap-center items-center justify-center p-2 md:p-8">
                { }
                <img src={p.fullUrl} alt={p.altText || `${name}, photo ${k + 1}`} loading={Math.abs(k - i) <= 1 ? "eager" : "lazy"} className="max-h-full max-w-full rounded-lg object-contain" />
              </div>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 hidden w-full items-center justify-between px-4 md:flex">
            <button type="button" onClick={() => go(i - 1)} disabled={i === 0} className="pointer-events-auto flex size-12 items-center justify-center rounded-full bg-white/10 text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30" aria-label="Previous photo"><ChevronLeft /></button>
            <button type="button" onClick={() => go(i + 1)} disabled={i === photos.length - 1} className="pointer-events-auto flex size-12 items-center justify-center rounded-full bg-white/10 text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30" aria-label="Next photo"><ChevronRight /></button>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
