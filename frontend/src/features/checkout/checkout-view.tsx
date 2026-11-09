"use client";
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField, describe } from "@/components/common/form-field";
import { ErrorState } from "@/components/common/error-state";
import { decodeItems } from "@/features/booking/booking-context";
import { PriceBreakdown } from "@/features/booking/price-breakdown";
import { api, newIdempotencyKey, unwrapData } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { fmtRange, money, nightsBetween, plural } from "@/lib/format";
import { useUser } from "@/lib/session/use-session";
import { cn } from "@/lib/utils";

const guestSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the guest's full name").max(100),
  gender: z.enum(["MALE", "FEMALE", "OTHER", ""]).optional(),
  age: z.string().trim().regex(/^(\d{1,3})?$/, "Enter a valid age").refine((v) => v === "" || Number(v) <= 120, "Enter a valid age").optional(),
  idType: z.enum(["AADHAAR", "PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "OTHER", ""]).optional(),
  idLast4: z.string().trim().regex(/^([A-Za-z0-9]{4})?$/, "Enter exactly the last 4 characters").optional(),
});
const schema = z.object({
  contactPhone: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, "Use international format, e.g. +919876543210"),
  specialRequests: z.string().trim().max(500, "Keep it under 500 characters").optional(),
  guests: z.array(guestSchema).min(1),
});
type Values = z.infer<typeof schema>;

