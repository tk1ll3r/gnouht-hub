import "server-only";
import {
  addDaysToKey,
  buildHeuristicBrief,
  dailyLoad,
  DAY_MS,
  deadlineClusters,
  DEFAULT_TZ,
  expandSessions,
  freeHoursUntil,
  freeIntervals,
  freeSlots,
  rankTasks,
  suggestStudyBlocks,
  UIT_PERIODS,
  zonedDateKey,
  zonedInstant,
  type ClassOccurrence,
  type Interval,
  type PeriodTime,
  type SessionRule,
  type UrgencyTask,
} from "@hub/core";
import type { Database, Tables } from "@hub/core/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// Works with both the user client (RLS) and the admin client (cron) — so every query filters by user_id.
type Client = SupabaseClient<Database>;

export type Profile = Tables<"profiles">;
export type Semester = Tables<"semesters">;
export type Course = Tables<"courses">;
export type CourseSession = Tables<"course_sessions">;
export type TaskRow = Tables<"tasks">;
export type EventRow = Tables<"events">;

const periodSchema = z.array(
  z.object({ period: z.number().int().min(1).max(20), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }),
);

export function periodsOf(profile: Pick<Profile, "period_times">): PeriodTime[] {
  const parsed = periodSchema.safeParse(profile.period_times);
  return parsed.success && parsed.data.length ? parsed.data : [...UIT_PERIODS];
}

export interface DayOptions {
  tz: string;
  dayStart: string;
  dayEnd: string;
  bufferMinutes: number;
}

export function dayOptions(profile: Profile): DayOptions {
  return {
    tz: profile.timezone || DEFAULT_TZ,
    dayStart: profile.day_start.slice(0, 5),
    dayEnd: profile.day_end.slice(0, 5) === "00:00" ? "24:00" : profile.day_end.slice(0, 5),
    bufferMinutes: profile.busy_buffer_minutes,
  };
}

export interface Workspace {
  profile: Profile;
  options: DayOptions;
  semester: Semester | null;
  semesters: Semester[];
  courses: Course[];
  sessions: CourseSession[];
}

export async function loadWorkspace(client: Client, userId: string): Promise<Workspace> {
  const [profileRes, semestersRes] = await Promise.all([
    client.from("profiles").select("*").eq("id", userId).single(),
    client.from("semesters").select("*").eq("user_id", userId).order("starts_on", { ascending: false }),
  ]);
  if (profileRes.error || !profileRes.data) throw new Error("Profile not found");
  const semesters = semestersRes.data ?? [];
  const semester = semesters.find((s) => s.is_current) ?? semesters[0] ?? null;

  let courses: Course[] = [];
  let sessions: CourseSession[] = [];
  if (semester) {
    const coursesRes = await client.from("courses").select("*").eq("user_id", userId).eq("semester_id", semester.id).order("code");
    courses = coursesRes.data ?? [];
    if (courses.length) {
      const sessionsRes = await client
        .from("course_sessions")
        .select("*")
        .eq("user_id", userId)
        .in("course_id", courses.map((c) => c.id));
      sessions = sessionsRes.data ?? [];
    }
  }
  return { profile: profileRes.data, options: dayOptions(profileRes.data), semester, semesters, courses, sessions };
}

export function sessionRules(workspace: Workspace): SessionRule[] {
  if (!workspace.semester) return [];
  const { starts_on, ends_on } = workspace.semester;
  return workspace.sessions.map((s) => ({
    id: s.id,
    courseId: s.course_id,
    weekday: s.weekday,
    periodStart: s.period_start,
    periodEnd: s.period_end,
    startTime: s.start_time?.slice(0, 5) ?? null,
    endTime: s.end_time?.slice(0, 5) ?? null,
    startsOn: s.starts_on ?? starts_on,
    endsOn: s.ends_on ?? ends_on,
    weekInterval: s.week_interval,
    room: s.room,
    kind: s.kind,
  }));
}

export function classesBetween(workspace: Workspace, from: Date, to: Date): ClassOccurrence[] {
  try {
    return expandSessions(sessionRules(workspace), from, to, {
      tz: workspace.options.tz,
      periods: periodsOf(workspace.profile),
      skipDates: workspace.semester?.skip_dates ?? [],
    });
  } catch {
    // A malformed period table must not take the whole page down; the Courses page shows the error.
    return [];
  }
}

export async function loadEvents(client: Client, userId: string, from: Date, to: Date): Promise<EventRow[]> {
  const { data } = await client
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString())
    .order("starts_at")
    .limit(3000);
  return data ?? [];
}

export async function loadTasks(client: Client, userId: string, options: { includeDone?: boolean } = {}): Promise<TaskRow[]> {
  let query = client.from("tasks").select("*").eq("user_id", userId).order("due_at", { ascending: true, nullsFirst: false }).limit(1000);
  if (!options.includeDone) query = query.not("status", "in", "(done,cut)");
  const { data } = await query;
  return data ?? [];
}

export interface ProjectLabel {
  id: string;
  name: string;
  color: string;
}

export interface RankableTask extends UrgencyTask {
  row: TaskRow;
  course: Course | null;
  project: ProjectLabel | null;
}

export async function loadProjectLabels(client: Client, userId: string): Promise<ProjectLabel[]> {
  const { data } = await client.from("projects").select("id, name, color").eq("user_id", userId);
  return data ?? [];
}

