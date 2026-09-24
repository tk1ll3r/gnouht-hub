import { addDaysToKey, STATUS_LABELS, zonedDateKey, type TaskStatus } from "@hub/core";
import { AlertTriangle, ArrowLeft, CheckCircle2, Circle, CircleDot, FileText, FolderSync, Scissors, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgressHistoryChart } from "@/components/charts";
import { InlineAction } from "@/components/forms";
import { ProjectForm } from "@/components/project-forms";
import { TaskControls } from "@/components/task-forms";
import { Badge, Card, CardBody, CardHeader, ColorDot, EmptyState, ProgressBar } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadWorkspace } from "@/lib/data";
import { formatDue, relativeTime } from "@/lib/format";
import { DOCUMENT_LIST_COLUMNS, loadShareLabels, projectProgress, type ChecklistItemRow, type ProjectDocument } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { uuid } from "@/lib/validation";
import { deleteProject } from "../actions";

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
        {showSection && item.section ? <span className="ml-1.5 text-[12px] text-muted">· {item.section}</span> : null}
      </span>
    </li>
  );
}

function DocumentChecklist({ doc, items }: { doc: ProjectDocument; items: ChecklistItemRow[] }) {
  const sections: { name: string | null; items: ChecklistItemRow[] }[] = [];
  for (const item of items) {
    const last = sections.at(-1);
    if (last && last.name === item.section) last.items.push(item);
    else sections.push({ name: item.section, items: [item] });
  }
  const countable = doc.items_total - doc.items_cut;
  return (
    <details className="group border-t border-border first:border-t-0" open={items.length <= 60}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
        <FileText className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{doc.title}</span>
        <span className="w-24 shrink-0">
          <ProgressBar value={countable ? doc.items_done / countable : 0} tone="ok" label={`${doc.title} progress`} />
        </span>
        <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-muted">
          {doc.items_done}/{countable}
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

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { user, supabase } = await requireUser();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project) notFound();

  // Group members can open projects shared with them (RLS); they get a read-only view.
  const isOwner = project.user_id === user.id;
  const [ws, shareLabels] = await Promise.all([loadWorkspace(supabase, user.id), isOwner ? null : loadShareLabels(supabase, [project.id])]);
  const tz = ws.options.tz;
  const now = new Date();
  const since = addDaysToKey(zonedDateKey(now, tz), -90);
  const [docsRes, itemsRes, tasksRes, historyRes] = await Promise.all([
    supabase.from("project_documents").select(DOCUMENT_LIST_COLUMNS).eq("project_id", id).order("path"),
    supabase.from("checklist_items").select("*").eq("project_id", id).order("ord").limit(5000),
    supabase.from("tasks").select("*").eq("project_id", id).order("due_at", { ascending: true, nullsFirst: false }).limit(500),
    supabase.from("project_progress_daily").select("day, done, total, cut").eq("project_id", id).gte("day", since).order("day"),
  ]);
  const docs = docsRes.data ?? [];
  const items = itemsRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const history = historyRes.data ?? [];

  const progress = projectProgress(project, tasks);
  const openTasks = tasks.filter((t) => t.status !== "done" && t.status !== "cut");
  const closedTasks = tasks.filter((t) => t.status === "done" || t.status === "cut");
  const itemsByDoc = new Map<string, ChecklistItemRow[]>();
  for (const item of items) {
    const list = itemsByDoc.get(item.document_id) ?? [];
    list.push(item);
    itemsByDoc.set(item.document_id, list);
  }
  const attention = items.filter((i) => i.status === "attention");
  const doing = items.filter((i) => i.status === "doing");
  // "Recently done": changed to done in the last 14 days, not merely seen as done at first indexing.
  const recentCutoff = now.getTime() - 14 * 86_400_000;
  const recentlyDone = items
    .filter((i) => i.status === "done" && new Date(i.status_changed_at).getTime() > recentCutoff)
    .filter((i) => new Date(i.status_changed_at).getTime() - new Date(i.first_seen_at).getTime() > 60_000)
    .sort((a, b) => b.status_changed_at.localeCompare(a.status_changed_at))
    .slice(0, 12);
  const course = project.course_id ? ws.courses.find((c) => c.id === project.course_id) : null;
  const courses = ws.courses.map((c) => ({ id: c.id, code: c.code, name: c.name }));

  const stats = [
    { label: "Progress", value: progress.basis === "none" ? "—" : `${Math.round(progress.ratio * 100)}%` },
    { label: progress.basis === "tasks" ? "Tasks done" : "Items done", value: progress.basis === "none" ? "—" : `${progress.done}/${progress.countable}` },
    { label: "Needs attention", value: String(project.items_attention), tone: project.items_attention ? "text-warn" : undefined },
    { label: "Open deadlines", value: String(openTasks.length) },
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
          {project.status !== "active" ? <Badge>{project.status}</Badge> : null}
          {!isOwner ? <Badge tone="accent">shared via {shareLabels?.get(project.id)?.join(", ") ?? "a group"} · read-only</Badge> : null}
          {course ? (
            <Link href={`/courses/${course.id}`}>
              <Badge tone="accent">{course.code}</Badge>
            </Link>
          ) : null}
        </div>
        {project.description ? <p className="mt-1 max-w-3xl text-sm text-muted">{project.description}</p> : null}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-muted">
          {project.folder_label ? (
            <span className="inline-flex items-center gap-1">
              <FolderSync className="size-3" /> {project.folder_label}
            </span>
          ) : null}
          {project.last_synced_at ? <span>synced {relativeTime(project.last_synced_at, now)}</span> : null}
          {project.due_on ? <span>final deadline {project.due_on}</span> : null}
        </p>
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
          <Card>
            <CardHeader title="Deadlines" description="Milestone tables and dated checklist items from the documents, plus tasks you linked." />
            {openTasks.length ? (
              <ul className="divide-y divide-border">
                {openTasks.map((task) => {
                  const ref = (task.source_ref ?? {}) as { path?: string; line?: number; hard?: boolean };
                  const overdue = task.due_at ? new Date(task.due_at) < now : false;
                  return (
                    <li key={task.id} className="flex flex-col gap-2 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {overdue ? <Badge tone="danger">Overdue</Badge> : null}
                        {ref.hard ? <Badge tone="warn">hard deadline</Badge> : null}
                        <span className="font-medium">{task.title}</span>
                      </div>
                      <p className="text-[12px] text-muted">
                        {task.due_at ? formatDue(task.due_at, tz, now) : "No deadline"}
                        {ref.path ? ` · ${ref.path}${ref.line ? `:${ref.line}` : ""}` : ""}
                      </p>
                      {isOwner ? (
                        <TaskControls id={task.id} status={task.status} progress={Number(task.progress)} estimate={task.estimate_hours} />
                      ) : task.status !== "todo" ? (
                        <Badge className="w-fit">{STATUS_LABELS[task.status as TaskStatus]}</Badge>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No open deadlines">Add a table with a “Hạn” column, or items like “- [ ] Nộp báo cáo 📅 2026-10-05”.</EmptyState>
            )}
            {closedTasks.length ? (
              <details className="border-t border-border">
                <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-muted hover:text-text">{closedTasks.length} done or cut</summary>
                <ul className="divide-y divide-border">
                  {closedTasks.map((task) => (
                    <li key={task.id} className="flex justify-between gap-3 px-4 py-2 text-[13px] text-muted">
                      <span className={cn(task.status === "cut" && "line-through")}>{task.title}</span>
                      <span className="shrink-0">{task.due_at ? formatDue(task.due_at, tz, now) : ""}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>

          {attention.length || doing.length ? (
            <Card>
              <CardHeader title="In flight" description="Items marked [!] (needs attention) and [~] (in progress)." />
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
            {docs.some((d) => d.items_total > 0) ? (
              <div>
                {docs
                  .filter((d) => d.items_total > 0)
                  .map((doc) => (
                    <DocumentChecklist key={doc.id} doc={doc} items={itemsByDoc.get(doc.id) ?? []} />
                  ))}
              </div>
            ) : (
              <EmptyState title="No checklist items">
                {project.source === "agent" ? "None of the indexed files has “- [ ]” items yet." : "Manual projects track progress through linked tasks."}
              </EmptyState>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {history.length ? (
            <Card>
              <CardHeader title="Progress over time" description="Checklist completion at each day’s last sync." />
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

          <Card>
            <CardHeader title="Documents" description={docs.length ? `${docs.length} indexed` : undefined} />
            {docs.length ? (
              <ul className="divide-y divide-border">
                {docs.map((doc) => (
                  <li key={doc.id}>
                    <Link href={`/projects/${project.id}/docs/${doc.id}`} className="flex flex-col gap-0.5 px-4 py-2.5 hover:bg-surface-2/60">
                      <span className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate font-medium">{doc.title}</span>
                        <Badge>{doc.kind}</Badge>
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                        <span className="truncate">{doc.path}</span>
                        {doc.items_total ? <span>{doc.items_done}/{doc.items_total - doc.items_cut} items</span> : null}
                        {doc.redactions ? <span className="text-warn">{doc.redactions} secret(s) redacted</span> : null}
                        {doc.truncated ? <span className="text-warn">truncated</span> : null}
                        {doc.error ? <span className="text-danger">{doc.error}</span> : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No documents">
                {project.source === "agent" ? "The agent has not uploaded any file yet." : "Manual projects have no folder. Use the agent to index one."}
              </EmptyState>
            )}
          </Card>

          {isOwner ? (
            <Card>
              <CardHeader
                title="Settings"
                actions={
                  <InlineAction
                    action={deleteProject}
                    fields={{ id: project.id }}
                    confirm={project.source === "agent" ? "Delete? The agent re-creates it on its next sync unless you run `hub-agent project remove`." : "Delete this project?"}
                    variant="danger"
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </InlineAction>
                }
              />
              <CardBody>
                <ProjectForm
                  project={{
                    id: project.id,
                    name: project.name,
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
