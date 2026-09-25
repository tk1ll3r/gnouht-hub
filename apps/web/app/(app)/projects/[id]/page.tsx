import { addDaysToKey, languageLabel, STATUS_LABELS, zonedDateKey, type CodeTodo, type TaskStatus } from "@hub/core";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  CircleDot,
  FileText,
  FolderSync,
  FolderTree,
  ListPlus,
  Lock,
  LogOut,
  Scissors,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AiAnswer } from "@/components/ai-answer";
import { JobWatcher, SummarizeButton } from "@/components/ai-forms";
import { ProgressHistoryChart } from "@/components/charts";
import { FileIcon } from "@/components/file-icon";
import { InlineAction, SelectAction } from "@/components/forms";
import { MilestoneForm, ProjectForm, TeamTaskForm } from "@/components/project-forms";
import { TaskControls } from "@/components/task-forms";
import { Badge, ButtonLink, Card, CardBody, CardHeader, ColorDot, EmptyState, Kbd, Meta, ProgressBar } from "@/components/ui";
import { TodoTag } from "@/components/workspace";
import { loadAiStatus } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { loadWorkspace } from "@/lib/data";
import { formatDue, relativeTime } from "@/lib/format";
import {
  canChangeTask,
  canPlanTask,
  checklistOf,
  DOCUMENT_LIST_COLUMNS,
  loadRoster,
  PERMISSION_HELP,
  PERMISSION_LABELS,
  PROJECT_KIND_LABELS,
  projectProgress,
  ROLE_HELP,
  ROLE_LABELS,
  type ChecklistItemRow,
  type ProjectDocument,
  type ProjectKind,
  type ProjectRole,
  type TaskPermission,
} from "@/lib/projects";
import { cn } from "@/lib/utils";
import { uuid } from "@/lib/validation";
import {
  addMember,
  assignTask,
  deleteMilestone,
  deleteProject,
  linkGroup,
  removeMember,
  setFileSharing,
  setMemberRole,
  setTaskPermission,
  todoToTask,
  toggleMilestone,
  unlinkGroup,
} from "../actions";

export const metadata: Metadata = { title: "Project" };

const STATUS_ICON: Record<string, { icon: typeof Circle; className: string }> = {
  todo: { icon: Circle, className: "text-muted" },
  doing: { icon: CircleDot, className: "text-accent" },
  attention: { icon: AlertTriangle, className: "text-warn" },
  done: { icon: CheckCircle2, className: "text-ok" },
  cut: { icon: Scissors, className: "text-muted" },
};

function ItemRow({ item, showSection = false }: { item: ChecklistItemRow; showSection?: boolean }) {
  const { icon: Icon, className } = STATUS_ICON[item.status] ?? STATUS_ICON.todo!;
  const indent = Math.min(Math.floor(item.indent / 2), 4);
  return (
    <li className={cn("flex items-start gap-2 py-1 text-[13px]", ["", "pl-4", "pl-8", "pl-12", "pl-16"][indent])}>
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", className)} aria-label={STATUS_LABELS[item.status as TaskStatus]} />
      <span className={cn("min-w-0", item.status === "done" && "text-muted", item.status === "cut" && "text-muted line-through")}>
        {item.text}
        {showSection && item.section ? <span className="ml-2 text-[12px] text-muted">{item.section}</span> : null}
      </span>
    </li>
  );
}