export function CheckoutView() {
  const { slug } = useParams<{ slug: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useUser();

  const checkIn = sp.get("checkIn") ?? "", checkOut = sp.get("checkOut") ?? "";
  const guestCount = Math.min(30, Math.max(1, Math.trunc(Number(sp.get("guests"))) || 1));
  const items = React.useMemo(() => Object.entries(decodeItems(sp.get("items"))).map(([roomTypeId, units]) => ({ roomTypeId, units })), [sp]);
  const coupon = sp.get("coupon") ?? "";
  const paramsOk = /^\d{4}-\d{2}-\d{2}$/.test(checkIn) && /^\d{4}-\d{2}-\d{2}$/.test(checkOut) && checkOut > checkIn && items.length > 0;

  const hostel = useQuery({ queryKey: ["hostel", slug], staleTime: 60_000, queryFn: () => unwrapData(api.GET("/hostels/{idOrSlug}", { params: { path: { idOrSlug: slug } } })) });
  const hostelId = hostel.data?.id;
  const quote = useQuery({
    queryKey: ["checkout-quote", hostelId, checkIn, checkOut, guestCount, JSON.stringify(items), coupon], enabled: !!hostelId && paramsOk, retry: false, staleTime: 10_000,
    queryFn: () => unwrapData(api.POST("/quotes", { body: { hostelId: hostelId!, checkIn, checkOut, guests: guestCount, items, ...(coupon ? { couponCode: coupon } : {}) } })),
  });

  const roomGenders = new Map((hostel.data?.roomTypes ?? []).map((r) => [r.id, r.gender]));
  const genderRequired = !!hostel.data && (hostel.data.genderPolicy !== "MIXED" || items.some((i) => roomGenders.get(i.roomTypeId) !== "MIXED"));

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { contactPhone: "", specialRequests: "", guests: Array.from({ length: guestCount }, () => ({ fullName: "", gender: "", age: "", idType: "", idLast4: "" })) },
  });
  const { register, control, handleSubmit, setError, setValue, getValues, formState: { errors } } = form;
  const { fields } = useFieldArray({ control, name: "guests" });
  // Prefill the primary guest from the account once it is known (never overwrite what they typed).
  React.useEffect(() => {
    if (!user) return;
    if (!getValues("guests.0.fullName") && user.fullName) setValue("guests.0.fullName", user.fullName);
    if (!getValues("contactPhone") && user.phone) setValue("contactPhone", user.phone);
  }, [user, getValues, setValue]);

  const [banner, setBanner] = React.useState<{ tone: "danger" | "warning"; text: string; action?: React.ReactNode } | null>(null);
  const keyRef = React.useRef<{ body: string; key: string } | null>(null);
  const bannerRef = React.useRef<HTMLDivElement>(null);
  // An error above the fold is an error nobody sees: bring it into view whenever a new one appears.
  React.useEffect(() => { if (banner) bannerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [banner]);

  const book = useMutation({
    mutationFn: async (v: Values) => {
      const body = {
        hostelId: hostelId!, checkIn, checkOut, items, ...(quote.data?.coupon?.valid ? { couponCode: quote.data.coupon.code } : {}),
        guests: v.guests.map((g) => ({ fullName: g.fullName, ...(g.gender ? { gender: g.gender as "MALE" | "FEMALE" | "OTHER" } : {}), ...(g.age ? { age: Number(g.age) } : {}), ...(g.idType ? { idType: g.idType as "AADHAAR" } : {}), ...(g.idLast4 ? { idLast4: g.idLast4 } : {}) })),
        contactPhone: v.contactPhone, ...(v.specialRequests ? { specialRequests: v.specialRequests } : {}), expectedTotalPaise: quote.data!.totalPaise,
      };
      // One idempotency key per distinct request: a retry (double tap, flaky network) replays the same booking instead of making a second.
      const json = JSON.stringify(body);
      if (keyRef.current?.body !== json) keyRef.current = { body: json, key: newIdempotencyKey() };
      return unwrapData(api.POST("/bookings", { body, headers: { "Idempotency-Key": keyRef.current.key } }));
    },
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      router.replace(`/account/bookings/${b.id}${b.status === "PENDING_PAYMENT" ? "?pay=1" : "?new=1"}`);
    },
    onError: (e) => {
      setBanner(null);
      if (!isApiError(e)) { setBanner({ tone: "danger", text: errorMessage(e) }); return; }
      if (e.code === "PRICE_CHANGED") {
        const d = e.details as { expectedTotalPaise: number; totalPaise: number } | null;
        qc.invalidateQueries({ queryKey: ["checkout-quote"] });
        setBanner({ tone: "warning", text: d ? `The price changed from ${money(d.expectedTotalPaise, { exact: true })} to ${money(d.totalPaise, { exact: true })}. Review the new total below, then confirm again.` : e.message });
      } else if (e.code === "SOLD_OUT") {
        setBanner({ tone: "danger", text: "Someone just booked the last beds. Pick different dates or rooms.", action: <Button asChild variant="outline" size="sm"><Link href={`/hostels/${slug}`}>Back to the property</Link></Button> });
      } else if (e.code === "VALIDATION_FAILED") {
        const fe = e.fieldErrors;
        let general: string | null = null;
        for (const [path, message] of Object.entries(fe)) {
          if (path === "contactPhone" || path.startsWith("guests.")) setError(path as never, { message });
          else general = general ? `${general} ${message}` : message;
        }
        setBanner({ tone: "danger", text: general ?? "Please fix the highlighted fields." });
      } else setBanner({ tone: "danger", text: e.message });
    },
  });

  if (!paramsOk) return <Wrap><ErrorState error={new Error("This checkout link is incomplete")} /><div className="mt-4 text-center"><Button asChild variant="outline"><Link href={`/hostels/${slug}`}>Choose dates and rooms</Link></Button></div></Wrap>;
  if (hostel.isError) return <Wrap><ErrorState error={hostel.error} onRetry={() => hostel.refetch()} /></Wrap>;

  const h = hostel.data;
  const q = quote.data;
  const nights = nightsBetween(checkIn, checkOut);
  const approval = h?.bookingMode === "APPROVAL";
  const cta = approval ? "Send request" : q?.totalPaise === 0 ? "Confirm booking" : `Continue to payment · ${money(q?.totalPaise, { exact: true })}`;
  const submit = handleSubmit((v) => { setBanner(null); book.mutate(v); });

  return (
    <Wrap>
      <Link href={`/hostels/${slug}?${sp.toString()}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Back to the property</Link>
      <h1 className="text-2xl font-semibold md:text-3xl">{approval ? "Request to book" : "Review and book"}</h1>
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-12">
        <form onSubmit={submit} noValidate className="grid min-w-0 gap-8 pb-28 lg:pb-0">
          {banner && <div ref={bannerRef} className="scroll-mt-24"><Alert tone={banner.tone} className="items-center">{banner.text}{banner.action && <div className="mt-2">{banner.action}</div>}</Alert></div>}
          {quote.isError && <Alert tone="warning" title="We can't price this stay">{errorMessage(quote.error)} <Link className="font-medium underline" href={`/hostels/${slug}?${sp.toString()}`}>Change your selection</Link></Alert>}
          {approval && <Alert tone="info">This host reviews each request. <b>You pay only if they accept</b>, and you&apos;ll have time to complete payment.</Alert>}

          <section className="grid gap-4">
            <h2 className="text-lg font-semibold">Who&apos;s staying</h2>
            {genderRequired && <p className="text-sm text-muted-foreground">This property or room has gender rules, so each guest&apos;s gender is required.</p>}
            {fields.map((f, i) => {
              const ge = errors.guests?.[i];
              return (
                <Card key={f.id}><CardContent className="grid gap-4 p-4 sm:p-5">
                  <p className="text-sm font-medium">{i === 0 ? "Primary guest" : `Guest ${i + 1}`}</p>
                  <FormField label="Full name (as on ID)" htmlFor={`g${i}-name`} error={ge?.fullName?.message} required>
                    <Input {...register(`guests.${i}.fullName`)} {...describe(`g${i}-name`, ge?.fullName?.message)} autoComplete={i === 0 ? "name" : "off"} />
                  </FormField>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Gender" htmlFor={`g${i}-gender`} error={ge?.gender?.message ?? undefined} required={genderRequired}>
                      <Controller control={control} name={`guests.${i}.gender`} render={({ field }) => (
                        <Select value={field.value || undefined} onValueChange={field.onChange}>
                          <SelectTrigger id={`g${i}-gender`} aria-invalid={ge?.gender ? true : undefined}><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent><SelectItem value="FEMALE">Female</SelectItem><SelectItem value="MALE">Male</SelectItem><SelectItem value="OTHER">Other</SelectItem></SelectContent>
                        </Select>
                      )} />
                    </FormField>
                    <FormField label="Age" htmlFor={`g${i}-age`} error={ge?.age?.message}>
                      <Input {...register(`guests.${i}.age`)} {...describe(`g${i}-age`, ge?.age?.message)} inputMode="numeric" maxLength={3} />
                    </FormField>
                  </div>
                  <details className="group">
                    <summary className="flex min-h-9 cursor-pointer list-none items-center text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">Add ID details (optional)</summary>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <FormField label="ID type" htmlFor={`g${i}-idt`}>
                        <Controller control={control} name={`guests.${i}.idType`} render={({ field }) => (
                          <Select value={field.value || undefined} onValueChange={field.onChange}>
                            <SelectTrigger id={`g${i}-idt`}><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>{[["AADHAAR", "Aadhaar"], ["PASSPORT", "Passport"], ["DRIVING_LICENCE", "Driving licence"], ["VOTER_ID", "Voter ID"], ["OTHER", "Other"]].map(([v, l]) => <SelectItem key={v} value={v!}>{l}</SelectItem>)}</SelectContent>
                          </Select>
                        )} />
                      </FormField>
                      <FormField label="Last 4 characters" htmlFor={`g${i}-id4`} error={ge?.idLast4?.message} hint="We never ask for the full number.">
                        <Input {...register(`guests.${i}.idLast4`)} {...describe(`g${i}-id4`, ge?.idLast4?.message, true)} maxLength={4} autoCapitalize="characters" autoComplete="off" />
                      </FormField>
                    </div>
                  </details>
                </CardContent></Card>
              );
            })}
          </section>

          <section className="grid gap-4">
            <h2 className="text-lg font-semibold">Contact</h2>
            <FormField label="Mobile number" htmlFor="contactPhone" error={errors.contactPhone?.message} hint="The property uses this to reach you about your stay." required>
              <Input {...register("contactPhone")} {...describe("contactPhone", errors.contactPhone?.message, true)} type="tel" inputMode="tel" autoComplete="tel" placeholder="+919876543210" />
            </FormField>
            <FormField label="Anything the host should know?" htmlFor="notes" error={errors.specialRequests?.message}>
              <Textarea {...register("specialRequests")} {...describe("notes", errors.specialRequests?.message)} rows={3} maxLength={500} placeholder="Arrival time, dietary needs…" />
            </FormField>
          </section>

          <Button type="submit" size="lg" className="hidden w-full lg:inline-flex" loading={book.isPending} disabled={!q || quote.isError}>{cta}</Button>

          <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur-xl lg:hidden"><div className="mx-auto max-w-2xl px-4 py-3">
            <Button type="submit" size="lg" className="w-full" loading={book.isPending} disabled={!q || quote.isError} onClick={submit}>{cta}</Button>
          </div></div>
        </form>

        <aside className="order-first lg:order-none"><div className="grid gap-4 lg:sticky lg:top-24">
          <Card><CardContent className="grid gap-4 p-5">
            {!h ? <Skeleton className="h-24" /> : (
              <div className="flex gap-3">
                <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-muted">{h.media[0] &&   <img src={h.media[0].thumbUrl} alt="" className="size-full object-cover" />}</div>
                <div className="min-w-0"><p className="line-clamp-2 font-semibold [overflow-wrap:anywhere]">{h.name}</p><p className="truncate text-sm text-muted-foreground">{h.address.city}</p><p className="mt-1 text-sm">{fmtRange(checkIn, checkOut)} · {plural(nights, "night")} · {plural(guestCount, "guest")}</p></div>
              </div>
            )}
            <div className="border-t pt-4">{q ? <PriceBreakdown quote={q} /> : quote.isError ? null : <div className="grid gap-2"><Skeleton className="h-4" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-6" /></div>}</div>
            {q && <p className="text-xs text-muted-foreground">{q.cancellation.summary}</p>}
          </CardContent></Card>
          <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-px size-4 shrink-0" /><span><Lock className="mr-1 inline size-3" />Payment is simulated in this demo: no real money moves. Your seats are held while you pay.</span></p>
          {approval && <p className="flex items-start gap-2 text-xs text-muted-foreground"><TriangleAlert className="mt-px size-4 shrink-0" />Request-to-book: you&apos;re not charged until the host accepts.</p>}
        </div></aside>
      </div>
    </Wrap>
  );
}

const Wrap = ({ children }: { children: React.ReactNode }) => <div className={cn("mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 md:py-10")}>{children}</div>;
