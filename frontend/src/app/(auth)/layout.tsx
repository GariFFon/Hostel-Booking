import Link from "next/link";
import { Logo } from "@/components/common/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="safe-top safe-bottom flex flex-col px-5 py-6 sm:px-10">
        <Logo />
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</main>
        <p className="text-center text-xs text-muted-foreground">By continuing you agree to our <Link href="/" className="underline">terms</Link> and <Link href="/" className="underline">privacy policy</Link>.</p>
      </div>
      <aside className="relative hidden overflow-hidden bg-accent lg:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,color-mix(in_oklab,var(--primary)_28%,transparent),transparent_60%),radial-gradient(90%_70%_at_0%_100%,color-mix(in_oklab,var(--star)_22%,transparent),transparent_60%)]" />
        <div className="relative flex h-full flex-col justify-end gap-3 p-14 text-accent-foreground">
          <p className="display max-w-md text-5xl font-semibold">Bunk beds to brick-and-mortar PGs. One place.</p>
          <p className="max-w-sm text-base opacity-80">Honest prices with GST included, instant booking, and hosts who answer.</p>
        </div>
      </aside>
    </div>
  );
}
