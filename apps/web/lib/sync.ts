import "server-only";
import { DAY_MS, DEFAULT_TZ, zonedInstant } from "@hub/core";
import type { Json, TablesInsert } from "@hub/core/db";
import { decryptSecret } from "./crypto";
import { GoogleAuthError, listEvents, refreshAccessToken, type GoogleEvent } from "./google";
import { matchCourse, moodleDeadlines, parseIcs } from "./ics";
import { safeFetchText } from "./ssrf";
import type { AdminClient } from "./supabase/admin";

/** Events are mirrored for this window around "now"; older or later ones are left alone. */
const PAST_DAYS = 7;
const FUTURE_DAYS = 90;

export interface SyncOutcome {
  sourceId: string;
  ok: boolean;
  events?: number;
  tasks?: number;
  notModified?: boolean;
  error?: string;
}

export function secretAad(sourceId: string): string {
  return `calendar:${sourceId}`;
}

type EventRow = TablesInsert<"events">;

function googleEventRow(userId: string, sourceId: string, calendarId: string, event: GoogleEvent, tz: string): EventRow | null {
  if (event.status === "cancelled" || event.eventType === "workingLocation" || !event.start || !event.end) return null;
  const allDay = Boolean(event.start.date);
  const startsAt = allDay ? zonedInstant(event.start.date!, 0, tz) : new Date(event.start.dateTime!);
  const endsAt = allDay ? zonedInstant(event.end.date!, 0, tz) : new Date(event.end.dateTime!);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  return {
    user_id: userId,
    source_id: sourceId,
    external_id: `${calendarId}:${event.id}`.slice(0, 1024),
    calendar_id: calendarId,
    title: (event.summary ?? "(busy)").slice(0, 500),
    location: event.location?.slice(0, 500) ?? null,
    starts_at: startsAt.toISOString(),
    ends_at: (endsAt < startsAt ? startsAt : endsAt).toISOString(),
    all_day: allDay,
    busy: !allDay && event.transparency !== "transparent",
  };
}

/** Upserts the window's events and removes ones that no longer exist upstream. */
async function replaceEvents(admin: AdminClient, sourceId: string, rows: EventRow[], from: Date, to: Date): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("events").upsert(rows.slice(i, i + 500), { onConflict: "source_id,external_id" });
    if (error) throw new Error(`Saving events failed: ${error.message}`);
  }
  const keep = new Set(rows.map((row) => row.external_id));
  const { data: existing, error } = await admin
    .from("events")
    .select("id, external_id")
    .eq("source_id", sourceId)
    .gte("starts_at", from.toISOString())
    .lte("starts_at", to.toISOString());
  if (error) throw new Error(`Reading events failed: ${error.message}`);
  const stale = (existing ?? []).filter((row) => !keep.has(row.external_id)).map((row) => row.id);
  for (let i = 0; i < stale.length; i += 200) {
    await admin.from("events").delete().in("id", stale.slice(i, i + 200));
  }
}

async function syncMoodleTasks(
  admin: AdminClient,
  userId: string,
  sourceId: string,
  deadlines: ReturnType<typeof moodleDeadlines>,
): Promise<number> {
  const [{ data: courses }, { data: existing }] = await Promise.all([
    admin.from("courses").select("id, code, class_code").eq("user_id", userId),
    admin
      .from("tasks")
      .select("id, source_key, status, due_at, course_id")
      .eq("user_id", userId)
      .eq("source", "moodle")
      .like("source_key", `${sourceId}:%`),
  ]);
  const byKey = new Map((existing ?? []).map((task) => [task.source_key!, task]));
  const seen = new Set<string>();

  for (const deadline of deadlines) {
    const key = `${sourceId}:${deadline.key}`.slice(0, 300);
    seen.add(key);
    const course = matchCourse(deadline.courseHint, courses ?? []);
    const sourceRef: Json = { url: deadline.url, category: deadline.courseHint };
    const current = byKey.get(key);
    if (!current) {
      await admin.from("tasks").insert({
        user_id: userId,
        source: "moodle",
        source_key: key,
        title: deadline.title,
        kind: deadline.kind,
        due_at: deadline.dueAt.toISOString(),
        course_id: course?.id ?? null,
        source_ref: sourceRef,
      });
    } else {
      // Keep the user's own status, estimate, progress and course choice; refresh what Moodle owns.
      await admin
        .from("tasks")
        .update({
          title: deadline.title,
          due_at: deadline.dueAt.toISOString(),
          source_ref: sourceRef,
          ...(current.course_id ? {} : { course_id: course?.id ?? null }),
          // A deadline that reappears after being auto-cut is open again.
          ...(current.status === "cut" ? { status: "todo" } : {}),
        })
        .eq("id", current.id);
    }
  }

  // Future deadlines that vanished from the feed were removed in Moodle: cut them (never delete user data).
  const now = Date.now();
  const vanished = (existing ?? []).filter(
    (task) =>
      !seen.has(task.source_key!) &&
      task.due_at !== null &&
      new Date(task.due_at).getTime() > now &&
      (task.status === "todo" || task.status === "doing"),
  );
  if (vanished.length) {
    await admin.from("tasks").update({ status: "cut" }).in("id", vanished.map((task) => task.id));
  }
  return deadlines.length;
}

