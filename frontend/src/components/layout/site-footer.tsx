import Link from "next/link";
import { Logo } from "@/components/common/logo";
import { Year } from "./year";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t bg-card/40 pb-24 md:pb-0">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-3 text-sm text-muted-foreground">Hostel beds, private rooms and PGs across India, with the full price (GST included) shown before you book.</p>
        </div>
        <FooterCol title="Explore" links={[["Search stays", "/search"], ["Popular cities", "/#cities"], ["Saved stays", "/account/wishlist"]]} />
        <FooterCol title="Hosting" links={[["List your property", "/host"], ["Host dashboard", "/owner"]]} />
        <FooterCol title="Account" links={[["My trips", "/account/bookings"], ["Sign in", "/login"], ["Create account", "/register"]]} />
      </div>
      <div className="border-t">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-muted-foreground sm:px-6">© <Year /> Hostel Booking. Payments in this demo are simulated: no real money moves.</p>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
        {links.map(([label, href]) => <li key={href}><Link href={href} className="rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{label}</Link></li>)}
      </ul>
    </div>
  );
}