export function toRankable(tasks: TaskRow[], courses: Course[], projects: ProjectLabel[] = []): RankableTask[] {
  const byId = new Map(courses.map((c) => [c.id, c]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  return tasks.map((row) => {
    const course = row.course_id ? byId.get(row.course_id) ?? null : null;
    return {
      id: row.id,
      title: row.title,
      kind: row.kind as UrgencyTask["kind"],
      status: row.status as UrgencyTask["status"],
      dueAt: row.due_at ? new Date(row.due_at) : null,
      estimateHours: row.estimate_hours,
      progress: Number(row.progress),
      weight: course ? Number(course.weight) : 1,
      row,
      course,
      project: row.project_id ? projectById.get(row.project_id) ?? null : null,
    };
  });
}

export function busyIntervals(classes: ClassOccurrence[], events: EventRow[]): Interval[] {
  return [
    ...classes.map((c) => ({ start: c.start, end: c.end })),
    ...events.filter((e) => e.busy && !e.all_day).map((e) => ({ start: new Date(e.starts_at), end: new Date(e.ends_at) })),
  ];
}

export interface AgendaEntry {
  id: string;
  kind: "class" | "event" | "study";
  title: string;
  detail: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
  href?: string;
}

/** Everything the Today page and the daily digest need, computed from one consistent snapshot. */
export async function buildToday(client: Client, userId: string, now: Date = new Date()) {
  const workspace = await loadWorkspace(client, userId);
  const { tz, dayStart, dayEnd, bufferMinutes } = workspace.options;
  const todayKey = zonedDateKey(now, tz);
  const dayStartAt = zonedInstant(todayKey, 0, tz);
  const horizon = new Date(now.getTime() + 60 * DAY_MS);

  const [events, taskRows, projects] = await Promise.all([
    loadEvents(client, userId, dayStartAt, horizon),
    loadTasks(client, userId),
    loadProjectLabels(client, userId),
  ]);
  const classes = classesBetween(workspace, dayStartAt, horizon);
  const busy = busyIntervals(classes, events);
  const freeOptions = { tz, dayStart, dayEnd, bufferMinutes };

  const tasks = toRankable(taskRows, workspace.courses, projects);
  const { ranked, undated } = rankTasks(tasks, { now, busy, ...freeOptions });

  const tomorrowStart = zonedInstant(addDaysToKey(todayKey, 1), 0, tz);
  const freeToday = freeIntervals(now, tomorrowStart, busy, freeOptions);
  const freeHoursToday = freeHoursUntil(freeToday, now, tomorrowStart);
  const weekSlots = freeSlots(now, new Date(now.getTime() + 7 * DAY_MS), busy, { ...freeOptions, minMinutes: 90 });
  const studyBlocks = suggestStudyBlocks(ranked, weekSlots, { minMinutes: 90, maxBlockMinutes: 150, maxBlocks: 8 });
  const load = dailyLoad(
    todayKey,
    14,
    busy,
    ranked.map((r) => r.task.dueAt!).filter(Boolean),
    freeOptions,
  );
  const clusters = deadlineClusters(ranked.filter((r) => !r.overdue).map((r) => ({ id: r.task.id, dueAt: r.task.dueAt! })));

  const courseById = new Map(workspace.courses.map((c) => [c.id, c]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const agenda: AgendaEntry[] = [
    ...classes
      .filter((c) => c.start < tomorrowStart)
      .map((c) => {
        const course = courseById.get(c.courseId);
        return {
          id: `class:${c.sessionId}:${c.date}`,
          kind: "class" as const,
          title: course ? `${course.code} · ${course.name}` : "Class",
          detail: [c.kind !== "lecture" ? c.kind : null, c.room].filter(Boolean).join(" · ") || null,
          start: c.start,
          end: c.end,
          allDay: false,
          color: course?.color ?? "#2563eb",
          href: course ? `/courses/${course.id}` : undefined,
        };
      }),
    ...events
      .filter((e) => new Date(e.starts_at) < tomorrowStart)
      .map((e) => ({
        id: `event:${e.id}`,
        kind: "event" as const,
        title: e.title,
        detail: e.location,
        start: new Date(e.starts_at),
        end: new Date(e.ends_at),
        allDay: e.all_day,
        color: "#64748b",
      })),
    ...studyBlocks
      .filter((b) => b.start < tomorrowStart)
      .map((b) => ({
        id: `study:${b.taskId}:${b.start.toISOString()}`,
        kind: "study" as const,
        title: `Suggested: ${taskById.get(b.taskId)?.title ?? "study block"}`,
        detail: null,
        start: b.start,
        end: b.end,
        allDay: false,
        color: "#16a34a",
      })),
  ].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());

  const brief = buildHeuristicBrief({
    now,
    tz,
    ranked,
    undatedCount: undated.length,
    agenda: agenda.filter((a) => a.kind !== "study").map((a) => ({ title: a.title, start: a.start, end: a.end, allDay: a.allDay, detail: a.detail })),
    freeHoursToday,
    clusters,
    labelOf: (task) => task.course?.code ?? task.project?.name ?? null,
  });

  return { workspace, projects, now, todayKey, ranked, undated, agenda, freeHoursToday, load, clusters, studyBlocks, brief };
}

export type TodayData = Awaited<ReturnType<typeof buildToday>>;
