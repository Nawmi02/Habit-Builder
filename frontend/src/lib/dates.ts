/**
 * Date helpers that work on "YYYY-MM-DD" STRINGS (the format the backend uses for
 * scheduled_date) and do all arithmetic in UTC, so daylight-saving changes and the phone's
 * time zone can never shift a calendar day by accident.
 */

const pad = (n: number) => String(n).padStart(2, '0');

export function parseDate(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/** Today's date on the PHONE'S clock, as YYYY-MM-DD. */
export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(s: string, n: number): string {
  const { y, m, d } = parseDate(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Monday = 0 ... Sunday = 6 (same numbering as the backend). */
export function weekdayMon0(s: string): number {
  const { y, m, d } = parseDate(s);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing `s`. */
export function startOfWeek(s: string): string {
  return addDays(s, -weekdayMon0(s));
}

export function daysBetween(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

/** Inclusive list of dates from..to. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const shortDayName = (s: string) => DAY_NAMES[weekdayMon0(s)];