/** Syncs one calendar source. Never throws: failures are recorded on the source row. */
export async function syncCalendarSource(admin: AdminClient, sourceId: string): Promise<SyncOutcome> {
  const { data: source, error } = await admin.from("calendar_sources").select("*").eq("id", sourceId).single();
  if (error || !source) return { sourceId, ok: false, error: "Source not found" };

  const markError = async (message: string, revoked = false): Promise<SyncOutcome> => {
    await admin
      .from("calendar_sources")
      .update({ status: revoked ? "revoked" : "error", last_error: message.slice(0, 500), last_synced_at: new Date().toISOString() })
      .eq("id", sourceId);
    return { sourceId, ok: false, error: message };
  };

  try {
    const [{ data: secret }, { data: profile }] = await Promise.all([
      admin.from("integration_secrets").select("ciphertext").eq("source_id", sourceId).single(),
      admin.from("profiles").select("timezone").eq("id", source.user_id).single(),
    ]);
    if (!secret) return await markError("Missing credentials — reconnect this calendar", true);
    const credential = decryptSecret(secret.ciphertext, secretAad(sourceId));
    const tz = profile?.timezone ?? DEFAULT_TZ;
    const now = Date.now();
    const from = new Date(now - PAST_DAYS * DAY_MS);
    const to = new Date(now + FUTURE_DAYS * DAY_MS);
    const outcome: SyncOutcome = { sourceId, ok: true };
    let syncState = (source.sync_state ?? {}) as Record<string, string | null>;

    if (source.kind === "google" && !source.scope?.includes("calendar.readonly")) {
      // Free/busy-only grants (friends) are queried live for group scheduling; there are no events to mirror.
      outcome.events = 0;
    } else if (source.kind === "google") {
      const accessToken = await refreshAccessToken(credential);
      const calendars = (source.calendars as { id: string; selected?: boolean }[]).filter((c) => c.selected);
      const targets = calendars.length ? calendars.map((c) => c.id) : ["primary"];
      const rows: EventRow[] = [];
      for (const calendarId of targets) {
        for (const event of await listEvents(accessToken, calendarId, from, to)) {
          const row = googleEventRow(source.user_id, sourceId, calendarId, event, tz);
          if (row) rows.push(row);
        }
      }
      await replaceEvents(admin, sourceId, rows, from, to);
      outcome.events = rows.length;
    } else {
      const conditional: Record<string, string> = { accept: "text/calendar, text/plain;q=0.8, */*;q=0.1" };
      if (syncState.etag) conditional["if-none-match"] = syncState.etag;
      if (syncState.lastModified) conditional["if-modified-since"] = syncState.lastModified;
      const response = await safeFetchText(credential, { headers: conditional });
      if (response.status === 304) {
        outcome.notModified = true;
      } else if (response.status !== 200) {
        return await markError(`Calendar URL returned HTTP ${response.status}`);
      } else {
        const events = parseIcs(response.body, { from, to }, tz);
        if (source.flavor === "moodle") {
          outcome.tasks = await syncMoodleTasks(admin, source.user_id, sourceId, moodleDeadlines(events));
        } else {
          const rows: EventRow[] = events.map((event) => ({
            user_id: source.user_id,
            source_id: sourceId,
            external_id: event.uid.slice(0, 1024),
            calendar_id: null,
            title: event.title.slice(0, 500),
            location: event.location?.slice(0, 500) ?? null,
            starts_at: event.start.toISOString(),
            ends_at: event.end.toISOString(),
            all_day: event.allDay,
            busy: event.busy,
          }));
          await replaceEvents(admin, sourceId, rows, from, to);
          outcome.events = rows.length;
        }
        syncState = { etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
      }
    }

    await admin
      .from("calendar_sources")
      .update({ status: "active", last_error: null, last_synced_at: new Date().toISOString(), sync_state: syncState as Json })
      .eq("id", sourceId);
    return outcome;
  } catch (err) {
    if (err instanceof GoogleAuthError && err.revoked) {
      return markError("Google access was revoked or expired — reconnect Google Calendar", true);
    }
    return markError(err instanceof Error ? err.message : "Sync failed");
  }
}
