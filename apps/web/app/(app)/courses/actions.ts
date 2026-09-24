"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/lib/utils";
import { courseSchema, fieldErrors, formObject, semesterSchema, sessionSchema, uuid } from "@/lib/validation";

// Every action: authenticate → validate → write through the user's RLS-scoped client.

export async function saveSemester(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  const parsed = semesterSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const id = uuid.safeParse(formData.get("id"));

  if (parsed.data.is_current) {
    // Only one current semester per user (enforced by a partial unique index).
    await supabase.from("semesters").update({ is_current: false }).eq("user_id", user.id).eq("is_current", true);
  }
  const values = { ...parsed.data };
  const { error } = id.success
    ? await supabase.from("semesters").update(values).eq("id", id.data)
    : await supabase.from("semesters").insert(values);
  if (error) return { message: "Could not save the semester." };
  refresh();
  return { ok: true, message: "Semester saved." };
}

export async function makeSemesterCurrent(formData: FormData): Promise<void> {
  const { user, supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.from("semesters").update({ is_current: false }).eq("user_id", user.id).eq("is_current", true);
  await supabase.from("semesters").update({ is_current: true }).eq("id", id.data);
  refresh();
}

export async function saveCourse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  const parsed = courseSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const id = uuid.safeParse(formData.get("id"));

  if (id.success) {
    const { error } = await supabase.from("courses").update(parsed.data).eq("id", id.data);
    if (error) return { message: error.code === "23505" ? "Another course already uses this code and class." : "Could not save the course." };
    refresh();
    return { ok: true, message: "Course saved." };
  }

  const semesterId = uuid.safeParse(formData.get("semester_id"));
  if (!semesterId.success) return { message: "Create a semester first." };
  const { error } = await supabase.from("courses").insert({ ...parsed.data, semester_id: semesterId.data });
  if (error) return { message: error.code === "23505" ? "This course is already in the semester." : "Could not add the course." };
  refresh();
  return { ok: true, message: `${parsed.data.code} added.` };
}

export async function deleteCourse(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.from("courses").delete().eq("id", id.data);
  redirect("/courses");
}

export async function addSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  const parsed = sessionSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const s = parsed.data;
  const byPeriods = s.mode === "periods";
  const { error } = await supabase.from("course_sessions").insert({
    course_id: s.course_id,
    weekday: s.weekday,
    period_start: byPeriods ? s.period_start : null,
    period_end: byPeriods ? s.period_end : null,
    start_time: byPeriods ? null : s.start_time || null,
    end_time: byPeriods ? null : s.end_time || null,
    room: s.room ?? null,
    kind: s.kind,
    week_interval: s.week_interval,
    starts_on: s.starts_on || null,
    ends_on: s.ends_on || null,
  });
  // A foreign-key failure here means the course is not the caller's (composite FK on user_id).
  if (error) return { message: "Could not add the session." };
  refresh();
  return { ok: true, message: "Session added." };
}

export async function deleteSession(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.from("course_sessions").delete().eq("id", id.data);
  refresh();
}