function DocumentChecklist({ doc, items }: { doc: ProjectDocument; items: ChecklistItemRow[] }) {
  const totals = checklistOf(doc);
  const sections: { name: string | null; items: ChecklistItemRow[] }[] = [];
  for (const item of items) {
    const last = sections.at(-1);
    if (last && last.name === item.section) last.items.push(item);
    else sections.push({ name: item.section, items: [item] });
  }
  const countable = totals ? totals.total - totals.cut : 0;
  return (
    <details className="group border-t border-border first:border-t-0" open={items.length <= 60}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
        <FileText className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{doc.title}</span>
        <span className="w-24 shrink-0">
          <ProgressBar value={countable ? (totals?.done ?? 0) / countable : 0} tone="ok" label={`${doc.title} progress`} />
        </span>
        <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-muted">
          {totals?.done ?? 0}/{countable}
        </span>
      </summary>
      <div className="px-4 pb-3">
        {sections.map((section, index) => (
          <div key={`${section.name}-${index}`} className="mt-2">
            {section.name ? <p className="mb-0.5 text-[12px] font-medium text-muted">{section.name}</p> : null}
            <ul>
              {section.items.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

const ROLE_TONE: Record<ProjectRole, "accent" | "neutral" | "ok"> = { owner: "accent", editor: "ok", viewer: "neutral" };

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  if (!uuid.safeParse(id).success) notFound();
  const { user, supabase } = await requireUser();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project) notFound();

  const tz = (await loadWorkspace(supabase, user.id)).options.tz;
  const now = new Date();
  const since = addDaysToKey(zonedDateKey(now, tz), -90);
  const [ws, roster, ai, summariesRes, tasksRes, milestonesRes, docsRes, historyRes, activityRes, linksRes, myGroupsRes, todosRes] = await Promise.all([
    loadWorkspace(supabase, user.id),
    loadRoster(supabase, id),
    loadAiStatus(supabase, user.id),
    supabase
      .from("ai_jobs")
      .select("id, status, output, finished_at, created_at")
      .eq("subject_id", id)
      .eq("kind", "project_summary")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("tasks").select("*").eq("project_id", id).order("due_at", { ascending: true, nullsFirst: false }).limit(500),
    supabase.from("milestones").select("*").eq("project_id", id).order("due_on").limit(500),
    supabase.from("documents").select(DOCUMENT_LIST_COLUMNS).eq("project_id", id).order("path").limit(1000),
    supabase.from("project_progress_daily").select("day, done, total, cut").eq("project_id", id).gte("day", since).order("day"),
    supabase.from("activity").select("id, actor_id, verb, subject, at").eq("project_id", id).order("at", { ascending: false }).limit(25),
    supabase.from("project_groups").select("group_id, default_role, groups(name, course_code)").eq("project_id", id),
    supabase.from("group_members").select("group_id, groups(name)").eq("user_id", user.id),
    supabase.from("documents").select("id, path, todos").eq("project_id", id).eq("kind", "code").neq("todos", "[]").limit(1000),
  ]);
  const me = roster.find((m) => m.user_id === user.id);
  const role: ProjectRole | null = me?.role ?? null;
  const isOwner = role === "owner";
  const canPlan = role === "owner" || role === "editor";
  const names = new Map(roster.map((m) => [m.user_id, m.display_name]));
  const tasks = tasksRes.data ?? [];
  const milestones = milestonesRes.data ?? [];
  const docs = (docsRes.data ?? []) as ProjectDocument[];
  const history = historyRes.data ?? [];
  const activity = activityRes.data ?? [];
  const links = linksRes.data ?? [];
  const summaries = summariesRes.data ?? [];
  const pendingSummary = summaries.find((j) => j.status === "queued" || j.status === "running");
  const lastSummary = summaries.find((j) => j.status === "done" && j.output);

  // Checklist items of the files the caller can read (their own, and files members shared).
  const { data: itemRows } = docs.length
    ? await supabase.from("checklist_items").select("*").in("document_id", docs.map((d) => d.id)).order("ord").limit(5000)
    : { data: [] as ChecklistItemRow[] };
  const items = itemRows ?? [];
  const itemsByDoc = new Map<string, ChecklistItemRow[]>();
  for (const item of items) itemsByDoc.set(item.document_id, [...(itemsByDoc.get(item.document_id) ?? []), item]);

  // People the lead can add: members of the lead's groups who are not in the project yet.
  const myGroups = (myGroupsRes.data ?? []).map((g) => ({ id: g.group_id, name: (g.groups as { name: string } | null)?.name ?? "Group" }));
  let candidates: { user_id: string; display_name: string }[] = [];
  if (isOwner && myGroups.length) {
    const rosters = await Promise.all(myGroups.map((g) => supabase.rpc("group_roster", { p_group: g.id })));
    const seen = new Set(roster.map((m) => m.user_id));
    for (const r of rosters) {
      for (const m of r.data ?? []) {
        if (seen.has(m.user_id)) continue;
        seen.add(m.user_id);
        candidates.push({ user_id: m.user_id, display_name: m.display_name });
      }
    }
    candidates = candidates.sort((a, b) => a.display_name.localeCompare(b.display_name));
  }

  const progress = projectProgress(project, tasks);
  const mineOnly = query.mine === "1";
  const openTasks = tasks.filter((t) => t.status !== "done" && t.status !== "cut" && (!mineOnly || t.assignee_id === user.id));
  const closedTasks = tasks.filter((t) => t.status === "done" || t.status === "cut");
  const myOpen = tasks.filter((t) => t.assignee_id === user.id && t.status !== "done" && t.status !== "cut").length;
  const today = zonedDateKey(now, tz);
  const openMilestones = milestones.filter((m) => !m.done);
  const doneMilestones = milestones.filter((m) => m.done);
  const attention = items.filter((i) => i.status === "attention");
  const doing = items.filter((i) => i.status === "doing");
  const recentCutoff = now.getTime() - 14 * 86_400_000;
  const recentlyDone = items
    .filter((i) => i.status === "done" && new Date(i.status_changed_at).getTime() > recentCutoff)
    .filter((i) => new Date(i.status_changed_at).getTime() - new Date(i.first_seen_at).getTime() > 60_000)
    .sort((a, b) => b.status_changed_at.localeCompare(a.status_changed_at))
    .slice(0, 12);
  const course = project.course_id ? ws.courses.find((c) => c.id === project.course_id) : null;
  const courses = ws.courses.map((c) => ({ id: c.id, code: c.code, name: c.name }));
  const myDocs = docs.filter((d) => d.owner_id === user.id);
  const firstFile = docs.find((d) => /^readme\.(md|markdown|txt)$/i.test(d.path)) ?? docs.find((d) => d.kind === "code") ?? docs[0];
  const linesByLanguage = new Map<string, number>();
  for (const d of docs) if (d.kind === "code") linesByLanguage.set(d.language ?? "other", (linesByLanguage.get(d.language ?? "other") ?? 0) + d.line_count);
  const codeLines = [...linesByLanguage.values()].reduce((a, b) => a + b, 0);
  const languages = [...linesByLanguage].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const severity = (tag: string) => (tag === "FIXME" || tag === "BUG" ? 0 : 1);
  const problems = (todosRes.data ?? [])
    .flatMap((d) => (Array.isArray(d.todos) ? (d.todos as unknown as CodeTodo[]) : []).map((t) => ({ ...t, docId: d.id, path: d.path })))
    .sort((a, b) => severity(a.tag) - severity(b.tag) || a.path.localeCompare(b.path) || a.line - b.line);
  const memberOptions = roster.map((m) => ({ user_id: m.user_id, display_name: m.display_name }));
  const assigneeOptions = [{ value: "", label: "Unassigned" }, ...memberOptions.map((m) => ({ value: m.user_id, label: m.display_name }))];

  const stats = [
    { label: "Progress", value: progress.basis === "none" ? "—" : `${Math.round(progress.ratio * 100)}%` },
    { label: progress.basis === "tasks" ? "Tasks done" : "Items done", value: progress.basis === "none" ? "—" : `${progress.done}/${progress.countable}` },
    { label: "Assigned to me", value: String(myOpen), tone: myOpen ? "text-accent" : undefined },
    { label: "Open tasks", value: String(tasks.filter((t) => t.status !== "done" && t.status !== "cut").length) },
  ];

  return (
    <>
      <Link href="/projects" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-3.5" /> Projects
      </Link>
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <ColorDot color={project.color} size={12} />
          <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
          <Badge>{PROJECT_KIND_LABELS[project.kind as ProjectKind] ?? project.kind}</Badge>
          {project.status !== "active" ? <Badge>{project.status}</Badge> : null}
          {role ? <Badge tone={ROLE_TONE[role]}>You: {ROLE_LABELS[role]}</Badge> : null}
          {course ? (
            <Link href={`/courses/${course.id}`}>
              <Badge tone="accent">{course.code}</Badge>
            </Link>
          ) : null}
        </div>
        {project.description ? <p className="mt-1 max-w-3xl text-sm text-muted">{project.description}</p> : null}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-muted">
          {links.length ? (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" /> run by {links.map((l) => (l.groups as { name: string } | null)?.name).filter(Boolean).join(", ")}
            </span>
          ) : null}
          {project.folder_label ? (
            <span className="inline-flex items-center gap-1">
              <FolderSync className="size-3" /> {project.folder_label}
            </span>
          ) : null}
          {project.last_synced_at ? <span>synced {relativeTime(project.last_synced_at, now)}</span> : null}
          {project.due_on ? <span>final deadline {project.due_on}</span> : null}
        </p>
        {firstFile ? (
          <ButtonLink href={`/projects/${project.id}/docs/${firstFile.id}`} size="sm" className="mt-3">
            <FolderTree className="size-3.5" /> Open files
          </ButtonLink>
        ) : null}
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardBody className="py-3">
              <p className="text-[12px] text-muted">{s.label}</p>
              <p className={cn("text-lg font-semibold tabular-nums", s.tone)}>{s.value}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          <Card id="tasks" className="scroll-mt-6">
            <CardHeader
              title="Tasks"
              description={canPlan ? "Assign work and decide who may change each task." : "The team's tasks. You can update the ones assigned to you."}
              actions={
                <div className="flex gap-1 text-[12.5px]">
                  <Link href={`/projects/${project.id}`} className={cn("rounded-md px-2 py-1", !mineOnly ? "bg-surface-2 font-medium" : "text-muted hover:text-text")}>
                    All
                  </Link>
                  <Link href={`/projects/${project.id}?mine=1`} className={cn("rounded-md px-2 py-1", mineOnly ? "bg-surface-2 font-medium" : "text-muted hover:text-text")}>
                    Mine ({myOpen})
                  </Link>
                </div>
              }
            />
            {openTasks.length ? (
              <ul className="divide-y divide-border">
                {openTasks.map((task) => {
                  const overdue = task.due_at ? new Date(task.due_at) < now : false;
                  const permission = task.permission as TaskPermission;
                  const mine = task.assignee_id === user.id;
                  const changeable = canChangeTask(role, task, user.id);
                  const plannable = canPlanTask(role, task);
                  return (
                    <li key={task.id} className={cn("flex flex-col gap-2 px-4 py-3", mine && "bg-accent-soft/40")}>
                      <div className="flex flex-wrap items-center gap-2">
                        {overdue ? <Badge tone="danger">Overdue</Badge> : null}
                        <span className="font-medium">{task.title}</span>
                        {permission !== "team" ? (
                          <Badge tone="warn" title={PERMISSION_HELP[permission]}>
                            <Lock className="size-3" /> {PERMISSION_LABELS[permission]}
                          </Badge>
                        ) : null}
                      </div>
                      <Meta
                        className="text-[12.5px] text-muted"
                        items={[
                          <span key="a" className="inline-flex items-center gap-1">
                            <UserRound className="size-3" />
                            {task.assignee_id ? (mine ? "You" : (names.get(task.assignee_id) ?? "A former member")) : "Unassigned"}
                          </span>,
                          task.due_at ? formatDue(task.due_at, tz, now) : "No deadline",
                          task.notes?.startsWith("TODO in ") || task.notes?.startsWith("FIXME in ") ? task.notes : null,
                        ]}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        {changeable ? (
                          <TaskControls id={task.id} status={task.status} progress={Number(task.progress)} estimate={task.estimate_hours} />
                        ) : task.status !== "todo" ? (
                          <Badge className="w-fit">{STATUS_LABELS[task.status as TaskStatus]}</Badge>
                        ) : null}
                        {plannable ? (
                          <SelectAction action={assignTask} fields={{ id: task.id }} name="assignee_id" value={task.assignee_id ?? ""} options={assigneeOptions} label={`Assignee of ${task.title}`} />
                        ) : null}
                        {isOwner ? (
                          <SelectAction
                            action={setTaskPermission}
                            fields={{ id: task.id }}
                            name="permission"
                            value={permission}
                            options={(["team", "assignee", "owner"] as const).map((p) => ({ value: p, label: PERMISSION_LABELS[p] }))}
                            label={`Who can change ${task.title}`}
                          />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title={mineOnly ? "Nothing assigned to you" : "No open tasks"}>
                {canPlan ? "Add one below and assign it to someone." : "When the lead assigns you something, it shows up here and on your Today page."}
              </EmptyState>
            )}
            {canPlan ? (
              <div className="border-t border-border px-4 py-4">
                <TeamTaskForm projectId={project.id} members={memberOptions} canRestrict={isOwner} />
              </div>
            ) : null}
            {closedTasks.length ? (
              <details className="border-t border-border">
                <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-muted hover:text-text">{closedTasks.length} done or cut</summary>
                <ul className="divide-y divide-border">
                  {closedTasks.map((task) => (
                    <li key={task.id} className="flex justify-between gap-3 px-4 py-2 text-[13px] text-muted">
                      <span className={cn(task.status === "cut" && "line-through")}>
                        {task.title}
                        {task.assignee_id ? <span className="ml-2 text-[12px]">{names.get(task.assignee_id) ?? ""}</span> : null}
                      </span>
                      <span className="shrink-0">{task.due_at ? formatDue(task.due_at, tz, now) : ""}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>

          <Card id="milestones" className="scroll-mt-6">
            <CardHeader title="Milestones" description="Project dates everyone works towards: added here, or from dated items in shared files." />
            {openMilestones.length ? (
              <ul className="divide-y divide-border">
                {openMilestones.map((m) => {
                  const ref = (m.source_ref ?? {}) as { path?: string; line?: number };
                  const late = m.due_on < today;
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13.5px]">
                      {late ? <Badge tone="danger">Late</Badge> : null}
                      {m.hard ? <Badge tone="warn">hard</Badge> : null}
                      <span className="min-w-0 flex-1 font-medium">{m.title}</span>
                      <span className="text-[12.5px] text-muted">
                        {m.due_on}
                        {ref.path ? `, ${ref.path}${ref.line ? `:${ref.line}` : ""}` : ""}
                      </span>
                      {canPlan ? (
                        <InlineAction action={toggleMilestone} fields={{ id: m.id, done: "true" }} title="Mark done">
                          <CheckCircle2 className="size-3.5" />
                          <span className="sr-only">Mark {m.title} done</span>
                        </InlineAction>
                      ) : null}
                      {canPlan && m.source === "manual" ? (
                        <InlineAction action={deleteMilestone} fields={{ id: m.id }} confirm="Delete this milestone?" title="Delete">
                          <Trash2 className="size-3.5" />
                          <span className="sr-only">Delete {m.title}</span>
                        </InlineAction>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No upcoming milestones">
                Add one below, or share a file with a table that has a “Hạn” column or items like “- [ ] Nộp báo cáo 📅 2026-10-05”.
              </EmptyState>
            )}
            {canPlan ? (
              <div className="border-t border-border px-4 py-3">
                <MilestoneForm projectId={project.id} />
              </div>
            ) : null}
            {doneMilestones.length ? (
              <details className="border-t border-border">
                <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-muted hover:text-text">{doneMilestones.length} reached</summary>
                <ul className="divide-y divide-border">
                  {doneMilestones.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px] text-muted">
                      <span>{m.title}</span>
                      <span className="flex items-center gap-2">
                        {m.due_on}
                        {canPlan && m.source === "manual" ? (
                          <InlineAction action={toggleMilestone} fields={{ id: m.id, done: "false" }} title="Reopen">
                            <Circle className="size-3.5" />
                            <span className="sr-only">Reopen {m.title}</span>
                          </InlineAction>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>

          {attention.length || doing.length ? (
            <Card>
              <CardHeader title="In flight" description="Items marked [!] (needs attention) and [~] (in progress) in the files you can read." />
              <CardBody>
                <ul>
                  {[...attention, ...doing].slice(0, 40).map((item) => (
                    <ItemRow key={item.id} item={{ ...item, indent: 0 }} showSection />
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Checklists" description="Read-only: edit the files on your PC and the agent re-syncs within minutes." />
            {docs.some((d) => checklistOf(d)) ? (
              <div>
                {docs
                  .filter((d) => checklistOf(d))
                  .map((doc) => (
                    <DocumentChecklist key={doc.id} doc={doc} items={itemsByDoc.get(doc.id) ?? []} />
                  ))}
              </div>
            ) : (
              <EmptyState title="No checklist items">Files with “- [ ]” items show their progress here once they sync.</EmptyState>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Team"
              description={`${roster.length} member${roster.length === 1 ? "" : "s"}`}
              actions={
                role && !isOwner ? (
                  <InlineAction action={removeMember} fields={{ project_id: project.id, user_id: user.id }} confirm="Leave this project? Your tasks become unassigned." title="Leave">
                    <LogOut className="size-3.5" /> Leave
                  </InlineAction>
                ) : null
              }
            />
            <ul className="divide-y divide-border">
              {roster.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[13.5px]">
                  <span className="min-w-0 flex-1 truncate">
                    {m.display_name}
                    {m.user_id === user.id ? <span className="text-muted"> (you)</span> : null}
                  </span>
                  {isOwner && m.role !== "owner" ? (
                    <>
                      <SelectAction
                        action={setMemberRole}
                        fields={{ project_id: project.id, user_id: m.user_id }}
                        name="role"
                        value={m.role}
                        options={[
                          { value: "editor", label: ROLE_LABELS.editor },
                          { value: "viewer", label: ROLE_LABELS.viewer },
                        ]}
                        label={`Role of ${m.display_name}`}
                      />
                      <InlineAction action={removeMember} fields={{ project_id: project.id, user_id: m.user_id }} confirm={`Remove ${m.display_name}?`} title="Remove">
                        <Trash2 className="size-3.5" />
                        <span className="sr-only">Remove {m.display_name}</span>
                      </InlineAction>
                    </>
                  ) : (
                    <Badge tone={ROLE_TONE[m.role]} title={ROLE_HELP[m.role]}>
                      {ROLE_LABELS[m.role]}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
            {isOwner ? (
              <CardBody className="flex flex-col gap-3 border-t border-border text-[13px]">
                {links.map((l) => (
                  <p key={l.group_id} className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="size-3.5 text-muted" /> {(l.groups as { name: string } | null)?.name}
                      <span className="text-muted">joins as {ROLE_LABELS[l.default_role as ProjectRole].toLowerCase()}</span>
                    </span>
                    <InlineAction action={unlinkGroup} fields={{ project_id: project.id, group_id: l.group_id }} confirm="Remove the group? Members who came with it leave the project." title="Remove group">
                      <Trash2 className="size-3.5" />
                      <span className="sr-only">Remove the group</span>
                    </InlineAction>
                  </p>
                ))}
                {myGroups.filter((g) => !links.some((l) => l.group_id === g.id)).length ? (
                  <form action={linkGroup} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="project_id" value={project.id} />
                    <label htmlFor="link-group" className="sr-only">
                      Group
                    </label>
                    <select id="link-group" name="group_id" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-[13px]">
                      {myGroups
                        .filter((g) => !links.some((l) => l.group_id === g.id))
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </select>
                    <label htmlFor="link-role" className="sr-only">
                      Role for its members
                    </label>
                    <select id="link-role" name="role" defaultValue="viewer" className="h-8 rounded-md border border-border bg-surface px-2 text-[13px]">
                      <option value="viewer">as members</option>
                      <option value="editor">as editors</option>
                    </select>
                    <button className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg">Add group</button>
                  </form>
                ) : null}
                {candidates.length ? (
                  <form action={addMember} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="project_id" value={project.id} />
                    <input type="hidden" name="role" value="viewer" />
                    <label htmlFor="add-member" className="sr-only">
                      Person
                    </label>
                    <select id="add-member" name="user_id" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-[13px]">
                      {candidates.map((c) => (
                        <option key={c.user_id} value={c.user_id}>
                          {c.display_name}
                        </option>
                      ))}
                    </select>
                    <button className="h-8 rounded-md border border-border px-3 text-[13px] hover:border-accent/40 hover:text-accent">Add person</button>
                  </form>
                ) : !myGroups.length ? (
                  <p className="text-muted">
                    Create a <Link href="/groups" className="text-accent hover:underline">study group</Link> for this course, then add it here: everyone in it joins the project.
                  </p>
                ) : null}
              </CardBody>
            ) : null}
          </Card>

          {role ? (
            <Card>
              <CardHeader title="Your files" description="Files your PC synced into this project, and whether the team can read them." />
              <CardBody className="flex flex-col gap-2 text-[13px]">
                <p>
                  {myDocs.length
                    ? `${myDocs.length} file${myDocs.length === 1 ? "" : "s"}, ${me?.shares_documents ? "shared with the team" : "private to you"}.`
                    : "None yet."}
                </p>
                <form action={setFileSharing}>
                  <input type="hidden" name="project_id" value={project.id} />
                  <input type="hidden" name="share" value={me?.shares_documents ? "false" : "true"} />
                  <button className="text-accent hover:underline">{me?.shares_documents ? "Make my files private" : "Share my files with the team"}</button>
                </form>
                <p className="text-[12px] text-muted">
                  Link a folder on your PC: <Kbd>hub-agent project add &lt;folder&gt; --project {project.id}</Kbd>
                </p>
              </CardBody>
            </Card>
          ) : null}

          {ai.enabled ? (
            <Card>
              <CardHeader
                title="AI summary"
                description={lastSummary?.finished_at ? `Written ${relativeTime(lastSummary.finished_at, now)} from the checklists, tasks and milestones.` : "Status, risks and next steps, from the checklists, tasks and milestones."}
                actions={pendingSummary ? null : <SummarizeButton projectId={project.id} label={lastSummary ? "Update" : "Summarize"} />}
              />
              <CardBody>
                {pendingSummary ? (
                  <div className="text-[13.5px] text-muted">
                    {pendingSummary.status === "queued" ? "Waiting for the agent on your PC…" : "Your PC is writing the summary…"}
                    <JobWatcher jobId={pendingSummary.id} />
                  </div>
                ) : null}
                {lastSummary?.output ? <AiAnswer output={lastSummary.output} className="text-[14px]" /> : !pendingSummary ? <p className="text-[13.5px] text-muted">No summary yet.</p> : null}
              </CardBody>
            </Card>
          ) : null}

          {activity.length ? (
            <Card>
              <CardHeader title="Activity" />
              <ul className="divide-y divide-border">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-3 px-4 py-2 text-[13px]">
                    <span className="min-w-0">
                      <span className="font-medium">{a.actor_id ? (a.actor_id === user.id ? "You" : (names.get(a.actor_id) ?? "Someone")) : "The hub"}</span> {a.verb}
                      {a.subject ? <span className="text-muted">: {a.subject}</span> : null}
                    </span>
                    <span className="shrink-0 text-[12px] text-muted">{relativeTime(a.at, now)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {history.length ? (
            <Card>
              <CardHeader title="Progress over time" description="Shared checklists at each day’s last sync." />
              <CardBody>
                <ProgressHistoryChart points={history} />
              </CardBody>
            </Card>
          ) : null}

          {recentlyDone.length ? (
            <Card>
              <CardHeader title="Recently completed" description="Ticked off in the last 14 days." />
              <CardBody>
                <ul>
                  {recentlyDone.map((item) => (
                    <li key={item.id} className="flex items-start justify-between gap-3 py-1 text-[13px]">
                      <span className="flex min-w-0 items-start gap-2">
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" />
                        {item.text}
                      </span>
                      <span className="shrink-0 text-[12px] text-muted">{relativeTime(item.status_changed_at, now)}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          {codeLines ? (
            <Card>
              <CardHeader title="Languages" description={`${codeLines.toLocaleString("en")} lines of source`} />
              <CardBody className="flex flex-col gap-2">
                {languages.map(([language, lines]) => (
                  <div key={language} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 text-[13px]">
                    <span className="truncate">{languageLabel(language === "other" ? null : language)}</span>
                    <ProgressBar value={lines / codeLines} label={`${languageLabel(language)} share`} />
                    <span className="text-right text-[12px] tabular-nums text-muted">{Math.round((lines / codeLines) * 100)}%</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}

          {problems.length ? (
            <Card>
              <CardHeader title="Problems" description={`${problems.length} TODO/FIXME comment(s) in the source.${canPlan ? " Make one a task to schedule it." : ""}`} />
              <ul className="max-h-96 divide-y divide-border overflow-y-auto">
                {problems.slice(0, 100).map((t) => (
                  <li key={`${t.docId}-${t.line}`} className="flex items-start gap-2 px-4 py-2 text-[13px]">
                    <TodoTag tag={t.tag} />
                    <Link href={`/projects/${project.id}/docs/${t.docId}#L${t.line}`} className="min-w-0 flex-1 hover:text-accent">
                      <span className="block">{t.text}</span>
                      <span className="block truncate text-[12px] text-muted">
                        {t.path}:{t.line}
                      </span>
                    </Link>
                    {canPlan ? (
                      <InlineAction action={todoToTask} fields={{ document_id: t.docId, line: String(t.line) }} title="Make this a task">
                        <ListPlus className="size-3.5" />
                        <span className="sr-only">Make this a task</span>
                      </InlineAction>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Files" description={docs.length ? `${docs.length} you can read` : undefined} />
            {docs.length ? (
              <ul className="divide-y divide-border">
                {docs.map((doc) => {
                  const totals = checklistOf(doc);
                  return (
                    <li key={doc.id}>
                      <Link href={`/projects/${project.id}/docs/${doc.id}`} className="flex flex-col gap-0.5 px-4 py-2.5 hover:bg-surface-2/60">
                        <span className="flex items-center gap-2 text-sm">
                          <FileIcon kind={doc.kind} language={doc.language} />
                          <span className="min-w-0 flex-1 truncate font-medium">{doc.title}</span>
                          <Badge>{doc.kind === "code" ? languageLabel(doc.language) : doc.kind}</Badge>
                        </span>
                        <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                          <span className="truncate">{doc.path}</span>
                          {doc.owner_id !== user.id ? <span>from {names.get(doc.owner_id) ?? "a member"}</span> : doc.visibility === "private" ? <span>private</span> : null}
                          {totals ? <span>{totals.done}/{totals.total - totals.cut} items</span> : null}
                          {doc.redactions ? <span className="text-warn">{doc.redactions} secret(s) redacted</span> : null}
                          {doc.truncated ? <span className="text-warn">truncated</span> : null}
                          {doc.error ? <span className="text-danger">{doc.error}</span> : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No files">
                {project.folder_key ? "The agent has not uploaded any file yet." : "Link a folder with the agent, or let a member share theirs."}
              </EmptyState>
            )}
          </Card>

          {canPlan ? (
            <Card>
              <CardHeader
                title="Settings"
                actions={
                  isOwner ? (
                    <InlineAction action={deleteProject} fields={{ id: project.id }} confirm="Delete the project with its tasks and milestones?" variant="danger">
                      <Trash2 className="size-3.5" /> Delete
                    </InlineAction>
                  ) : null
                }
              />
              <CardBody>
                <ProjectForm
                  project={{
                    id: project.id,
                    name: project.name,
                    slug: project.slug,
                    kind: project.kind,
                    description: project.description,
                    color: project.color,
                    course_id: project.course_id,
                    status: project.status,
                    due_on: project.due_on,
                  }}
                  courses={courses}
                />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
