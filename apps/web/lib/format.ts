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
    .join(", ");
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
  if (abs < 1) return "just now";
  const unit = abs < 60 ? `${abs}m` : abs < 48 * 60 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

/** True when an ISO timestamp is within `ms` of now (kept outside components so render stays pure). */
export function isRecent(iso: string | null | undefined, ms: number): boolean {
  return Boolean(iso) && Date.now() - new Date(iso!).getTime() < ms;
}

const AUDIT_LABELS: Record<string, string> = {
  "auth.sign_in": "Signed in",
  "auth.sign_out": "Signed out",
  "device.pairing_code": "Created a device pairing code",
  "device.pair": "Paired a device",
  "device.revoke": "Revoked a device",
  "integration.google.connect": "Connected Google Calendar",
  "integration.google.disconnect": "Disconnected Google Calendar",
  "integration.ics.connect": "Added a calendar feed",
  "integration.ics.disconnect": "Removed a calendar feed",
  "uit.import": "Imported courses from UIT",
  "project.create": "A watched folder became a project",
  "project.delete": "Deleted a project",
  "project.share": "Shared a project with a group",
  "project.unshare": "Stopped sharing a project",
  "group.create": "Created a group",
  "group.delete": "Deleted a group",
  "group.invite": "Invited someone to a group",
  "group.join": "Joined a group",
  "group.leave": "Left a group",
  "group.remove_member": "Removed a group member",
  "group.share_busy_on": "Started sharing free/busy with a group",
  "group.share_busy_off": "Stopped sharing free/busy with a group",
  "auth.mfa_verify": "Passed two-step sign-in",
  "auth.mfa_failed": "Entered a wrong two-step code",
  "auth.sign_out_all": "Signed out everywhere",
  "mfa.enable": "Turned on two-step sign-in",
  "mfa.disable": "Turned off two-step sign-in",
  "account.export": "Downloaded account data",
  "account.delete": "Deleted the account",
  "ai.enable": "Turned on the AI assistant",
  "ai.disable": "Turned off the AI assistant",
};

/** Security log entries in words, falling back to the raw action name for anything new. */
export function auditLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action;
}
