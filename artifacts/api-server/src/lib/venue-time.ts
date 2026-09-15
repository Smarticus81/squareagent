/**
 * Venue-local time helpers for reporting.
 *
 * The API server runs in UTC, but "today's sales" means the venue's day. These
 * helpers compute day/period boundaries in the venue's IANA timezone (from
 * its Square location) using Intl, with no extra dependencies.
 */

const DEFAULT_TZ = "UTC";

function isValidTimeZone(tz: string | undefined): tz is string {
  if (!tz) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(tz: string | undefined | null): string {
  return isValidTimeZone(tz ?? undefined) ? tz! : DEFAULT_TZ;
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let fmt = partsCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, fmt);
  }
  return fmt;
}

/** Wall-clock parts of an instant in a timezone. */
export function localParts(date: Date, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** The instant at which the given local wall-clock time occurs in `tz`. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, tz = DEFAULT_TZ): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two passes handle DST transitions between the guess and the real offset.
  let offset = tzOffsetMs(new Date(guess), tz);
  let result = guess - offset;
  offset = tzOffsetMs(new Date(result), tz);
  result = guess - offset;
  return new Date(result);
}

/** Local hour (0-23) of an ISO timestamp in `tz`. */
export function hourInZone(iso: string, tz: string): number {
  return localParts(new Date(iso), tz).hour;
}

export interface TimeRange {
  start: string;
  end: string;
}

function ymd(date: Date, tz: string): [number, number, number] {
  const p = localParts(date, tz);
  return [p.year, p.month, p.day];
}

/** Full local day for `YYYY-MM-DD` (or today) in `tz`. */
export function dayRange(dateStr: string | undefined, tz: string, now = new Date()): TimeRange {
  let y: number, m: number, d: number;
  const match = dateStr?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else {
    [y, m, d] = ymd(now, tz);
  }
  const start = zonedTimeToUtc(y, m, d, 0, 0, 0, tz);
  const end = new Date(zonedTimeToUtc(y, m, d + 1, 0, 0, 0, tz).getTime() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export type ReportPeriod =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_7_days"
  | "this_month"
  | "last_30_days";

/** Normalize spoken period names ("this week", "last 7 days") to a ReportPeriod. */
export function normalizePeriod(raw: unknown): ReportPeriod {
  const key = String(raw ?? "today").toLowerCase().trim().replace(/[\s-]+/g, "_");
  switch (key) {
    case "yesterday":
    case "this_week":
    case "last_7_days":
    case "this_month":
    case "last_30_days":
      return key;
    case "week":
      return "this_week";
    case "month":
      return "this_month";
    default:
      return "today";
  }
}

/** Local range for a named period in `tz`. Weeks start on Monday. */
export function periodRange(period: ReportPeriod, tz: string, now = new Date()): TimeRange {
  const [y, m, d] = ymd(now, tz);
  const endOfToday = new Date(zonedTimeToUtc(y, m, d + 1, 0, 0, 0, tz).getTime() - 1).toISOString();
  const startOfDay = (offsetDays: number) => zonedTimeToUtc(y, m, d - offsetDays, 0, 0, 0, tz).toISOString();

  switch (period) {
    case "yesterday": {
      const start = zonedTimeToUtc(y, m, d - 1, 0, 0, 0, tz);
      const end = new Date(zonedTimeToUtc(y, m, d, 0, 0, 0, tz).getTime() - 1);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case "this_week": {
      // Day of week for the local date (0 = Sunday).
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      const sinceMonday = dow === 0 ? 6 : dow - 1;
      return { start: startOfDay(sinceMonday), end: endOfToday };
    }
    case "last_7_days":
      return { start: startOfDay(6), end: endOfToday };
    case "this_month":
      return { start: zonedTimeToUtc(y, m, 1, 0, 0, 0, tz).toISOString(), end: endOfToday };
    case "last_30_days":
      return { start: startOfDay(29), end: endOfToday };
    case "today":
    default:
      return { start: startOfDay(0), end: endOfToday };
  }
}

/** Short local time string ("7:45 PM") for a timestamp. */
export function formatLocalTime(iso: string | undefined, tz: string): string {
  if (!iso) return "?";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return "?";
  }
}

/** Short local date+time ("Mar 4, 7:45 PM") for a timestamp. */
export function formatLocalDateTime(iso: string | undefined, tz: string): string {
  if (!iso) return "?";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return "?";
  }
}

/** Local date ("Mar 4, 2026") for a timestamp. */
export function formatLocalDate(iso: string | undefined, tz: string): string {
  if (!iso) return "?";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
  } catch {
    return "?";
  }
}
