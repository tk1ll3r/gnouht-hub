import { formatHours, formatZoned, parseClock, TIER_LABELS, type UrgencyTier } from "@hub/core";
import { AlertTriangle, CalendarPlus, CheckCircle2, ExternalLink, Flag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import Markdown from "react-markdown";
import { AiAnswer } from "@/components/ai-answer";
import { LoadChart } from "@/components/charts";
import { TaskControls, TaskForm } from "@/components/task-forms";
import { Badge, ButtonLink, Card, CardBody, CardHeader, ColorDot, EmptyState, Meta } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { buildToday, type AgendaEntry } from "@/lib/data";
import { formatDayKey, formatDue } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Today" };

const TIER_TEXT: Record<UrgencyTier, string> = { urgent: "text-danger", soon: "text-warn", ok: "text-ok" };
// Red pen for urgent, highlighter for coming up — the marks a student would make in the margin.
const TIER_MARK: Record<UrgencyTier, string> = { urgent: "bg-danger", soon: "bg-highlight", ok: "bg-border" };

function greeting(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function AgendaRow({ item, tz }: { item: AgendaEntry; tz: string }) {
  const body = (
    <div className="flex gap-3 py-2">
      <div className="w-12 shrink-0 text-right text-[12.5px] leading-5 text-muted tabular-nums">
        {item.allDay ? "all day" : formatZoned(item.start, "HH:mm", tz)}
        {!item.allDay ? <div className="text-[11.5px] opacity-75">{formatZoned(item.end, "HH:mm", tz)}</div> : null}
      </div>
      <svg width="3" height="36" viewBox="0 0 3 36" className="shrink-0" aria-hidden>
        <rect width="3" height="36" rx="1.5" fill={item.color} opacity={item.kind === "study" ? 0.45 : 1} />
      </svg>
      <div className="min-w-0">
        <p className={cn("truncate text-[14px]", item.kind === "study" ? "text-ok" : "font-medium")}>{item.title}</p>
        <Meta className="text-[12.5px] text-muted" items={[item.code ? <span className="font-medium">{item.code}</span> : null, ...item.meta]} />
      </div>
    </div>
  );
  return item.href ? (
    <Link href={item.href} className="block rounded-lg px-1 hover:bg-surface-2">
      {body}
    </Link>
  ) : (
    <div className="px-1">{body}</div>
  );
}

export default async function TodayPage() {
  const { user, supabase } = await requireUser();
  const data = await buildToday(supabase, user.id);
  const { data: aiNote } = await supabase.from("briefs").select("markdown, created_at").eq("user_id", user.id).eq("for_date", data.todayKey).eq("kind", "ai").maybeSingle();
  const { workspace: ws, ranked, undated, agenda, load, clusters, now } = data;
  const tz = ws.options.tz;
  const focus = ranked.filter((r) => r.tier !== "ok");
  const onTrack = ranked.filter((r) => r.tier === "ok");
  const windowHours = (parseClock(ws.options.dayEnd) - parseClock(ws.options.dayStart)) / 60;
  const name = ws.profile.display_name || user.email?.split("@")[0] || "";
  const hour = Number(formatZoned(now, "H", tz));
  const courses = ws.courses.map((c) => ({ id: c.id, code: c.code, name: c.name }));
  const { urgent, soon } = data.brief.counts;

  const setup = [
    { done: Boolean(ws.semester), label: "Create your semester", href: "/courses" },
    { done: ws.courses.length > 0, label: "Add your courses", href: "/courses" },
    { done: ws.sessions.length > 0, label: "Enter the weekly timetable", href: "/courses" },
  ];
  const setupPending = setup.some((step) => !step.done);

  return (
    <>
      {/* The page head of a school notebook: the date written in ink on the ruled lines. */}
      <header className="ruled mb-8 pb-2">
        <h1 className="ink-in font-hand text-[28px] leading-[4rem] text-accent sm:text-[34px]">{formatZoned(now, "EEEE, d MMMM", tz)}</h1>
        <p className="text-[15px] leading-8">
          {greeting(hour)}
          {name ? `, ${name}` : ""}.{" "}
          {urgent ? <span className="font-medium text-danger">{urgent} urgent</span> : null}
          {urgent && soon ? " and " : null}
          {soon ? <span className="font-medium text-warn">{soon} coming up</span> : null}
          {urgent || soon ? ". " : "Nothing pressing. "}
          <span className="text-muted">{formatHours(data.freeHoursToday)} free for the rest of today.</span>
        </p>
      </header>

      {setupPending ? (
        <Card className="mb-8">
          <CardHeader title="Finish setting up" description="Ranking needs your timetable to know when you are free." />
          <ul className="divide-y divide-border">
            {setup.map((step) => (
              <li key={step.label} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className={cn("flex items-center gap-2", step.done && "text-muted line-through")}>
                  <CheckCircle2 className={cn("size-4", step.done ? "text-ok" : "text-muted")} /> {step.label}
                </span>
                {!step.done ? (
                  <ButtonLink href={step.href} size="sm">
                    Open
                  </ButtonLink>
                ) : null}
              </li>
            ))}
            <li className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="flex items-center gap-2">
                <CalendarPlus className="size-4 text-muted" /> Connect Google Calendar and Moodle deadlines
              </span>
              <ButtonLink href="/settings#calendars" size="sm">
                Settings
              </ButtonLink>
            </li>
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[3fr_2fr] lg:grid-rows-[auto_1fr] lg:gap-x-8 lg:gap-y-10">
        <section aria-labelledby="do-first" className="lg:col-start-1 lg:row-start-1">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 id="do-first" className="text-[19px] font-semibold tracking-tight">
              Do first
            </h2>
            <Link href="/tasks" className="text-[13px] text-accent hover:underline">
              All tasks
            </Link>
          </div>
          <p className="mb-3 text-[13px] text-muted">Ranked by the work left against your free time before each deadline.</p>

          {focus.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border">
              <EmptyState title="Nothing urgent">
                {ranked.length ? "Every deadline fits comfortably in your free time." : "No open deadlines. Add a task below or connect Moodle in Settings."}
              </EmptyState>
            </div>
          ) : (
            <ol className="border-t border-border">
              {focus.map((item) => {
                const task = item.task;
                const ref = task.row.source_ref as { url?: string } | null;
                const tier = item.overdue ? "urgent" : item.tier;
                return (
                  <li key={task.id} className="flex gap-3.5 border-b border-border py-3.5">
                    <span aria-hidden className={cn("w-[3px] shrink-0 rounded-full", TIER_MARK[tier])} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className={cn("text-[12.5px] font-semibold", TIER_TEXT[tier])}>{item.overdue ? "Overdue" : TIER_LABELS[item.tier]}</span>
                        <span className="text-[16px] leading-snug font-medium">{task.title}</span>
                        {task.assigned ? <Badge tone="accent">assigned to you</Badge> : null}
                        {ref?.url ? (
                          <a href={ref.url} target="_blank" rel="noopener noreferrer" className="self-center text-muted hover:text-accent" aria-label="Open in Moodle">
                            <ExternalLink className="size-3.5" />
                          </a>
                        ) : null}
                      </p>
                      <Meta
                        className="text-[13px] text-muted"
                        items={[
                          task.course ? (
                            <span className="inline-flex items-center gap-1.5 font-medium text-text">
                              <ColorDot color={task.course.color} size={8} /> {task.course.code}
                            </span>
                          ) : task.project ? (
                            <Link href={`/projects/${task.project.id}`} className="inline-flex items-center gap-1.5 font-medium text-text hover:text-accent">
                              <ColorDot color={task.project.color} size={8} /> {task.project.name}
                            </Link>
                          ) : null,
                          task.dueAt ? <span className="text-text">{formatDue(task.dueAt, tz, now)}</span> : null,
                          item.reason,
                        ]}
                      />
                      {task.editable ? (
                        <TaskControls id={task.id} status={task.status} progress={task.progress} estimate={task.estimateHours} />
                      ) : (
                        <p className="text-[12.5px] text-muted">Locked by the project lead.</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {onTrack.length ? (
            <details className="border-b border-border">
              <summary className="cursor-pointer py-2.5 text-[13px] text-muted hover:text-text">{onTrack.length} on track</summary>
              <ul className="pb-2">
                {onTrack.map((item) => (
                  <li key={item.task.id} className="flex items-center justify-between gap-3 py-1.5 text-[14px]">
                    <span className="min-w-0 truncate">
                      {item.task.course ? <span className="mr-2 font-medium text-muted">{item.task.course.code}</span> : null}
                      {item.task.title}
                    </span>
                    <span className="shrink-0 text-[12.5px] text-muted tabular-nums">{item.task.dueAt ? formatDue(item.task.dueAt, tz, now) : ""}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {undated.length ? (
            <details className="border-b border-border">
              <summary className="cursor-pointer py-2.5 text-[13px] text-muted hover:text-text">{undated.length} without a deadline</summary>
              <ul className="pb-2">
                {undated.map((task) => (
                  <li key={task.id} className="py-1.5 text-[14px]">
                    {task.course ? <span className="mr-2 font-medium text-muted">{task.course.code}</span> : null}
                    {task.title}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

        </section>

        {/* On phones the day's agenda comes before the form; on wide screens it is the side column. */}
        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {aiNote ? (
            <Card>
              <CardHeader title="Morning note" description={`Written by AI at ${formatZoned(new Date(aiNote.created_at), "HH:mm", tz)} from your plan for today.`} />
              <CardBody>
                <AiAnswer output={aiNote.markdown} className="text-[14px]" />
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Today" description="Classes, events and suggested study blocks." />
            <CardBody className="py-1">
              {agenda.length ? (
                <div className="divide-y divide-border/70">
                  {agenda.map((item) => (
                    <AgendaRow key={item.id} item={item} tz={tz} />
                  ))}
                </div>
              ) : (
                <EmptyState title="Nothing scheduled">A free day. Start at the top of Do first.</EmptyState>
              )}
            </CardBody>
          </Card>

          {data.milestones.length ? (
            <Card>
              <CardHeader title="Project milestones" description="Open milestones of your projects in the next two weeks." />
              <CardBody className="py-1">
                <ul className="divide-y divide-border/70">
                  {data.milestones.map((m) => (
                    <li key={m.id} className="flex items-baseline justify-between gap-3 py-2.5 text-[14px]">
                      <Link href={`/projects/${m.project.id}#milestones`} className="flex min-w-0 items-center gap-2 hover:text-accent">
                        <Flag className={cn("size-3.5 shrink-0", m.hard ? "text-danger" : "text-muted")} aria-label={m.hard ? "Hard deadline" : undefined} />
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{m.title}</span> <span className="text-muted">· {m.project.name}</span>
                        </span>
                      </Link>
                      <span className="shrink-0 text-[12.5px] text-muted tabular-nums">{formatDayKey(m.dueOn, data.todayKey)}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Next 14 days" description="Busy and free hours; dots mark deadlines." />
            <CardBody>
              <LoadChart days={load} windowHours={windowHours} />
              {clusters.length ? (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {clusters.map((cluster) => (
                    <li key={cluster.start.toISOString()} className="flex items-start gap-2 text-[13px] text-warn">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {cluster.ids.length} deadlines between {formatZoned(cluster.start, "EEE d MMM", tz)} and {formatZoned(cluster.end, "EEE d MMM", tz)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>

          <details className="group rounded-2xl border border-border bg-surface">
            <summary className="cursor-pointer list-none px-4 py-3 text-[14px] font-medium hover:text-accent">
              Preview the morning email
              <span className="block text-[12.5px] font-normal text-muted">Sent at 06:30 when digests are on in Settings.</span>
            </summary>
            <div className="prose-hub border-t border-border/70 px-4 py-3 text-sm">
              <Markdown>{data.brief.markdown}</Markdown>
            </div>
          </details>
        </div>

        <section aria-labelledby="add-task" className="lg:col-start-1 lg:row-start-2 lg:self-start">
          <h2 id="add-task" className="mb-3 text-[15px] font-semibold">
            Add a task
          </h2>
          <TaskForm courses={courses} projects={data.projects.filter((p) => p.role !== "viewer").map((p) => ({ id: p.id, name: p.name }))} compact />
        </section>
      </div>
    </>
  );
}
