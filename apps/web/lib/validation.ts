import { TASK_KINDS, TASK_STATUSES, parseClock } from "@hub/core";
import { z } from "zod";

export const uuid = z.uuid("Invalid id");
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm")
  .or(z.literal("24:00"));
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((v) => (v === "" || v == null ? null : Number(v)), schema.nullable());

/** FormData → plain object (last value wins; unchecked checkboxes are simply absent). */
export function formObject(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

export const semesterSchema = z
  .object({
    name: z.string().trim().min(1, "Required").max(80),
    starts_on: dateKey,
    ends_on: dateKey,
    is_current: checkbox,
    skip_dates: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((v, ctx) => {
        const list = (v ?? "").split(/[\s,;]+/).filter(Boolean);
        for (const item of list) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(item)) {
            ctx.addIssue({ code: "custom", message: `"${item}" is not YYYY-MM-DD` });
            return z.NEVER;
          }
        }
        return [...new Set(list)].slice(0, 60);
      }),
  })
  .refine((s) => s.ends_on > s.starts_on, { path: ["ends_on"], message: "Must be after the start date" });

export const courseSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9._-]{2,20}$/, "2–20 letters/digits, e.g. NT219"),
  class_code: optionalText(40),
  name: z.string().trim().min(1, "Required").max(160),
  credits: optionalNumber(z.number().int().min(0).max(20)),
  lecturer: optionalText(120),
  room: optionalText(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
  weight: z.coerce.number().min(0.5).max(3),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https:\/\//.test(v), "Must start with https://")
    .transform((v) => (v === "" ? null : v))
    .optional(),
});

export const sessionSchema = z
  .object({
    course_id: uuid,
    weekday: z.coerce.number().int().min(1).max(7),
    mode: z.enum(["periods", "times"]),
    period_start: optionalNumber(z.number().int().min(1).max(20)),
    period_end: optionalNumber(z.number().int().min(1).max(20)),
    start_time: clock.optional().or(z.literal("")),
    end_time: clock.optional().or(z.literal("")),
    room: optionalText(60),
    kind: z.enum(["lecture", "lab", "exam", "other"]),
    week_interval: z.coerce.number().int().min(1).max(4),
    starts_on: dateKey.optional().or(z.literal("")),
    ends_on: dateKey.optional().or(z.literal("")),
  })
  .superRefine((s, ctx) => {
    if (s.mode === "periods") {
      if (!s.period_start || !s.period_end) ctx.addIssue({ code: "custom", path: ["period_start"], message: "Choose the periods" });
      else if (s.period_end < s.period_start) ctx.addIssue({ code: "custom", path: ["period_end"], message: "Must not be before the first period" });
    } else if (!s.start_time || !s.end_time) {
      ctx.addIssue({ code: "custom", path: ["start_time"], message: "Enter start and end times" });
    } else if (parseClock(s.end_time) <= parseClock(s.start_time)) {
      ctx.addIssue({ code: "custom", path: ["end_time"], message: "Must be after the start time" });
    }
    if (s.starts_on && s.ends_on && s.ends_on < s.starts_on) {
      ctx.addIssue({ code: "custom", path: ["ends_on"], message: "Must not be before the first date" });
    }
  });

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Required").max(300),
  course_id: z.union([uuid, z.literal("")]).optional(),
  project_id: z.union([uuid, z.literal("")]).optional(),
  kind: z.enum(TASK_KINDS),
  due_date: dateKey.optional().or(z.literal("")),
  due_time: clock.optional().or(z.literal("")),
  estimate_hours: optionalNumber(z.number().positive().max(500)),
  notes: optionalText(5000),
});

export const taskUpdateSchema = z.object({
  id: uuid,
  status: z.enum(TASK_STATUSES).optional(),
  progress: optionalNumber(z.number().min(0).max(1)).optional(),
  estimate_hours: optionalNumber(z.number().positive().max(500)).optional(),
});

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const profileSchema = z
  .object({
    display_name: z.string().trim().max(80),
    timezone: z.string().refine(isTimeZone, "Unknown time zone"),
    day_start: clock,
    day_end: clock,
    busy_buffer_minutes: z.coerce.number().int().min(0).max(120),
    email_digest: checkbox,
  })
  .refine((p) => parseClock(p.day_end) > parseClock(p.day_start), { path: ["day_end"], message: "Must be after the day start" });

export const icsSourceSchema = z.object({
  name: z.string().trim().min(1, "Required").max(80),
  url: z.string().trim().min(1, "Required").max(2000),
  flavor: z.enum(["moodle", "generic"]),
});

export const projectSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  description: optionalText(2000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
  course_id: z
    .union([uuid, z.literal("")])
    .optional()
    .transform((v) => v || null),
  status: z.enum(["active", "paused", "done", "archived"]),
  due_on: dateKey
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
});

export const searchSchema = z.object({
  q: z.string().trim().max(200).catch(""),
  project: uuid.optional().catch(undefined),
  kind: z.enum(["all", "notes", "code"]).catch("all"),
});
