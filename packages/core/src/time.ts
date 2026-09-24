import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/** Every UIT student lives here; profiles may override it. */
export const DEFAULT_TZ = "Asia/Ho_Chi_Minh";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** "HH:mm" (00:00–24:00) → minutes after midnight. Throws on malformed input so bad config fails loudly. */
export function parseClock(value: string): number {
  const match = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid clock time "${value}", expected HH:mm`);
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes > 24 * 60) throw new Error(`Clock time "${value}" is past 24:00`);
  return minutes;
}

export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → [year, monthIndex, day], validated. */
export function parseDateKey(key: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new Error(`Invalid date "${key}", expected YYYY-MM-DD`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`Invalid calendar date "${key}"`);
  }
  return [year, month - 1, day];
}

/** The instant when the wall clock in `tz` shows `dateKey` at `minutes` after midnight (24:00 = next midnight). */
export function zonedInstant(dateKey: string, minutes: number, tz: string = DEFAULT_TZ): Date {
  const [year, monthIndex, day] = parseDateKey(dateKey);
  const zoned = new TZDate(year, monthIndex, day, 0, 0, tz);
  // Adding minutes on a TZDate keeps wall-clock semantics across DST changes in zones that have them.
  zoned.setMinutes(minutes);
  return new Date(zoned.getTime());
}

/** Calendar date ("YYYY-MM-DD") of an instant as seen in `tz`. */
export function zonedDateKey(instant: Date, tz: string = DEFAULT_TZ): string {
  return format(new TZDate(instant.getTime(), tz), "yyyy-MM-dd");
}

/** ISO weekday (1 = Monday … 7 = Sunday) of an instant in `tz`. */
export function zonedIsoWeekday(instant: Date, tz: string = DEFAULT_TZ): number {
  const day = new TZDate(instant.getTime(), tz).getDay();
  return day === 0 ? 7 : day;
}

/** Minutes after local midnight of an instant in `tz`. */
export function zonedMinutes(instant: Date, tz: string = DEFAULT_TZ): number {
  const zoned = new TZDate(instant.getTime(), tz);
  return zoned.getHours() * 60 + zoned.getMinutes();
}

export function formatZoned(instant: Date, pattern: string, tz: string = DEFAULT_TZ): string {
  return format(new TZDate(instant.getTime(), tz), pattern);
}

/** Adds whole calendar days to a "YYYY-MM-DD" key (timezone-free arithmetic). */
export function addDaysToKey(key: string, days: number): string {
  const [year, monthIndex, day] = parseDateKey(key);
  const date = new Date(Date.UTC(year, monthIndex, day + days));
  return date.toISOString().slice(0, 10);
}

/** ISO weekday of a "YYYY-MM-DD" key. */
export function isoWeekdayOfKey(key: string): number {
  const [year, monthIndex, day] = parseDateKey(key);
  const weekday = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Whole days between two keys (b − a). */
export function daysBetweenKeys(a: string, b: string): number {
  const [ya, ma, da] = parseDateKey(a);
  const [yb, mb, db] = parseDateKey(b);
  return Math.round((Date.UTC(yb, mb, db) - Date.UTC(ya, ma, da)) / DAY_MS);
}

/** Human-friendly duration like "2d 3h", "5h", "45m". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / MINUTE_MS));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes >= 30 && hours < 10 ? `${hours}.5h` : `${hours}h`;
  return `${minutes}m`;
}

/** Hours for display: one decimal (dropped when whole) under 100h, whole hours above. */
export function formatHours(hours: number): string {
  if (hours < 100) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round(hours)}h`;
}
