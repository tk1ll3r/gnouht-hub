import {
  clipIntervals,
  dayWindows,
  intervalMs,
  mergeIntervals,
  subtractIntervals,
  totalHours,
  type FreeTimeOptions,
  type Interval,
} from "./intervals";
import { addDaysToKey, DEFAULT_TZ, HOUR_MS, MINUTE_MS, zonedDateKey, zonedInstant } from "./time";
import type { RankedTask, UrgencyTask } from "./urgency";

export interface DayLoad {
  date: string;
  /** Busy hours inside the productive window. */
  busyHours: number;
  freeHours: number;
  deadlines: number;
}

/** Busy vs. free productive hours and deadline counts for each of the next `days` local days. */
export function dailyLoad(
  fromDateKey: string,
  days: number,
  busy: readonly Interval[],
  deadlines: readonly Date[],
  options: FreeTimeOptions,
): DayLoad[] {
  const tz = options.tz ?? DEFAULT_TZ;
  const merged = mergeIntervals(busy);
  const result: DayLoad[] = [];
  for (let i = 0; i < days; i++) {
    const key = addDaysToKey(fromDateKey, i);
    const dayStart = zonedInstant(key, 0, tz);
    const dayEnd = zonedInstant(key, 24 * 60, tz);
    const windows = dayWindows(dayStart, dayEnd, options);
    const busyInWindow = windows.flatMap((window) => clipIntervals(merged, window));
    result.push({
      date: key,
      busyHours: totalHours(busyInWindow),
      freeHours: totalHours(subtractIntervals(windows, merged)),
      deadlines: deadlines.filter((due) => zonedDateKey(due, tz) === key).length,
    });
  }
  return result;
}

export interface DeadlineCluster {
  start: Date;
  end: Date;
  ids: string[];
}

/** Groups of at least `minCount` deadlines that fall within `windowHours` of each other. */
export function deadlineClusters(
  items: readonly { id: string; dueAt: Date }[],
  windowHours = 72,
  minCount = 3,
): DeadlineCluster[] {
  const sorted = [...items].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const windowMs = windowHours * HOUR_MS;
  const clusters: DeadlineCluster[] = [];
  let left = 0;
  for (let right = 0; right < sorted.length; right++) {
    while (sorted[right]!.dueAt.getTime() - sorted[left]!.dueAt.getTime() > windowMs) left++;
    if (right - left + 1 < minCount) continue;
    const members = sorted.slice(left, right + 1);
    const last = clusters.at(-1);
    // Extend the previous cluster when the sliding window still overlaps it.
    if (last && members[0]!.dueAt.getTime() <= last.end.getTime()) {
      for (const member of members) if (!last.ids.includes(member.id)) last.ids.push(member.id);
      last.end = members.at(-1)!.dueAt;
    } else {
      clusters.push({ start: members[0]!.dueAt, end: members.at(-1)!.dueAt, ids: members.map((m) => m.id) });
    }
  }
  return clusters;
}

export interface CalendarItem extends Interval {
  id: string;
}

/** Pairs of overlapping timed items (all-day items should be filtered out by the caller). */
export function findConflicts(items: readonly CalendarItem[]): [string, string][] {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
  const conflicts: [string, string][] = [];
  const active: CalendarItem[] = [];
  for (const item of sorted) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.end.getTime() <= item.start.getTime()) active.splice(i, 1);
    }
    for (const other of active) conflicts.push([other.id, item.id]);
    active.push(item);
  }
  return conflicts;
}

export interface StudyBlock extends Interval {
  taskId: string;
}

export interface StudyBlockOptions {
  /** Ignore slots shorter than this. */
  minMinutes?: number;
  /** Split long work into blocks no longer than this. */
  maxBlockMinutes?: number;
  maxBlocks?: number;
}

/**
 * Greedy plan: walk tasks in ranked order and fill the earliest free slots before each deadline.
 * Suggestions only — nothing is written to any calendar.
 */
export function suggestStudyBlocks<T extends UrgencyTask>(
  ranked: readonly RankedTask<T>[],
  freeSlots: readonly Interval[],
  options: StudyBlockOptions = {},
): StudyBlock[] {
  const minMs = (options.minMinutes ?? 90) * MINUTE_MS;
  const maxBlockMs = (options.maxBlockMinutes ?? 180) * MINUTE_MS;
  const maxBlocks = options.maxBlocks ?? 10;
  let available = mergeIntervals(freeSlots).filter((slot) => intervalMs(slot) >= minMs);
  const blocks: StudyBlock[] = [];

  for (const item of ranked) {
    if (item.overdue || item.remainingHours <= 0 || !item.task.dueAt) continue;
    let needMs = item.remainingHours * HOUR_MS;
    const deadline = item.task.dueAt.getTime();
    for (const slot of available) {
      if (blocks.length >= maxBlocks || needMs <= 0) break;
      const start = slot.start.getTime();
      const end = Math.min(slot.end.getTime(), deadline, start + maxBlockMs, start + Math.max(needMs, minMs));
      if (end - start < minMs) continue;
      blocks.push({ taskId: item.task.id, start: new Date(start), end: new Date(end) });
      needMs -= end - start;
    }
    available = subtractIntervals(available, blocks).filter((slot) => intervalMs(slot) >= minMs);
    if (blocks.length >= maxBlocks) break;
  }
  return blocks.sort((a, b) => a.start.getTime() - b.start.getTime());
}
