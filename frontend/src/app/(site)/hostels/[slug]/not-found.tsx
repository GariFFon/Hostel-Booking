import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";

export default function NotFound() {
  return <div className="mx-auto max-w-xl px-4 py-24"><EmptyState icon={SearchX} title="We couldn't find that stay" description="It may have been unlisted, or the link is mistyped." action={<Button asChild><Link href="/search">Browse stays</Link></Button>} /></div>;
}
