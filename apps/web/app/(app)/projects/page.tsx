import { AlertTriangle, FolderSync, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ProjectForm } from "@/components/project-forms";
import { Badge, Card, CardBody, CardHeader, ColorDot, EmptyState, PageHeader, ProgressBar } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadWorkspace } from "@/lib/data";
import { formatDue, relativeTime } from "@/lib/format";
import { isActiveProject, loadProjectSummaries, loadShareLabels, type ProjectSummary } from "@/lib/projects";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Projects" };

const VIEWS = ["active", "finished"] as const;

function ProjectCard({ summary, tz, now, sharedVia }: { summary: ProjectSummary; tz: string; now: Date; sharedVia?: string[] }) {
  const { project, progress, nextDeadline } = summary;
  return (
    <Link href={`/projects/${project.id}`} className="group block">
      <Card className="h-full transition-colors group-hover:border-accent/50">
        <CardBody className="flex h-full flex-col gap-3 py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium">
                <ColorDot color={project.color} />
                <span className="truncate">{project.name}</span>
              </p>
              {sharedVia ? (
                <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-muted">
                  <Users className="size-3 shrink-0" /> via {sharedVia.join(", ")}
                </p>
              ) : project.folder_label ? (
                <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-muted">
                  <FolderSync className="size-3 shrink-0" /> {project.folder_label}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {project.status !== "active" ? <Badge>{project.status}</Badge> : null}
              {project.items_attention ? (
                <Badge tone="warn">
                  <AlertTriangle className="size-3" /> {project.items_attention}
                </Badge>
              ) : null}
              {summary.overdue ? <Badge tone="danger">{summary.overdue} overdue</Badge> : null}
            </div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[12px] text-muted">
              <span>
                {progress.basis === "none" ? "No checklist yet" : `${progress.done}/${progress.countable} ${progress.basis === "checklist" ? "items" : "tasks"}`}
              </span>
              <span className="tabular-nums">{Math.round(progress.ratio * 100)}%</span>
            </div>
            <ProgressBar value={progress.ratio} tone={progress.ratio >= 1 ? "ok" : "accent"} label={`${project.name} progress`} />
          </div>
          <p className="mt-auto text-[12px] text-muted">
            {nextDeadline?.due_at ? (
              <>
                Next: <span className="text-text">{nextDeadline.title}</span>, {formatDue(nextDeadline.due_at, tz, now)}
              </>
            ) : project.due_on ? (
              `Due ${project.due_on}`
            ) : (
              "No upcoming deadline"
            )}
            {project.last_synced_at ? <span className="block">Synced {relativeTime(project.last_synced_at, now)}</span> : null}
          </p>
        </CardBody>
      </Card>
    </Link>
  );
}

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const params = await searchParams;
  const view = VIEWS.find((v) => v === params.view) ?? "active";
  const { user, supabase } = await requireUser();
  const now = new Date();
  const [ws, summaries, shared] = await Promise.all([
    loadWorkspace(supabase, user.id),
    loadProjectSummaries(supabase, user.id, now),
    loadProjectSummaries(supabase, user.id, now, "shared"),
  ]);
  const visible = summaries.filter((s) => (view === "active") === isActiveProject(s.project.status));
  const sharedVisible = shared.filter((s) => (view === "active") === isActiveProject(s.project.status));
  const shareLabels = await loadShareLabels(supabase, sharedVisible.map((s) => s.project.id));
  const courses = ws.courses.map((c) => ({ id: c.id, code: c.code, name: c.name }));

  return (
    <>
      <PageHeader
        title="Projects"
        description="Progress read from the Markdown checklists in your project folders, plus milestones and deadlines."
      />
      <div className="mb-4 flex gap-1 text-[13px]">
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={`/projects?view=${v}`}
            className={cn("rounded-md px-2.5 py-1 capitalize", v === view ? "bg-surface font-medium shadow-sm ring-1 ring-border" : "text-muted hover:text-text")}
          >
            {v}
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          {visible.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {visible.map((summary) => (
                <ProjectCard key={summary.project.id} summary={summary} tz={ws.options.tz} now={now} />
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState title={view === "active" ? "No projects yet" : "Nothing finished yet"}>
                {view === "active" ? "Create one here, or let the agent on your PC watch a folder of progress notes." : null}
              </EmptyState>
            </Card>
          )}
          {sharedVisible.length ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Shared with me</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {sharedVisible.map((summary) => (
                  <ProjectCard key={summary.project.id} summary={summary} tz={ws.options.tz} now={now} sharedVia={shareLabels.get(summary.project.id) ?? []} />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Watch a folder" description="The agent on your PC reads Markdown and Word files; add PDFs if you want them searchable." />
            <CardBody className="flex flex-col gap-2 text-[13px] text-muted">
              <p>On your PC:</p>
              <pre className="overflow-x-auto rounded-lg bg-surface-2 p-2 font-mono text-[12px] text-text">
                hub-agent project add &quot;D:\Research\IDS&quot;{"\n"}hub-agent sync-docs
              </pre>
              <p>
                Mark items <code className="font-mono">[x]</code> done, <code className="font-mono">[~]</code> in progress, <code className="font-mono">[!]</code> needs
                attention or <code className="font-mono">[CẮT]</code> cut. A table with a Hạn or Deadline column, or <code className="font-mono">📅 2026-10-05</code> after an
                item, becomes a deadline. Keys and passwords are removed on your PC before anything is uploaded.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="New project" description="For work without a folder; link tasks to it." />
            <CardBody>
              <ProjectForm courses={courses} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
