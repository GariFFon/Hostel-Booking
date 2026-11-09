// Stay dates are date-only values interpreted in the hostel's timezone. In JS they are carried as
// 'YYYY-MM-DD' strings and stored as Postgres `date` (Prisma Date at UTC midnight).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isDateString = (s: string) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && toDateString(parseDate(s)) === s;
export const parseDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const toDateString = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateString(d);
}

export const diffDays = (from: string, to: string) => Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);

/** "Today" as a date string in an IANA timezone (e.g. Asia/Kolkata). */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Weekday 0=Sun..6=Sat for a date string. */
export const weekdayOf = (s: string) => parseDate(s).getUTCDay();

/** Offset (local - UTC, in ms) of a timezone at a given instant. */
function tzOffsetMs(utcMs: number, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!) - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `timezone` reads `date` + `time` (HH:mm). DST-safe. */
export function zonedTimeToUtc(date: string, time: string, timezone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const first = naive - tzOffsetMs(naive, timezone);
  return new Date(naive - tzOffsetMs(first, timezone));
}
