import "server-only";
import { isOpenStatus, type TaskStatus } from "@hub/core";
import type { Database, Tables } from "@hub/core/db";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<Database>;

export type Project = Tables<"projects">;
export type ProjectDocument = Pick<
  Tables<"documents">,
  | "id"
  | "owner_id"
  | "project_id"
  | "path"
  | "title"
  | "ext"
  | "kind"
  | "language"
  | "size_bytes"
  | "modified_at"
  | "visibility"
  | "excerpt"
  | "checklist"
  | "line_count"
  | "redactions"
  | "truncated"
  | "error"
  | "indexed_at"
>;
export type ChecklistItemRow = Tables<"checklist_items">;
export type Milestone = Tables<"milestones">;

export const PROJECT_STATUSES = ["active", "done", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_KINDS = ["course", "research", "ctf", "personal"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];
export const PROJECT_KIND_LABELS: Record<ProjectKind, string> = { course: "Course project", research: "Research", ctf: "CTF", personal: "Personal" };

export type ProjectRole = "owner" | "editor" | "viewer";
export const ROLE_LABELS: Record<ProjectRole, string> = { owner: "Lead", editor: "Editor", viewer: "Member" };
export const ROLE_HELP: Record<ProjectRole, string> = {
  owner: "Everything, including roles and locked tasks",
  editor: "Plans, edits and assigns team tasks and milestones",
  viewer: "Reads the project and updates the tasks assigned to them",
};

export type TaskPermission = "team" | "assignee" | "owner";
export const PERMISSION_LABELS: Record<TaskPermission, string> = { team: "Team", assignee: "Assignee only", owner: "Locked" };
export const PERMISSION_HELP: Record<TaskPermission, string> = {
  team: "The lead, editors and the assignee can change it",
  assignee: "Only the assignee (and the lead) can change it",
  owner: "Only the lead can change it",
};

/** Document columns for lists (everything but the outline and TODO arrays). */
export const DOCUMENT_LIST_COLUMNS =
  "id, owner_id, project_id, path, title, ext, kind, language, size_bytes, modified_at, visibility, excerpt, checklist, line_count, redactions, truncated, error, indexed_at";

export interface ChecklistTotals {
  total: number;
  done: number;
  doing: number;
  attention: number;
  cut: number;
}

export function checklistOf(doc: Pick<ProjectDocument, "checklist">): ChecklistTotals | null {
  const c = doc.checklist as Partial<ChecklistTotals> | null;
  if (!c || typeof c.total !== "number" || !c.total) return null;
  return { total: c.total, done: c.done ?? 0, doing: c.doing ?? 0, attention: c.attention ?? 0, cut: c.cut ?? 0 };
}

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

export interface ProjectDeadline {
  title: string;
  /** ISO instant for tasks, end of day for milestones. */
  due: string;
  kind: "task" | "milestone";
  hard: boolean;
}

export interface ProjectSummary {
  project: Project;
  role: ProjectRole;
  members: number;
  progress: ProjectProgress;
  nextDeadline: ProjectDeadline | null;
  openTasks: number;
  myOpenTasks: number;
  overdue: number;
}

/**
 * Projects the user belongs to, with their role, progress, open work and the next deadline (tasks and
 * milestones). "own": projects they lead; "team": projects someone else leads. RLS decides visibility.
 */
export async function loadProjectSummaries(client: Client, userId: string, now: Date = new Date(), scope: "own" | "team" = "own"): Promise<ProjectSummary[]> {
  let query = client.from("projects").select("*").order("name");
  query = scope === "own" ? query.eq("owner_id", userId) : query.neq("owner_id", userId);
  const { data: projects } = await query;
  if (!projects?.length) return [];
  const ids = projects.map((p) => p.id);
  const [{ data: members }, { data: tasks }, { data: milestones }] = await Promise.all([
    client.from("project_members").select("project_id, user_id, role").in("project_id", ids),
    client
      .from("tasks")
      .select("title, status, due_at, project_id, assignee_id")
      .in("project_id", ids)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(3000),
    client.from("milestones").select("project_id, title, due_on, hard, done").in("project_id", ids).eq("done", false).order("due_on").limit(2000),
  ]);
  const today = now.toISOString().slice(0, 10);
  return projects.map((project) => {
    const list = (tasks ?? []).filter((t) => t.project_id === project.id);
    const open = list.filter((t) => isOpenStatus(t.status as TaskStatus));
    const nextTask = open.find((t) => t.due_at && new Date(t.due_at) >= now);
    const nextMilestone = (milestones ?? []).find((m) => m.project_id === project.id && m.due_on >= today);
    const candidates: ProjectDeadline[] = [];
    if (nextTask?.due_at) candidates.push({ title: nextTask.title, due: nextTask.due_at, kind: "task", hard: false });
    if (nextMilestone) candidates.push({ title: nextMilestone.title, due: `${nextMilestone.due_on}T23:59:00+07:00`, kind: "milestone", hard: nextMilestone.hard });
    candidates.sort((a, b) => a.due.localeCompare(b.due));
    const projectMembers = (members ?? []).filter((m) => m.project_id === project.id);
    return {
      project,
      role: (projectMembers.find((m) => m.user_id === userId)?.role ?? "viewer") as ProjectRole,
      members: projectMembers.length,
      progress: projectProgress(project, list),
      nextDeadline: candidates[0] ?? null,
      openTasks: open.length,
      myOpenTasks: open.filter((t) => t.assignee_id === userId).length,
      overdue: open.filter((t) => t.due_at && new Date(t.due_at) < now).length,
    };
  });
}

/** Names of the groups that run each project. */
export async function loadGroupLabels(client: Client, projectIds: string[]): Promise<Map<string, string[]>> {
  const labels = new Map<string, string[]>();
  if (!projectIds.length) return labels;
  const { data } = await client.from("project_groups").select("project_id, groups(name)").in("project_id", projectIds);
  for (const row of data ?? []) {
    const name = (row.groups as { name: string } | null)?.name;
    if (!name) continue;
    labels.set(row.project_id, [...(labels.get(row.project_id) ?? []), name]);
  }
  return labels;
}

export interface ProjectOption {
  id: string;
  name: string;
  color: string;
  status: string;
  owner_id: string;
  role: ProjectRole;
}

/** Projects the user belongs to, with their role (for pickers: only owners and editors add tasks). */
export async function loadProjectOptions(client: Client, userId: string): Promise<ProjectOption[]> {
  const { data } = await client
    .from("project_members")
    .select("role, projects!inner(id, name, color, status, owner_id)")
    .eq("user_id", userId);
  return (data ?? [])
    .map((row) => ({ ...row.projects, role: row.role as ProjectRole }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isActiveProject(status: string): boolean {
  return status === "active";
}

export interface RosterEntry {
  user_id: string;
  display_name: string;
  role: ProjectRole;
  via_group: string | null;
  shares_documents: boolean;
  joined_at: string;
}

export async function loadRoster(client: Client, projectId: string): Promise<RosterEntry[]> {
  const { data } = await client.rpc("project_roster", { p_project: projectId });
  return (data ?? []) as RosterEntry[];
}

/**
 * Mirrors the database rule (private.can_change_task) so the page only offers what will work:
 * the lead always; editors and the assignee for team tasks; only the assignee for assignee-only tasks.
 */
export function canChangeTask(role: ProjectRole | null, task: { permission: string; assignee_id: string | null }, userId: string): boolean {
  if (role === "owner") return true;
  if (task.permission === "team") return role === "editor" || task.assignee_id === userId;
  if (task.permission === "assignee") return task.assignee_id === userId;
  return false;
}

/** Whether the caller may change a task's title, deadline and assignee (not only its progress). */
export function canPlanTask(role: ProjectRole | null, task: { permission: string }): boolean {
  return role === "owner" || (role === "editor" && task.permission === "team");
}
