import type { Interval } from "./intervals";
import { addDaysToKey, DEFAULT_TZ, daysBetweenKeys, isoWeekdayOfKey, parseClock, zonedDateKey, zonedInstant } from "./time";

export interface PeriodTime {
  period: number;
  start: string; // "HH:mm"
  end: string; // "HH:mm"
}

/**
 * Default UIT class periods (tiết). Users confirm or edit these once per semester, because
 * the portal import (when available) is the source of truth.
 */
export const UIT_PERIODS: readonly PeriodTime[] = [
  { period: 1, start: "07:30", end: "08:15" },
  { period: 2, start: "08:15", end: "09:00" },
  { period: 3, start: "09:00", end: "09:45" },
  { period: 4, start: "10:00", end: "10:45" },
  { period: 5, start: "10:45", end: "11:30" },
  { period: 6, start: "13:00", end: "13:45" },
  { period: 7, start: "13:45", end: "14:30" },
  { period: 8, start: "14:30", end: "15:15" },
  { period: 9, start: "15:30", end: "16:15" },
  { period: 10, start: "16:15", end: "17:00" },
];

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export interface SessionRule {
  id: string;
  courseId: string;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
  periodStart?: number | null;
  periodEnd?: number | null;
  /** Explicit times win over periods (labs, make-up sessions). */
  startTime?: string | null;
  endTime?: string | null;
  /** First and last date ("YYYY-MM-DD") the rule applies to, inclusive. */
  startsOn: string;
  endsOn: string;
  /** 1 = every week, 2 = every other week, … counted from the first occurrence. */
  weekInterval?: number | null;
  room?: string | null;
  kind?: string | null;
}

export interface ClassOccurrence extends Interval {
  sessionId: string;
  courseId: string;
  date: string;
  room: string | null;
  kind: string;
}

/** Resolves a rule's local start/end minutes from explicit times or the period table. */
export function sessionMinutes(rule: SessionRule, periods: readonly PeriodTime[] = UIT_PERIODS): { start: number; end: number } {
  if (rule.startTime && rule.endTime) {
    const start = parseClock(rule.startTime);
    const end = parseClock(rule.endTime);
    if (end <= start) throw new Error(`Session ${rule.id}: end time must be after start time`);
    return { start, end };
  }
  if (rule.periodStart == null || rule.periodEnd == null) {
    throw new Error(`Session ${rule.id}: needs either start/end times or a period range`);
  }
  const first = periods.find((p) => p.period === rule.periodStart);
  const last = periods.find((p) => p.period === rule.periodEnd);
  if (!first || !last || rule.periodEnd < rule.periodStart) {
    throw new Error(`Session ${rule.id}: periods ${rule.periodStart}–${rule.periodEnd} are not in the period table`);
  }
  return { start: parseClock(first.start), end: parseClock(last.end) };
}

export interface ExpandOptions {
  tz?: string;
  periods?: readonly PeriodTime[];
  /** Dates ("YYYY-MM-DD") with no classes, e.g. public holidays or exam weeks. */
  skipDates?: readonly string[];
}

/** Concrete class meetings of every rule that overlap [from, to). */
export function expandSessions(
  rules: readonly SessionRule[],
  from: Date,
  to: Date,
  options: ExpandOptions = {},
): ClassOccurrence[] {
  const tz = options.tz ?? DEFAULT_TZ;
  const periods = options.periods ?? UIT_PERIODS;
  const skip = new Set(options.skipDates ?? []);
  const rangeStartKey = addDaysToKey(zonedDateKey(from, tz), -1);
  const rangeEndKey = zonedDateKey(to, tz);
  const occurrences: ClassOccurrence[] = [];

  for (const rule of rules) {
    if (rule.weekday < 1 || rule.weekday > 7) throw new Error(`Session ${rule.id}: weekday must be 1–7`);
    const { start, end } = sessionMinutes(rule, periods);
    const interval = Math.max(1, rule.weekInterval ?? 1);

    // First date on or after startsOn that falls on the rule's weekday; this anchors the week cadence.
    const offset = (rule.weekday - isoWeekdayOfKey(rule.startsOn) + 7) % 7;
    const anchor = addDaysToKey(rule.startsOn, offset);

    // Jump straight to the first candidate inside the requested range instead of walking the whole semester.
    let key = anchor;
    if (key < rangeStartKey) {
      const weeksToSkip = Math.floor(daysBetweenKeys(anchor, rangeStartKey) / 7);
      key = addDaysToKey(anchor, (weeksToSkip - (weeksToSkip % interval)) * 7);
    }

    for (; key <= rule.endsOn && key <= rangeEndKey; key = addDaysToKey(key, 7 * interval)) {
      if (key < rule.startsOn || skip.has(key)) continue;
      const occurrence: ClassOccurrence = {
        sessionId: rule.id,
        courseId: rule.courseId,
        date: key,
        start: zonedInstant(key, start, tz),
        end: zonedInstant(key, end, tz),
        room: rule.room ?? null,
        kind: rule.kind ?? "lecture",
      };
      if (occurrence.end.getTime() > from.getTime() && occurrence.start.getTime() < to.getTime()) {
        occurrences.push(occurrence);
      }
    }
  }

  return occurrences.sort((a, b) => a.start.getTime() - b.start.getTime());
}
