import { dayWindows, intervalMs, mergeIntervals, type DayWindowOptions, type Interval } from "./intervals";
import { DEFAULT_TZ, MINUTE_MS, zonedDateKey } from "./time";

// Group free-time finder. Inputs are each member's *free* intervals (their own day window minus their
// busy blocks), so only availability ever leaves a member's data — never what they are busy with.

/** Intervals present in both lists. */
export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const left = mergeIntervals(a);
  const right = mergeIntervals(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i]!.start.getTime(), right[j]!.start.getTime());
    const end = Math.min(left[i]!.end.getTime(), right[j]!.end.getTime());
    if (end > start) out.push({ start: new Date(start), end: new Date(end) });
    if (left[i]!.end.getTime() < right[j]!.end.getTime()) i++;
    else j++;
  }
  return out;
}

export interface CountedSlot extends Interval {
  /** How many members are free for the whole slot. */
  free: number;
}

/**
 * Splits time into segments where the number of free members is constant (a sweep over all
 * boundaries). Segments where nobody is free are omitted.
 */
export function freeCounts(members: readonly (readonly Interval[])[]): CountedSlot[] {
  const events: [number, number][] = [];
  for (const free of members) {
    for (const interval of mergeIntervals(free)) {
      events.push([interval.start.getTime(), 1], [interval.end.getTime(), -1]);
    }
  }
  // Ends before starts at the same instant, so touching intervals do not overlap.
  events.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const segments: CountedSlot[] = [];
  let count = 0;
  for (let k = 0; k < events.length; k++) {
    count += events[k]![1];
    const next = events[k + 1];
    if (next && next[0] > events[k]![0] && count > 0) {
      segments.push({ start: new Date(events[k]![0]), end: new Date(next[0]), free: count });
    }
  }
  return segments;
}

export interface BestSlots {
  /** Minimum number of members free in every returned slot. */
  threshold: number;
  slots: CountedSlot[];
}

/**
 * Meeting candidates: slots of at least `minMinutes` where everyone is free, or — when there are none —
 * where as many members as possible are (never fewer than half, and at least two).
 */
export function bestMeetingSlots(members: readonly (readonly Interval[])[], minMinutes = 60, limit = 8): BestSlots {
  const n = members.length;
  if (n === 0) return { threshold: 0, slots: [] };
  const segments = freeCounts(members);
  const minMs = minMinutes * MINUTE_MS;
  const floor = n === 1 ? 1 : Math.max(2, Math.ceil(n / 2));
  for (let threshold = n; threshold >= floor; threshold--) {
    const slots: CountedSlot[] = [];
    for (const segment of segments) {
      if (segment.free < threshold) continue;
      const last = slots.at(-1);
      if (last && last.end.getTime() === segment.start.getTime()) {
        last.end = segment.end;
        last.free = Math.min(last.free, segment.free);
      } else {
        slots.push({ ...segment });
      }
    }
    const long = slots.filter((slot) => intervalMs(slot) >= minMs);
    if (long.length) return { threshold, slots: long.slice(0, limit) };
  }
  return { threshold: floor, slots: [] };
}

export interface AvailabilityDay {
  date: string;
  cells: CountedSlot[];
}

/**
 * Hour-by-hour grid over the viewer's day windows: for each slot, how many members are free for all of
 * it. Slots that have already started are left out of the first day.
 */
export function availabilityGrid(
  members: readonly (readonly Interval[])[],
  from: Date,
  to: Date,
  options: DayWindowOptions & { slotMinutes?: number },
): AvailabilityDay[] {
  const tz = options.tz ?? DEFAULT_TZ;
  const slotMs = (options.slotMinutes ?? 60) * MINUTE_MS;
  const merged = members.map((free) => mergeIntervals(free));
  const days = new Map<string, CountedSlot[]>();
  // Windows are computed from the start of today so slots stay aligned to the day start.
  const windows = dayWindows(new Date(from.getTime() - 24 * 60 * MINUTE_MS), to, options);
  for (const window of windows) {
    const date = zonedDateKey(window.start, tz);
    for (let t = window.start.getTime(); t + slotMs <= window.end.getTime(); t += slotMs) {
      if (t < from.getTime() || t + slotMs > to.getTime()) continue;
      const free = merged.filter((list) => list.some((i) => i.start.getTime() <= t && i.end.getTime() >= t + slotMs)).length;
      const cells = days.get(date) ?? [];
      cells.push({ start: new Date(t), end: new Date(t + slotMs), free });
      days.set(date, cells);
    }
  }
  return [...days.entries()].map(([date, cells]) => ({ date, cells }));
}
