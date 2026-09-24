import { rankTasks, TIER_LABELS, type UrgencyTier } from "@hub/core";
import { ExternalLink, FileText, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { InlineAction } from "@/components/forms";
import { TaskControls, TaskForm } from "@/components/task-forms";
import { Badge, Card, CardBody, CardHeader, ColorDot, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { busyIntervals, classesBetween, loadEvents, loadProjectLabels, loadTasks, loadWorkspace, toRankable } from "@/lib/data";
import { formatDue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteTask } from "./actions";

export const metadata: Metadata = { title: "Tasks" };

const VIEWS = ["open", "done", "all"] as const;
const TIER_TONE: Record<UrgencyTier, "danger" | "warn" | "ok"> = { urgent: "danger", soon: "warn", ok: "ok" };

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const params = await searchParams;
  const view = VIEWS.find((v) => v === params.view) ?? "open";
  const { user, supabase } = await requireUser();
  const ws = await loadWorkspace(supabase, user.id);
  const now = new Date();
  const horizon = new Date(now.getTime() + 60 * 86_400_000);
  const [rows, events, projects] = await Promise.all([
    loadTasks(supabase, user.id, { includeDone: view !== "open" }),
    loadEvents(supabase, user.id, now, horizon),
    loadProjectLabels(supabase, user.id),
  ]);

  const tasks = toRankable(rows, ws.courses, projects);
  const busy = busyIntervals(classesBetween(ws, now, horizon), events);
  const { ranked } = rankTasks(tasks, { now, busy, ...ws.options });
  const rankById = new Map(ranked.map((r) => [r.task.id, r]));
  const visible = tasks.filter((t) =>
    view === "open" ? t.status !== "done" && t.status !== "cut" : view === "done" ? t.status === "done" || t.status === "cut" : true,
  );
  // Open tasks follow the urgency ranking; the rest are listed by due date.
  visible.sort((a, b) => {
    const ra = rankById.get(a.id);
    const rb = rankById.get(b.id);
    if (ra && rb) return ranked.indexOf(ra) - ranked.indexOf(rb);
    if (ra || rb) return ra ? -1 : 1;
    return (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity);
  });

  return (
    <>
      <PageHeader title="Tasks" description="Manual tasks, Moodle deadlines and project checklists in one list." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <div className="flex gap-1 border-b border-border px-3 py-2 text-[13px]">
            {VIEWS.map((v) => (
              <Link
                key={v}
                href={`/tasks?view=${v}`}
                className={cn("rounded-md px-2.5 py-1 capitalize", v === view ? "bg-surface-2 font-medium" : "text-muted hover:text-text")}
              >
                {v}
              </Link>
            ))}
          </div>
          {visible.length === 0 ? (
            <EmptyState title={view === "open" ? "Nothing open" : "Nothing here"}>
              {view === "open" ? "Add a task, or connect your Moodle calendar in Settings to import deadlines." : null}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((t) => {
                const rank = rankById.get(t.id);
                const finished = t.status === "done" || t.status === "cut";
                const ref = t.row.source_ref as { url?: string; path?: string } | null;
                return (
                  <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {t.course ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[12px] text-muted">
                            <ColorDot color={t.course.color} size={8} />
                            {t.course.code}
                          </span>
                        ) : null}
                        {t.project ? (
                          <Link href={`/projects/${t.project.id}`} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-text">
                            <ColorDot color={t.project.color} size={8} />
                            {t.project.name}
                          </Link>
                        ) : null}
                        <span className={cn("font-medium", finished && "text-muted line-through")}>{t.title}</span>
                        {t.row.source === "moodle" ? <Badge>Moodle</Badge> : null}
                        {t.row.source === "markdown" ? (
                          <Badge>
                            <FileText className="size-3" /> checklist
                          </Badge>
                        ) : null}
                        {ref?.url ? (
                          <a href={ref.url} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-accent" aria-label="Open source">
                            <ExternalLink className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {t.dueAt ? formatDue(t.dueAt, ws.options.tz, now) : "No deadline"}
                        {rank ? (
                          <>
                            {" · "}
                            <Badge tone={TIER_TONE[rank.tier]} className="align-middle">
                              {rank.overdue ? "Overdue" : TIER_LABELS[rank.tier]}
                            </Badge>{" "}
                            {rank.reason}
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <TaskControls id={t.id} status={t.status} progress={t.progress} estimate={t.estimateHours} />
                      {t.row.source === "manual" ? (
                        <InlineAction action={deleteTask} fields={{ id: t.id }} confirm="Delete this task?" title="Delete task">
                          <Trash2 className="size-3.5" aria-label="Delete" />
                        </InlineAction>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="h-fit">
          <CardHeader title="New task" />
          <CardBody>
            <TaskForm courses={ws.courses.map((c) => ({ id: c.id, code: c.code, name: c.name }))} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
