"use server";

import { DEFAULT_TZ, parseClock, zonedInstant } from "@hub/core";
import type { TablesUpdate } from "@hub/core/db";
import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/lib/utils";
import { fieldErrors, formObject, taskSchema, taskUpdateSchema, uuid } from "@/lib/validation";

export async function createTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  const parsed = taskSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const t = parsed.data;

  const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", user.id).single();
  const tz = profile?.timezone ?? DEFAULT_TZ;
  const dueAt = t.due_date ? zonedInstant(t.due_date, t.due_time ? parseClock(t.due_time) : 23 * 60 + 59, tz) : null;

  const { error } = await supabase.from("tasks").insert({
    title: t.title,
    kind: t.kind,
    course_id: t.course_id || null,
    due_at: dueAt?.toISOString() ?? null,
    estimate_hours: t.estimate_hours ?? null,
    notes: t.notes ?? null,
  });
  if (error) return { message: "Could not add the task." };
  refresh();
  return { ok: true, message: "Task added." };
}

/** Inline edits from task rows: status, progress and estimate only. */
export async function updateTask(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const parsed = taskUpdateSchema.safeParse(formObject(formData));
  if (!parsed.success) return;
  const { id, status, progress, estimate_hours } = parsed.data;
  const patch: TablesUpdate<"tasks"> = {};
  if (status !== undefined) patch.status = status;
  if (progress !== undefined && progress !== null) patch.progress = progress;
  if (estimate_hours !== undefined) patch.estimate_hours = estimate_hours;
  if (Object.keys(patch).length === 0) return;
  await supabase.from("tasks").update(patch).eq("id", id);
  refresh();
}

export async function deleteTask(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  // RLS only lets owners delete manual tasks; synced ones are cut instead.
  await supabase.from("tasks").delete().eq("id", id.data);
  refresh();
}
