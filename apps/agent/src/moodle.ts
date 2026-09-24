import { inferTaskKind } from "@hub/core";
import type { UitPayload } from "@hub/core/protocol";

export class MoodleError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "MoodleError";
  }
}

/**
 * Exchanges the user's own Moodle credentials for a mobile web-service token. The password is used for
 * this single request and discarded by the caller; only the (revocable) token is stored.
 */
export async function fetchMoodleToken(baseUrl: string, username: string, password: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(new URL("/login/token.php", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, service: "moodle_mobile_app" }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { token?: string; error?: string; errorcode?: string };
  if (json.token && /^[a-f0-9]{32}$/i.test(json.token)) return json.token;
  if (json.errorcode === "enablewsdescription" || json.errorcode === "servicenotavailable") {
    throw new MoodleError("This Moodle does not allow mobile web-service tokens. Use the iCal export in Settings instead.", json.errorcode);
  }
  throw new MoodleError(json.error ?? `Moodle login failed (HTTP ${res.status})`, json.errorcode);
}

export class MoodleClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T>(wsfunction: string, params: Record<string, string | number> = {}): Promise<T> {
    const body = new URLSearchParams({ wstoken: this.token, wsfunction, moodlewsrestformat: "json" });
    for (const [key, value] of Object.entries(params)) body.set(key, String(value));
    const res = await this.fetchImpl(new URL("/webservice/rest/server.php", this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json()) as T & { exception?: string; message?: string; errorcode?: string };
    if (json && typeof json === "object" && "exception" in json && json.exception) {
      throw new MoodleError(json.message ?? json.exception, json.errorcode);
    }
    return json;
  }

  async collect(now = new Date()): Promise<UitPayload> {
    const site = await this.call<{ userid: number }>("core_webservice_get_site_info");
    const courses = await this.call<MoodleCourse[]>("core_enrol_get_users_courses", { userid: site.userid });
    const current = currentCourses(courses, now);
    const events = await this.call<{ events?: MoodleEvent[] }>("core_calendar_get_action_events_by_timesort", {
      timesortfrom: Math.floor(now.getTime() / 1000) - 7 * 86_400,
      timesortto: Math.floor(now.getTime() / 1000) + 120 * 86_400,
      limitnum: 200,
    });
    return {
      source: "moodle_ws",
      courses: current.flatMap((c) => {
        const mapped = mapCourse(c, this.baseUrl);
        return mapped ? [mapped] : [];
      }),
      deadlines: (events.events ?? []).flatMap((e) => {
        const mapped = mapEvent(e);
        return mapped ? [mapped] : [];
      }),
    };
  }
}

export interface MoodleCourse {
  id: number;
  shortname: string;
  fullname: string;
  startdate?: number;
  enddate?: number;
  visible?: number;
}

export interface MoodleEvent {
  id: number;
  name: string;
  timesort?: number;
  timestart?: number;
  course?: { id: number } | null;
  courseid?: number;
  url?: string;
  modulename?: string;
  eventtype?: string;
}

/** Courses of the running semester: started (or starting within 30 days) and not ended over 2 weeks ago. */
export function currentCourses(courses: MoodleCourse[], now: Date): MoodleCourse[] {
  const t = now.getTime() / 1000;
  return courses.filter((c) => {
    if (c.visible === 0) return false;
    const started = !c.startdate || c.startdate <= t + 30 * 86_400;
    const notEnded = !c.enddate || c.enddate >= t - 14 * 86_400;
    return started && notEnded;
  });
}

/** "NT219.Q11.ANTT" → code NT219, class NT219.Q11; fullname loses a trailing " - NT219.Q11" suffix. */
export function mapCourse(course: MoodleCourse, baseUrl: string): UitPayload["courses"][number] | null {
  const short = course.shortname.trim().toUpperCase();
  const code = /^([A-Z]{2,4}\d{3}[A-Z]?)/.exec(short)?.[1];
  if (!code) return null;
  const classCode = /^([A-Z]{2,4}\d{3}[A-Z]?\.[A-Z0-9]+)/.exec(short)?.[1] ?? null;
  const name = course.fullname
    .replace(new RegExp(`\\s*[-–(]\\s*${short.replace(/\./g, "\\.")}\\s*\\)?\\s*$`, "i"), "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return {
    moodleCourseId: course.id,
    code,
    classCode: classCode?.slice(0, 40) ?? null,
    name: name || code,
    url: new URL(`/course/view.php?id=${course.id}`, baseUrl).toString(),
  };
}

export function mapEvent(event: MoodleEvent): UitPayload["deadlines"][number] | null {
  const when = event.timesort ?? event.timestart;
  if (!when || !event.name) return null;
  const title = event.name.replace(/\s*(?:is due|closes|should be completed|đến hạn|hết hạn|đóng)\s*\.?$/iu, "").trim().slice(0, 300);
  const url = event.url && /^https:\/\//.test(event.url) ? event.url.slice(0, 500) : null;
  const kind = event.modulename === "quiz" ? "quiz" : event.modulename === "assign" ? "assignment" : inferTaskKind(event.name);
  return {
    eventId: event.id,
    moodleCourseId: event.course?.id ?? event.courseid ?? null,
    title: title || event.name.slice(0, 300),
    dueAt: new Date(when * 1000).toISOString(),
    url,
    kind: kind === "task" ? "assignment" : kind,
  };
}
