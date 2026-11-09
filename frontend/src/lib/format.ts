/**
 * Formatting helpers. Rules (break-ui): never render a raw number, never hard-code a plural, never convert a
 * date-only stay date through the viewer's timezone (a stay date is a calendar date in the hostel's zone).
 */
const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-IN");
const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const plurals = new Intl.PluralRules("en");

/** Paise (integer) → "₹1,23,456" or "₹1,234.50" when there are paise. Null/NaN → "—". */
export function money(paise: number | null | undefined, opts: { exact?: boolean } = {}): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return "—";
  const rupees = paise / 100;
  return opts.exact || paise % 100 !== 0 ? inr2.format(rupees) : inr0.format(rupees);
}
export const count = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : num.format(n));
export const compactCount = (n: number) => compact.format(n);

/** plural(1, "night") → "1 night"; plural(2, "night") → "2 nights"; plural(3, "guest", "guests"). */
export function plural(n: number, one: string, other = `${one}s`) {
  return `${count(n)} ${plurals.select(n) === "one" ? one : other}`;
}

// ── date-only (stay) dates: "2026-12-01", rendered without any timezone shift ──
const parts = (s: string) => {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};
const dFmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...o });
const short = dFmt({ day: "numeric", month: "short" });
const shortY = dFmt({ day: "numeric", month: "short", year: "numeric" });
const weekday = dFmt({ weekday: "short", day: "numeric", month: "short" });
const monthYear = dFmt({ month: "short", year: "numeric" });

export const fmtDate = (s: string, o: "short" | "long" | "weekday" | "month" = "short") =>
  (o === "long" ? shortY : o === "weekday" ? weekday : o === "month" ? monthYear : short).format(parts(s));
export function fmtRange(a: string, b: string) {
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  return `${sameYear ? short.format(parts(a)) : shortY.format(parts(a))} – ${shortY.format(parts(b))}`;
}
export const nightsBetween = (a: string, b: string) => Math.round((parts(b).getTime() - parts(a).getTime()) / 86_400_000);
export function addDays(s: string, n: number) {
  const d = parts(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Today's date as the *viewer* sees it (used only for sensible defaults in pickers). */
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const toISODate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fromISODate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d); // local midnight: what a calendar widget expects
};

// ── instants (timestamps): shown in the viewer's timezone ──
const dt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const dtY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export const fmtDateTime = (iso: string, withYear = false) => (withYear ? dtY : dt).format(new Date(iso));
export function timeAgo(iso: string, now = Date.now()) {
  const sec = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(sec);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(sec / 3600), "hour");
  if (abs < 86_400 * 30) return rtf.format(Math.round(sec / 86_400), "day");
  return dt.format(new Date(iso));
}
/** "1h 23m" / "4m 05s" until an instant; null when it has passed. */
export function countdown(iso: string, now = Date.now()) {
  const left = Math.floor((new Date(iso).getTime() - now) / 1000);
  if (left <= 0) return null;
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Initials from grapheme clusters: first + last word, emoji-safe ("Jo" → "J", "😀 Smith" → "😀S", "" → "?"). */
const seg = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const firstGlyph = (w: string) => (seg ? ([...seg.segment(w)][0]?.segment ?? "") : Array.from(w)[0] ?? "");
export function initials(name: string | null | undefined) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const a = firstGlyph(words[0]!);
  return (words.length > 1 ? a + firstGlyph(words[words.length - 1]!) : a).toUpperCase();
}

/** "10% off" style percentages from basis points: 1250 → "12.5%". */
export const bps = (n: number) => `${Number((n / 100).toFixed(2))}%`;

export const titleCase = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
