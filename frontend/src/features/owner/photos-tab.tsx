"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ImageIcon, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { FileDrop } from "@/components/common/file-drop";
import { ErrorState } from "@/components/common/error-state";
import { api, unwrapData } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { uploadToCloudinary } from "@/lib/upload";
import { plural } from "@/lib/format";

export const MIN_PHOTOS = 3;

/** Photo manager: multi-upload straight to Cloudinary, cover choice, ordering, removal. The first photo leads the listing. */
export function PhotosTab({ hostelId }: { hostelId: string }) {
  const qc = useQueryClient();
  const key = ["owner", "media", hostelId];
  const q = useQuery({ queryKey: key, queryFn: () => unwrapData(api.GET("/owner/hostels/{id}/media", { params: { path: { id: hostelId } } })) });
  const [progress, setProgress] = React.useState<Record<string, number>>({});
  const [del, setDel] = React.useState<string | null>(null);
  const sync = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["owner", "hostel", hostelId] }); };
  const photos = (q.data ?? []).filter((m) => !m.roomTypeId);

  async function onFiles(files: File[]) {
    const room = 20 - photos.length;
    if (room <= 0) { toast.error("You can add up to 20 photos."); return; }
    await Promise.all(files.slice(0, room).map(async (file) => {
      const id = `${file.name}-${file.size}-${Math.random()}`;
      setProgress((p) => ({ ...p, [id]: 0 }));
      try {
        const { publicId } = await uploadToCloudinary(file, "HOSTEL_IMAGE", { hostelId, onProgress: (pct) => setProgress((p) => ({ ...p, [id]: pct })) });
        await unwrapData(api.POST("/owner/hostels/{id}/media", { params: { path: { id: hostelId } }, body: { publicId } }));
      } catch (e) { toast.error(`${file.name}: ${errorMessage(e)}`); }
      finally { setProgress((p) => { const n = { ...p }; delete n[id]; return n; }); }
    }));
    sync();
  }
  const cover = useMutation({ mutationFn: (id: string) => unwrapData(api.PATCH("/owner/media/{id}", { params: { path: { id } }, body: { isCover: true } })), onSuccess: () => { sync(); toast.success("Cover photo updated"); }, onError: (e) => toast.error(errorMessage(e)) });
  const reorder = useMutation({ mutationFn: (ids: string[]) => unwrapData(api.PUT("/owner/hostels/{id}/media/order", { params: { path: { id: hostelId } }, body: { ids } })), onSuccess: sync, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => unwrapData(api.DELETE("/owner/media/{id}", { params: { path: { id } } })), onSuccess: () => { sync(); toast.success("Photo removed"); } });
  const move = (i: number, d: -1 | 1) => { const ids = photos.map((p) => p.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j]!, ids[i]!]; reorder.mutate(ids); };

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const uploading = Object.keys(progress).length;
  return (
    <div className="grid gap-5">
      {photos.length < MIN_PHOTOS && <Alert tone="warning" title={`Add at least ${MIN_PHOTOS} photos to submit`}>You have {plural(photos.length, "photo")}. Bright, tidy shots of the rooms, common areas and the building work best.</Alert>}
      <FileDrop accept="image/jpeg,image/png,image/webp" multiple onFiles={onFiles} disabled={uploading > 0} label={uploading ? `Uploading ${plural(uploading, "photo")}…` : "Add photos"} hint="JPG, PNG or WebP, up to 10 MB each" />
      {q.isPending ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Skeleton className="aspect-[4/3]" /><Skeleton className="aspect-[4/3]" /><Skeleton className="aspect-[4/3]" /></div>
        : photos.length === 0 ? <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><ImageIcon className="size-4" />No photos yet.</p>
        : <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((m, i) => (
            <li key={m.id} className="group overflow-hidden rounded-2xl border bg-card">
              <div className="relative aspect-[4/3] bg-muted">{ }<img src={m.cardUrl} alt={m.altText ?? `Photo ${i + 1}`} loading="lazy" className="size-full object-cover" />
                {m.isCover && <Badge tone="primary" className="absolute top-2 left-2 bg-background/90 shadow-sm"><Star className="fill-current" />Cover</Badge>}</div>
              <div className="flex items-center justify-between gap-1 p-1.5">
                <div className="flex">
                  <Button variant="ghost" size="icon-sm" aria-label="Move earlier" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}><ArrowLeft /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Move later" disabled={i === photos.length - 1 || reorder.isPending} onClick={() => move(i, 1)}><ArrowRight /></Button>
                  {!m.isCover && <Button variant="ghost" size="icon-sm" aria-label="Make cover photo" onClick={() => cover.mutate(m.id)}><Star /></Button>}
                </div>
                <Button variant="ghost" size="icon-sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label="Delete photo" onClick={() => setDel(m.id)}><Trash2 /></Button>
              </div>
            </li>
          ))}
        </ul>}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} destructive title="Delete this photo?" confirmLabel="Delete photo" description="It will be removed from your listing." onConfirm={() => remove.mutateAsync(del!)} />
    </div>
  );
}
