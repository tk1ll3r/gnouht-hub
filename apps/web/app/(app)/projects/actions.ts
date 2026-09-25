"use server";

import { DEFAULT_TZ, projectSlug, zonedInstant } from "@hub/core";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { allow } from "@/lib/rate-limit";
import type { ActionState } from "@/lib/utils";
import { fieldErrors, formObject, milestoneSchema, projectSchema, teamTaskSchema, uuid } from "@/lib/validation";

const END_OF_DAY = 23 * 60 + 59;

export async function saveProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  if (!(await allow(`project:${user.id}`, 30, 600))) return { message: "Too many changes in a few minutes. Wait a little." };
  const parsed = projectSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const id = uuid.safeParse(formData.get("id"));
  const { slug, ...fields } = parsed.data;

  if (id.success) {
    // RLS lets the lead and editors update; for anyone else this matches no row.
    const { data, error } = await supabase
      .from("projects")
      .update({ ...fields, ...(slug ? { slug } : {}) })
      .eq("id", id.data)
      .select("id");
    if (error?.code === "23505") return { errors: { slug: ["You already have a project with this short name."] } };
    if (error || !data?.length) return { message: "Could not save the project." };
    refresh();
    return { ok: true, message: "Project saved." };
  }
  const { data, error } = await supabase
    .from("projects")
    .insert({ ...fields, slug: slug ?? projectSlug(fields.name) })
    .select("id")
    .single();
  if (error?.code === "23505") return { errors: { slug: ["You already have a project with this short name. Pick another."] } };
  if (error || !data) return { message: "Could not create the project." };
  await audit(user.id, "project.create", "project", data.id);
  redirect(`/projects/${data.id}`);
}

export async function deleteProject(formData: FormData): Promise<void> {
  const { user, supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  // Only the lead can delete (RLS). Tasks, milestones and members go with it; synced files stay the
  // members' own and are detached.
  const { data } = await supabase.from("projects").delete().eq("id", id.data).select("id, folder_key");
  if (data?.length) await audit(user.id, "project.delete", "project", id.data, { folder: Boolean(data[0]!.folder_key) });
  redirect("/projects");
}

// ── team ──────────────────────────────────────────────────────────────────────

const roleSchema = z.enum(["editor", "viewer"]);

async function rpcAction(name: "link_group_project" | "unlink_group_project" | "set_project_member_role" | "add_project_member" | "remove_project_member", args: Record<string, string>) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc(name, args as never);
  if (error) console.warn(name, error.code, error.message);
  refresh();
  return !error;
}

export async function linkGroup(formData: FormData): Promise<void> {
  const project = uuid.safeParse(formData.get("project_id"));
  const group = uuid.safeParse(formData.get("group_id"));
  const role = roleSchema.safeParse(formData.get("role"));
  if (!project.success || !group.success || !role.success) return;
  await rpcAction("link_group_project", { p_project: project.data, p_group: group.data, p_role: role.data });
}

export async function unlinkGroup(formData: FormData): Promise<void> {
  const project = uuid.safeParse(formData.get("project_id"));
  const group = uuid.safeParse(formData.get("group_id"));
  if (!project.success || !group.success) return;
  await rpcAction("unlink_group_project", { p_project: project.data, p_group: group.data });
}

export async function setMemberRole(formData: FormData): Promise<void> {
  const project = uuid.safeParse(formData.get("project_id"));
  const member = uuid.safeParse(formData.get("user_id"));
  const role = roleSchema.safeParse(formData.get("role"));
  if (!project.success || !member.success || !role.success) return;
  await rpcAction("set_project_member_role", { p_project: project.data, p_user: member.data, p_role: role.data });
}

export async function addMember(formData: FormData): Promise<void> {
  const project = uuid.safeParse(formData.get("project_id"));
  const member = uuid.safeParse(formData.get("user_id"));
  const role = roleSchema.safeParse(formData.get("role"));
  if (!project.success || !member.success || !role.success) return;
  await rpcAction("add_project_member", { p_project: project.data, p_user: member.data, p_role: role.data });
}

/** The lead removes a member, or a member leaves (then they go back to the project list). */
export async function removeMember(formData: FormData): Promise<void> {
  const { user } = await requireUser();
  const project = uuid.safeParse(formData.get("project_id"));
  const member = uuid.safeParse(formData.get("user_id"));
  if (!project.success || !member.success) return;
  const ok = await rpcAction("remove_project_member", { p_project: project.data, p_user: member.data });
  if (ok && member.data === user.id) redirect("/projects");
}

