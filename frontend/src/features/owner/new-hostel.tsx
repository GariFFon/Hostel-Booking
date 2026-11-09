"use client";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { api, unwrapData } from "@/lib/api/client";
import { HostelForm } from "./hostel-form";
import { toPayload } from "./hostel-schema";

export function NewHostel() {
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <div className="grid max-w-3xl gap-8">
      <PageHeader title="New property" description="Start with the basics. You'll add photos and rooms next, and nothing is public until you submit it." />
      <HostelForm submitLabel="Create and continue" onSubmit={async (v) => {
        const h = await unwrapData(api.POST("/owner/hostels", { body: toPayload(v) }));
        qc.invalidateQueries({ queryKey: ["owner", "hostels"] });
        toast.success("Draft created. Now add photos and rooms.");
        router.replace(`/owner/hostels/${h.id}?tab=photos`);
      }} />
    </div>
  );
}
