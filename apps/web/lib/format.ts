import { formatZoned, WEEKDAY_LABELS } from "@hub/core";
import type { CourseSession } from "./data";

export function sessionLabel(session: Pick<CourseSession, "weekday" | "period_start" | "period_end" | "start_time" | "end_time" | "room" | "kind" | "week_interval">): string {
  const day = WEEKDAY_LABELS[session.weekday - 1] ?? "?";
  const time =
    session.period_start != null && session.period_end != null
      ? `P${session.period_start}${session.period_end !== session.period_start ? `–${session.period_end}` : ""}`
      : `${session.start_time?.slice(0, 5)}–${session.end_time?.slice(0, 5)}`;
  return [day, time, session.kind !== "lecture" ? session.kind : null, session.room, session.week_interval > 1 ? `every ${session.week_interval} wks` : null]
    .filter(Boolean)
    .join(" · ");
}

export function formatDue(iso: string | Date, tz: string, now: Date = new Date()): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const sameYear = formatZoned(date, "yyyy", tz) === formatZoned(now, "yyyy", tz);
  return formatZoned(date, sameYear ? "EEE d MMM, HH:mm" : "d MMM yyyy, HH:mm", tz);
}

export function formatDateRange(start: string, end: string): string {
  const fmt = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  };
  return `${fmt(start)} – ${fmt(end)} ${end.slice(0, 4)}`;
}

export function relativeTime(date: Date | string, now: Date = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Math.round((d.getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(diff);
  const unit = abs < 60 ? `${abs}m` : abs < 48 * 60 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}