/** Shows or hides the caller's own synced files to the other members. */
export async function setFileSharing(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const project = uuid.safeParse(formData.get("project_id"));
  if (!project.success) return;
  await supabase.rpc("set_document_sharing", { p_project: project.data, p_share: formData.get("share") === "true" });
  refresh();
}

// ── team tasks ────────────────────────────────────────────────────────────────

async function profileTz(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("timezone").eq("id", userId).single();
  return data?.timezone ?? DEFAULT_TZ;
}

/** Owners and editors add a task, optionally assigned, with a permission level (restricting needs the lead). */
export async function createTeamTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  const parsed = teamTaskSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (!(await allow(`task:${user.id}`, 60, 600))) return { message: "Adding tasks too fast. Wait a few minutes." };
  const t = parsed.data;
  const tz = await profileTz(supabase, user.id);
  const { error } = await supabase.from("tasks").insert({
    title: t.title,
    kind: t.kind,
    project_id: t.project_id,
    assignee_id: t.assignee_id,
    permission: t.permission,
    notes: t.notes ?? null,
    due_at: t.due_date ? zonedInstant(t.due_date, END_OF_DAY, tz).toISOString() : null,
  });
  if (error?.code === "42501") return { message: error.message.includes("restrict") ? "Only the lead can restrict a task." : "You cannot add tasks to this project." };
  if (error?.code === "23514") return { errors: { assignee_id: ["Pick someone in this project."] } };
  if (error) return { message: "Could not add the task." };
  refresh();
  return { ok: true, message: "Task added." };
}

/** Hands a task to a member (or nobody). RLS and the task's permission decide who may. */
export async function assignTask(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  const assignee = z.union([uuid, z.literal("")]).safeParse(formData.get("assignee_id") ?? "");
  if (!id.success || !assignee.success) return;
  await supabase.from("tasks").update({ assignee_id: assignee.data || null }).eq("id", id.data);
  refresh();
}

/** The lead decides who may change a task: the team, only its assignee, or only the lead. */
export async function setTaskPermission(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  const permission = z.enum(["team", "assignee", "owner"]).safeParse(formData.get("permission"));
  if (!id.success || !permission.success) return;
  await supabase.from("tasks").update({ permission: permission.data }).eq("id", id.data);
  refresh();
}

// ── milestones ────────────────────────────────────────────────────────────────

export async function addMilestone(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  const parsed = milestoneSchema.safeParse(formObject(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (!(await allow(`milestone:${user.id}`, 60, 600))) return { message: "Too many changes in a few minutes. Wait a little." };
  const { error } = await supabase.from("milestones").insert(parsed.data);
  if (error) return { message: error.code === "42501" ? "Only the lead and editors add milestones." : "Could not add the milestone." };
  refresh();
  return { ok: true, message: "Milestone added." };
}

export async function toggleMilestone(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.from("milestones").update({ done: formData.get("done") === "true" }).eq("id", id.data);
  refresh();
}

export async function deleteMilestone(formData: FormData): Promise<void> {
  const { supabase } = await requireUser();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.from("milestones").delete().eq("id", id.data);
  refresh();
}

// ── TODO comments ─────────────────────────────────────────────────────────────

/** Turns a TODO/FIXME comment of a project file into a project task (once). Owners and editors only (RLS). */
export async function todoToTask(formData: FormData): Promise<void> {
  const { user, supabase } = await requireUser();
  const documentId = uuid.safeParse(formData.get("document_id"));
  const line = Number(formData.get("line"));
  if (!documentId.success || !Number.isInteger(line) || line < 1) return;
  if (!(await allow(`task:${user.id}`, 60, 600))) return;
  const { data: doc } = await supabase.from("documents").select("id, project_id, path, todos").eq("id", documentId.data).maybeSingle();
  if (!doc?.project_id) return;
  const todo = (Array.isArray(doc.todos) ? (doc.todos as { tag?: string; text?: string; line?: number }[]) : []).find((t) => t.line === line);
  if (!todo?.text) return;
  const notes = `${todo.tag ?? "TODO"} in ${doc.path}:${line}`;
  const { data: existing } = await supabase.from("tasks").select("id").eq("project_id", doc.project_id).eq("notes", notes).not("status", "in", "(done,cut)").limit(1);
  if (!existing?.length) {
    await supabase.from("tasks").insert({ title: todo.text.slice(0, 300), kind: "task", project_id: doc.project_id, notes });
  }
  refresh();
}
