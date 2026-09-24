import "server-only";
import { addDaysToKey, inferTaskKind, type TaskKind, zonedInstant } from "@hub/core";
import ical, { type DateWithTimeZone, type ParameterValue, type VEvent } from "node-ical";

export interface IcsEvent {
  /** Unique per occurrence: the UID, plus the start instant for recurring instances. */
  uid: string;
  title: string;
  location: string | null;
  description: string | null;
  categories: string[];
  url: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  /** TRANSP:TRANSPARENT and all-day events do not block time. */
  busy: boolean;
}

const MAX_EVENTS = 5000;

function text(value: ParameterValue | undefined): string | null {
  if (value == null) return null;
  const raw = typeof value === "string" ? value : String((value as { val?: unknown }).val ?? "");
  const trimmed = raw.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

/** Calendar date of an ICS DATE value. node-ical builds date-only values at local midnight of the server. */
function dateOnlyKey(date: DateWithTimeZone): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toEvent(uid: string, event: VEvent, start: DateWithTimeZone, end: DateWithTimeZone | undefined, allDay: boolean, tz: string): IcsEvent {
  let startAt: Date;
  let endAt: Date;
  if (allDay) {
    const startKey = dateOnlyKey(start);
    const endKey = end ? dateOnlyKey(end) : addDaysToKey(startKey, 1);
    startAt = zonedInstant(startKey, 0, tz);
    endAt = zonedInstant(endKey > startKey ? endKey : addDaysToKey(startKey, 1), 0, tz);
  } else {
    startAt = new Date(start.getTime());
    endAt = end ? new Date(end.getTime()) : new Date(start.getTime());
  }
  return {
    uid,
    title: text(event.summary) ?? "(no title)",
    location: text(event.location),
    description: text(event.description),
    categories: (event.categories ?? []).map((c) => String(c).trim()).filter(Boolean),
    url: typeof event.url === "string" && /^https:\/\//.test(event.url) ? event.url : null,
    start: startAt,
    end: endAt < startAt ? startAt : endAt,
    allDay,
    busy: !allDay && event.transparency !== "TRANSPARENT",
  };
}

/**
 * Parses an iCalendar feed into concrete events overlapping [from, to]. Recurring events are
 * expanded (EXDATE and RECURRENCE-ID overrides applied); cancelled events are dropped.
 */
export function parseIcs(body: string, window: { from: Date; to: Date }, tz: string): IcsEvent[] {
  if (!/^\s*BEGIN:VCALENDAR/i.test(body)) throw new Error("This URL did not return an iCalendar (.ics) feed");
  const data = ical.sync.parseICS(body);
  const events: IcsEvent[] = [];

  for (const component of Object.values(data)) {
    if (!component || (component as { type?: string }).type !== "VEVENT") continue;
    const event = component as VEvent;
    if (event.status === "CANCELLED" || !event.start) continue;
    const allDay = event.datetype === "date";

    if (event.rrule) {
      const instances = ical.expandRecurringEvent(event, { from: window.from, to: window.to, expandOngoing: true });
      for (const instance of instances) {
        if (instance.event.status === "CANCELLED") continue;
        events.push(
          toEvent(`${event.uid}@${instance.start.toISOString()}`, instance.event, instance.start, instance.end, instance.isFullDay, tz),
        );
        if (events.length >= MAX_EVENTS) return events;
      }
      continue;
    }

    const single = toEvent(event.uid, event, event.start, event.end, allDay, tz);
    if (single.end.getTime() >= window.from.getTime() && single.start.getTime() <= window.to.getTime()) {
      events.push(single);
      if (events.length >= MAX_EVENTS) return events;
    }
  }
  return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export interface MoodleDeadline {
  key: string;
  title: string;
  kind: TaskKind;
  dueAt: Date;
  courseHint: string | null;
  url: string | null;
}

// Moodle titles end with the event type: "Lab 1 is due", "Quiz 1 closes", "Bài tập 2 đến hạn".
const DUE_SUFFIX = /\s*(?:is due|due|closes|should be completed|đến hạn|hết hạn|đóng|kết thúc)\s*\.?$/iu;
const OPENS_SUFFIX = /\s*(?:opens|mở|bắt đầu)\s*\.?$/iu;

/** Turns a Moodle calendar export into deadlines ("… opens" events are not deadlines and are skipped). */
export function moodleDeadlines(events: readonly IcsEvent[]): MoodleDeadline[] {
  const deadlines: MoodleDeadline[] = [];
  for (const event of events) {
    if (OPENS_SUFFIX.test(event.title)) continue;
    const title = event.title.replace(DUE_SUFFIX, "").trim() || event.title;
    deadlines.push({
      key: event.uid,
      title: title.slice(0, 300),
      kind: inferTaskKind(event.title) === "task" ? "assignment" : inferTaskKind(event.title),
      // Moodle exports deadlines as zero-length events; the end is the due time.
      dueAt: event.end,
      courseHint: event.categories[0] ?? null,
      url: event.url,
    });
  }
  return deadlines;
}

/** Picks the course whose class code (preferred) or code best prefixes the Moodle category. */
export function matchCourse<T extends { id: string; code: string; class_code: string | null }>(
  hint: string | null,
  courses: readonly T[],
): T | null {
  if (!hint) return null;
  const needle = hint.toUpperCase();
  let best: { course: T; score: number } | null = null;
  for (const course of courses) {
    for (const candidate of [course.class_code, course.code]) {
      if (!candidate) continue;
      const code = candidate.toUpperCase();
      const score = needle.startsWith(code) ? code.length + 100 : needle.includes(code) ? code.length : 0;
      if (score > (best?.score ?? 0)) best = { course, score };
    }
  }
  return best?.course ?? null;
}
