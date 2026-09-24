import "server-only";
import { isOpenStatus, type TaskStatus } from "@hub/core";
import type { Database, Tables } from "@hub/core/db";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<Database>;

export type Project = Tables<"projects">;
export type ProjectDocument = Omit<Tables<"project_documents">, "content">;
export type ChecklistItemRow = Tables<"checklist_items">;

export const PROJECT_STATUSES = ["active", "paused", "done", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Document columns without the (large) content, for lists. */
export const DOCUMENT_LIST_COLUMNS =
  "id, user_id, project_id, path, kind, title, content_hash, size_bytes, modified_at, truncated, redactions, reference_date, items_total, items_done, items_doing, items_attention, items_cut, error, indexed_at";

export interface ProjectProgress {
  /** 0–1: checklist items done ÷ (total − cut), or finished tasks ÷ tasks for projects without checklists. */
  ratio: number;
  done: number;
  countable: number;
  basis: "checklist" | "tasks" | "none";
}

export function projectProgress(project: Pick<Project, "items_total" | "items_done" | "items_cut">, tasks: { status: string }[] = []): ProjectProgress {
  const countable = project.items_total - project.items_cut;
  if (countable > 0) return { ratio: project.items_done / countable, done: project.items_done, countable, basis: "checklist" };
  const counted = tasks.filter((t) => t.status !== "cut");
  if (counted.length) {
    const done = counted.filter((t) => t.status === "done").length;
    return { ratio: done / counted.length, done, countable: counted.length, basis: "tasks" };
  }
  return { ratio: 0, done: 0, countable: 0, basis: "none" };
}

export interface ProjectTask {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  kind: string;
  project_id: string | null;
  source: string;
  source_ref: unknown;
}

export interface ProjectSummary {
  project: Project;
  progress: ProjectProgress;
  nextDeadline: ProjectTask | null;
  openTasks: number;
  overdue: number;
}

/** Every project of the user with progress and its next open deadline. */
export async function loadProjectSummaries(client: Client, userId: string, now: Date = new Date()): Promise<ProjectSummary[]> {
  const [{ data: projects }, { data: tasks }] = await Promise.all([
    client.from("projects").select("*").eq("user_id", userId).order("name"),
    client
      .from("tasks")
      .select("id, title, status, due_at, kind, project_id, source, source_ref")
      .eq("user_id", userId)
      .not("project_id", "is", null)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(2000),
  ]);
  const byProject = new Map<string, ProjectTask[]>();
  for (const task of tasks ?? []) {
    const list = byProject.get(task.project_id!) ?? [];
    list.push(task);
    byProject.set(task.project_id!, list);
  }
  return (projects ?? []).map((project) => {
    const list = byProject.get(project.id) ?? [];
    const open = list.filter((t) => isOpenStatus(t.status as TaskStatus));
    return {
      project,
      progress: projectProgress(project, list),
      nextDeadline: open.find((t) => t.due_at && new Date(t.due_at) >= now) ?? null,
      openTasks: open.length,
      overdue: open.filter((t) => t.due_at && new Date(t.due_at) < now).length,
    };
  });
}

/** Minimal project list for pickers and labels. */
export async function loadProjectOptions(client: Client, userId: string) {
  const { data } = await client.from("projects").select("id, name, color, status").eq("user_id", userId).order("name");
  return data ?? [];
}

export type ProjectOption = Awaited<ReturnType<typeof loadProjectOptions>>[number];

export function isActiveProject(status: string): boolean {
  return status === "active" || status === "paused";
}
