"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { allow } from "@/lib/rate-limit";
import type { ActionState } from "@/lib/utils";
import { fieldErrors, formObject, projectSchema, uuid } from "@/lib/validation";

export async function saveProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  if (!(await allow(`project:${user.id}`, 30, 600))) return { message: "Too many changes in a few minutes. Wait a little." };
  const parsed = projectSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const id = uuid.safeParse(formData.get("id"));

  if (id.success) {
    const { error } = await supabase.from("projects").update(parsed.data).eq("id", id.data);
    if (error) return { message: "Could not save the project." };
    refresh();
    return { ok: true, message: "Project saved." };
  }
  const { data, error } = await supabase.from("projects").insert(parsed.data).select("id").single();
  if (error || !data) return { message: "Could not create the project." };
  redirect(`/projects/${data.id}`);
}

export async function deleteProject(formData: FormData): Promise<void> {
  const { user, supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  // Cascades to documents, checklist items and milestone tasks; manual tasks just lose the link.
  const { data } = await supabase.from("projects").delete().eq("id", id.data).select("id, source");
  if (data?.length) await audit(user.id, "project.delete", "project", id.data, { source: data[0]!.source });
  redirect("/projects");
}
