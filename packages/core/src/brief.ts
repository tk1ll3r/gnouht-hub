import type { DeadlineCluster } from "./analysis";
import { formatHours, formatZoned } from "./time";
import type { RankedTask, UrgencyTask } from "./urgency";

export interface AgendaItem {
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  detail?: string | null;
}

export interface BriefInput<T extends UrgencyTask> {
  now: Date;
  tz?: string;
  ranked: readonly RankedTask<T>[];
  undatedCount: number;
  agenda: readonly AgendaItem[];
  freeHoursToday: number;
  clusters: readonly DeadlineCluster[];
  /** Optional label prefix per task, e.g. the course code. */
  labelOf?: (task: T) => string | null;
}

export interface Brief {
  headline: string;
  markdown: string;
  counts: { urgent: number; soon: number; ok: number; undated: number };
}

/**
 * Deterministic morning brief. It is the fallback whenever the AI agent is offline, and the
 * structured facts the AI version is asked to rephrase.
 */
export function buildHeuristicBrief<T extends UrgencyTask>(input: BriefInput<T>): Brief {
  const { now, tz } = input;
  const counts = {
    urgent: input.ranked.filter((r) => r.tier === "urgent").length,
    soon: input.ranked.filter((r) => r.tier === "soon").length,
    ok: input.ranked.filter((r) => r.tier === "ok").length,
    undated: input.undatedCount,
  };

  const parts: string[] = [];
  if (counts.urgent) parts.push(`${counts.urgent} urgent`);
  if (counts.soon) parts.push(`${counts.soon} coming up`);
  const load = parts.length ? parts.join(", ") : "nothing pressing";
  const headline = `${formatZoned(now, "EEEE d MMM", tz)} — ${load}. ${formatHours(input.freeHoursToday)} free today.`;

  const lines: string[] = [`**${headline}**`, ""];

  const focus = input.ranked.filter((r) => r.tier !== "ok").slice(0, 5);
  if (focus.length) {
    lines.push("### Do first");
    focus.forEach((item, index) => {
      const label = input.labelOf?.(item.task);
      lines.push(`${index + 1}. **${label ? `${label} · ` : ""}${item.task.title}** — ${item.reason}`);
    });
    lines.push("");
  }

  if (input.agenda.length) {
    lines.push("### Today");
    for (const item of input.agenda) {
      const when = item.allDay
        ? "All day"
        : `${formatZoned(item.start, "HH:mm", tz)}–${formatZoned(item.end, "HH:mm", tz)}`;
      lines.push(`- ${when} · ${item.title}${item.detail ? ` (${item.detail})` : ""}`);
    }
    lines.push("");
  }

  const warnings: string[] = [];
  for (const cluster of input.clusters.slice(0, 2)) {
    warnings.push(
      `${cluster.ids.length} deadlines between ${formatZoned(cluster.start, "EEE d MMM", tz)} and ${formatZoned(cluster.end, "EEE d MMM", tz)} — start early.`,
    );
  }
  const overdue = input.ranked.filter((r) => r.overdue).length;
  if (overdue) warnings.push(`${overdue} overdue item${overdue > 1 ? "s" : ""} — finish or re-plan ${overdue > 1 ? "them" : "it"}.`);
  if (counts.undated) warnings.push(`${counts.undated} open task${counts.undated > 1 ? "s have" : " has"} no deadline.`);
  if (warnings.length) {
    lines.push("### Heads-up", ...warnings.map((w) => `- ${w}`), "");
  }

  return { headline, markdown: lines.join("\n").trim(), counts };
}
