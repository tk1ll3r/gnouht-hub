import { freeHoursUntil, freeIntervals, type FreeTimeOptions, type Interval } from "./intervals";
import { DEFAULT_ESTIMATE_HOURS, isOpenStatus, type TaskKind, type TaskStatus } from "./tasks";
import { DAY_MS, formatDuration, formatHours, formatZoned, HOUR_MS } from "./time";

export interface UrgencyTask {
  id: string;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  dueAt: Date | null;
  estimateHours: number | null;
  /** 0–1 share of the work already done. */
  progress: number;
  /** Course/project importance multiplier (default 1). */
  weight?: number | null;
}

export type UrgencyTier = "urgent" | "soon" | "ok";
export const TIER_ORDER: Record<UrgencyTier, number> = { urgent: 0, soon: 1, ok: 2 };
export const TIER_LABELS: Record<UrgencyTier, string> = { urgent: "Urgent", soon: "Coming up", ok: "On track" };

export interface RankedTask<T extends UrgencyTask = UrgencyTask> {
  task: T;
  tier: UrgencyTier;
  overdue: boolean;
  /** Estimated hours of work still needed. */
  remainingHours: number;
  /** Free productive hours between now and the deadline. */
  freeHours: number;
  /** Wall-clock hours until the deadline (negative when overdue). */
  hoursLeft: number;
  slackHours: number;
  /** Work due by this deadline including every earlier open deadline (earliest-deadline-first). */
  cumulativeRemainingHours: number;
  cumulativeSlackHours: number;
  /** max(individual, cumulative) work ÷ free time. Above 1 means it cannot fit. */
  pressure: number;
  score: number;
  reason: string;
}

export interface UrgencyOptions extends FreeTimeOptions {
  now: Date;
  /** Classes, meetings and other blocks that are not available for work. */
  busy: readonly Interval[];
  /** Deadlines further out than this are still ranked but free time is only counted up to here. */
  horizonDays?: number;
}

export interface UrgencyResult<T extends UrgencyTask> {
  ranked: RankedTask<T>[];
  /** Open tasks without a deadline — shown separately, never ranked by urgency. */
  undated: T[];
}

// Tier thresholds. `ratio` = remaining work ÷ free time before the deadline.
const URGENT_HOURS = 24;
const SOON_HOURS = 72;
const URGENT_RATIO = 0.7;
const SOON_RATIO = 0.35;
const MIN_FREE_HOURS = 0.5; // avoids division blow-ups when a deadline has no free time before it

export function remainingHoursOf(task: UrgencyTask): number {
  const estimate = task.estimateHours ?? DEFAULT_ESTIMATE_HOURS[task.kind];
  const progress = Math.min(1, Math.max(0, task.progress));
  return Math.max(0, estimate * (1 - progress));
}

function formatDue(due: Date, now: Date, tz: string | undefined): string {
  const farAway = due.getTime() - now.getTime() > 6 * DAY_MS;
  return formatZoned(due, farAway ? "EEE d MMM HH:mm" : "EEE HH:mm", tz);
}

/**
 * Ranks open tasks by how hard their deadlines are to meet given the free time in the calendar.
 * Two tests are combined: each task on its own (work vs. free time before its deadline) and an
 * earliest-deadline-first pass where earlier deadlines consume the same free time first.
 */
export function rankTasks<T extends UrgencyTask>(tasks: readonly T[], options: UrgencyOptions): UrgencyResult<T> {
  const { now, tz } = options;
  const open = tasks.filter((task) => isOpenStatus(task.status));
  const undated = open.filter((task) => task.dueAt === null);
  const dated = open
    .filter((task): task is T & { dueAt: Date } => task.dueAt !== null)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id));

  const horizonMs = (options.horizonDays ?? 60) * DAY_MS;
  const latestDue = dated.reduce((max, task) => Math.max(max, task.dueAt.getTime()), now.getTime());
  const horizon = new Date(Math.min(latestDue, now.getTime() + horizonMs));
  const free = horizon.getTime() > now.getTime() ? freeIntervals(now, horizon, options.busy, options) : [];

  let cumulative = 0;
  const ranked = dated.map((task): RankedTask<T> => {
    const due = task.dueAt;
    const overdue = due.getTime() <= now.getTime();
    const hoursLeft = (due.getTime() - now.getTime()) / HOUR_MS;
    const remaining = remainingHoursOf(task);
    const freeHours = overdue ? 0 : freeHoursUntil(free, now, new Date(Math.min(due.getTime(), horizon.getTime())));
    cumulative += remaining;

    const slack = freeHours - remaining;
    const cumulativeSlack = freeHours - cumulative;
    const ratio = remaining / Math.max(freeHours, MIN_FREE_HOURS);
    const cumulativeRatio = cumulative / Math.max(freeHours, MIN_FREE_HOURS);
    const pressure = Math.max(ratio, cumulativeRatio);

    let tier: UrgencyTier = "ok";
    if (overdue || hoursLeft < URGENT_HOURS || slack < 0 || cumulativeSlack < 0 || ratio >= URGENT_RATIO) {
      tier = "urgent";
    } else if (hoursLeft < SOON_HOURS || ratio >= SOON_RATIO || cumulativeRatio >= URGENT_RATIO) {
      tier = "soon";
    }

    const dueLabel = formatDue(due, now, tz);
    let reason: string;
    if (overdue) {
      reason = `Overdue by ${formatDuration(now.getTime() - due.getTime())}`;
    } else if (slack < 0) {
      reason = `~${formatHours(remaining)} of work left, only ${formatHours(freeHours)} free before ${dueLabel}`;
    } else if (cumulativeSlack < 0) {
      reason = `With earlier deadlines you need ~${formatHours(cumulative)}, but only ${formatHours(freeHours)} free before ${dueLabel}`;
    } else if (hoursLeft < URGENT_HOURS) {
      reason = `Due in ${formatDuration(due.getTime() - now.getTime())} · ~${formatHours(remaining)} of work left`;
    } else {
      reason = `~${formatHours(remaining)} of work, ${formatHours(freeHours)} free before ${dueLabel}`;
    }

    // Cumulative pressure decides the tier; the in-tier order uses the task's own ratio so a small task
    // is not pushed up just because heavier work is due before it.
    const weight = task.weight ?? 1;
    const overdueBoost = overdue ? 1000 + (now.getTime() - due.getTime()) / HOUR_MS : 0;
    return {
      task,
      tier,
      overdue,
      remainingHours: remaining,
      freeHours,
      hoursLeft,
      slackHours: slack,
      cumulativeRemainingHours: cumulative,
      cumulativeSlackHours: cumulativeSlack,
      pressure,
      score: overdueBoost + weight * ratio,
      reason,
    };
  });

  ranked.sort(
    (a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
      b.score - a.score ||
      (a.task.dueAt?.getTime() ?? 0) - (b.task.dueAt?.getTime() ?? 0),
  );

  return { ranked, undated };
}
