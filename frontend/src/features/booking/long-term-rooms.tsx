import { Users } from "lucide-react";
import { money, plural } from "@/lib/format";
import type { HostelDetail } from "@/lib/api/types";

const WHO = { MIXED: "Anyone", MALE: "Men only", FEMALE: "Women only" } as const;

/** Read-only room list for long-term properties: monthly rent per bed or room, with no nightly picker. */
export function LongTermRooms({ rooms }: { rooms: HostelDetail["roomTypes"] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {rooms.map((r) => (
        <li key={r.id} className="grid content-start gap-1.5 rounded-2xl border p-4">
          <p className="font-medium [overflow-wrap:anywhere]">{r.name}</p>
          {r.description && <p className="line-clamp-2 text-sm text-muted-foreground">{r.description}</p>}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{r.kind === "DORM" ? `Shared · ${plural(r.capacity, "bed")}` : `Private · sleeps ${r.maxOccupancyPerUnit}`}</span>
            <span>{WHO[r.gender]}</span>
          </p>
          <p className="tnum pt-1"><span className="text-lg font-semibold">{money(r.fromPricePaise)}</span><span className="text-sm text-muted-foreground"> / month</span></p>
        </li>
      ))}
    </ul>
  );
}
