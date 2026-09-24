import { addDaysToKey, DEFAULT_TZ, HOUR_MS, MINUTE_MS, parseClock, zonedDateKey, zonedInstant } from "./time";

/** Half-open time range [start, end). */
export interface Interval {
  start: Date;
  end: Date;
}

export function intervalMs(interval: Interval): number {
  return Math.max(0, interval.end.getTime() - interval.start.getTime());
}

export function totalHours(intervals: readonly Interval[]): number {
  return intervals.reduce((sum, interval) => sum + intervalMs(interval), 0) / HOUR_MS;
}

/** Sorts and merges overlapping or touching intervals; drops empty ones. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.end.getTime() > interval.start.getTime())
    .map((interval) => ({ start: new Date(interval.start), end: new Date(interval.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged.at(-1);
    if (last && current.start.getTime() <= last.end.getTime()) {
      if (current.end.getTime() > last.end.getTime()) last.end = current.end;
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/** `base` minus every interval in `remove`. Both inputs may be unsorted and overlapping. */
export function subtractIntervals(base: readonly Interval[], remove: readonly Interval[]): Interval[] {
  const holes = mergeIntervals(remove);
  const result: Interval[] = [];
  for (const piece of mergeIntervals(base)) {
    let cursor = piece.start.getTime();
    const end = piece.end.getTime();
    for (const hole of holes) {
      const holeStart = hole.start.getTime();
      const holeEnd = hole.end.getTime();
      if (holeEnd <= cursor) continue;
      if (holeStart >= end) break;
      if (holeStart > cursor) result.push({ start: new Date(cursor), end: new Date(holeStart) });
      cursor = Math.max(cursor, holeEnd);
      if (cursor >= end) break;
    }
    if (cursor < end) result.push({ start: new Date(cursor), end: new Date(end) });
  }
  return result;
}

/** Intersection of a list with a single window. */
export function clipIntervals(intervals: readonly Interval[], window: Interval): Interval[] {
  const lo = window.start.getTime();
  const hi = window.end.getTime();
  const clipped: Interval[] = [];
  for (const interval of intervals) {
    const start = Math.max(lo, interval.start.getTime());
    const end = Math.min(hi, interval.end.getTime());
    if (end > start) clipped.push({ start: new Date(start), end: new Date(end) });
  }
  return clipped;
}

export interface DayWindowOptions {
  /** Local "HH:mm" when the productive day starts, e.g. "07:00". */
  dayStart: string;
  /** Local "HH:mm" when it ends, e.g. "23:00" (may be "24:00"). Must be after dayStart. */
  dayEnd: string;
  tz?: string;
}

/** The productive-hours windows of every local day touching [from, to), clipped to that range. */
export function dayWindows(from: Date, to: Date, options: DayWindowOptions): Interval[] {
  const tz = options.tz ?? DEFAULT_TZ;
  const startMinutes = parseClock(options.dayStart);
  const endMinutes = parseClock(options.dayEnd);
  if (endMinutes <= startMinutes) throw new Error("dayEnd must be after dayStart");
  if (to.getTime() <= from.getTime()) return [];

  const windows: Interval[] = [];
  const lastKey = zonedDateKey(to, tz);
  // Start one day early so a window that began "yesterday" in local time is not missed.
  for (let key = addDaysToKey(zonedDateKey(from, tz), -1); key <= lastKey; key = addDaysToKey(key, 1)) {
    windows.push({ start: zonedInstant(key, startMinutes, tz), end: zonedInstant(key, endMinutes, tz) });
  }
  return clipIntervals(windows, { start: from, end: to });
}

export interface FreeTimeOptions extends DayWindowOptions {
  /** Padding added before and after every busy block (travel, context switch). */
  bufferMinutes?: number;
}

/** Productive-hours windows in [from, to) minus busy blocks. */
export function freeIntervals(
  from: Date,
  to: Date,
  busy: readonly Interval[],
  options: FreeTimeOptions,
): Interval[] {
  const pad = (options.bufferMinutes ?? 0) * MINUTE_MS;
  const padded = busy.map((block) => ({
    start: new Date(block.start.getTime() - pad),
    end: new Date(block.end.getTime() + pad),
  }));
  return subtractIntervals(dayWindows(from, to, options), padded);
}

/** Free intervals at least `minMinutes` long — candidate study blocks or meeting slots. */
export function freeSlots(
  from: Date,
  to: Date,
  busy: readonly Interval[],
  options: FreeTimeOptions & { minMinutes: number },
): Interval[] {
  const min = options.minMinutes * MINUTE_MS;
  return freeIntervals(from, to, busy, options).filter((slot) => intervalMs(slot) >= min);
}

/** Free hours in [from, until) from a precomputed, sorted free list. */
export function freeHoursUntil(free: readonly Interval[], from: Date, until: Date): number {
  if (until.getTime() <= from.getTime()) return 0;
  return totalHours(clipIntervals(free, { start: from, end: until }));
}
