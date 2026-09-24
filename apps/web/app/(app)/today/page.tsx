import { formatHours, formatZoned, parseClock, TIER_LABELS, type UrgencyTier } from "@hub/core";
import { AlertTriangle, CalendarPlus, CheckCircle2, Clock, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import Markdown from "react-markdown";
import { LoadChart } from "@/components/charts";
import { TaskControls, TaskForm } from "@/components/task-forms";
import { Badge, ButtonLink, Card, CardBody, CardHeader, ColorDot, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { buildToday, type AgendaEntry } from "@/lib/data";
import { formatDue } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Today" };

const TIER_TONE: Record<UrgencyTier, "danger" | "warn" | "ok"> = { urgent: "danger", soon: "warn", ok: "ok" };

function greeting(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function AgendaRow({ item, tz }: { item: AgendaEntry; tz: string }) {
  const body = (
    <div className="flex gap-3 py-2">
      <div className="w-[72px] shrink-0 text-right font-mono text-[12px] leading-5 text-muted">
        {item.allDay ? "all day" : `${formatZoned(item.start, "HH:mm", tz)}`}
        {!item.allDay ? <div className="text-[11px]">{formatZoned(item.end, "HH:mm", tz)}</div> : null}
      </div>
      <svg width="4" height="36" viewBox="0 0 4 36" className="shrink-0" aria-hidden>
        <rect width="4" height="36" rx="2" fill={item.color} opacity={item.kind === "study" ? 0.5 : 1} />
      </svg>
      <div className="min-w-0">
        <p className={cn("truncate text-sm", item.kind === "study" ? "text-ok" : "font-medium")}>{item.title}</p>
        {item.detail ? <p className="truncate text-[12px] text-muted">{item.detail}</p> : null}
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
  const { workspace: ws, ranked, undated, agenda, load, clusters, now } = data;
  const tz = ws.options.tz;
  const focus = ranked.filter((r) => r.tier !== "ok");
  const onTrack = ranked.filter((r) => r.tier === "ok");
  const windowHours = (parseClock(ws.options.dayEnd) - parseClock(ws.options.dayStart)) / 60;
  const name = ws.profile.display_name || user.email?.split("@")[0] || "";
  const hour = Number(formatZoned(now, "H", tz));
  const courses = ws.courses.map((c) => ({ id: c.id, code: c.code, name: c.name }));

  const setup = [
    { done: Boolean(ws.semester), label: "Create your semester", href: "/courses" },
    { done: ws.courses.length > 0, label: "Add your courses", href: "/courses" },
    { done: ws.sessions.length > 0, label: "Enter the weekly timetable", href: "/courses" },
  ];
  const setupPending = setup.some((step) => !step.done);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-muted">{formatZoned(now, "EEEE, d MMMM", tz)}</p>
          <h1 className="text-xl font-semibold tracking-tight">
            {greeting(hour)}
            {name ? `, ${name}` : ""}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {data.brief.counts.urgent ? <Badge tone="danger">{data.brief.counts.urgent} urgent</Badge> : null}
          {data.brief.counts.soon ? <Badge tone="warn">{data.brief.counts.soon} coming up</Badge> : null}
          <Badge tone="accent">
            <Clock className="size-3" /> {formatHours(data.freeHoursToday)} free today
          </Badge>
        </div>
      </header>

      {setupPending ? (
        <Card className="mb-6">
          <CardHeader title="Finish setting up" description="The urgency ranking needs your timetable to know when you are free." />
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

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Do first"
              description="Ranked by how much work is left versus the free time before each deadline."
              actions={
                <ButtonLink href="/tasks" size="sm" variant="ghost">
                  All tasks
                </ButtonLink>
              }
            />
            {focus.length === 0 ? (
              <EmptyState title="Nothing urgent">
                {ranked.length ? "Every deadline fits comfortably in your free time." : "No open deadlines. Add a task or connect Moodle."}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {focus.map((item) => {
                  const task = item.task;
                  const ref = task.row.source_ref as { url?: string } | null;
                  return (
                    <li key={task.id} className="flex flex-col gap-2 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={TIER_TONE[item.tier]}>{item.overdue ? "Overdue" : TIER_LABELS[item.tier]}</Badge>
                        {task.course ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[12px] text-muted">
                            <ColorDot color={task.course.color} size={8} /> {task.course.code}
                          </span>
                        ) : null}
                        <span className="font-medium">{task.title}</span>
                        {ref?.url ? (
                          <a href={ref.url} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-accent" aria-label="Open in Moodle">
                            <ExternalLink className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
                      <p className="text-[13px] text-muted">
                        {task.dueAt ? <span className="text-text">{formatDue(task.dueAt, tz, now)}</span> : null} · {item.reason}
                      </p>
                      <TaskControls id={task.id} status={task.status} progress={task.progress} estimate={task.estimateHours} />
                    </li>
                  );
                })}
              </ul>
            )}
            {onTrack.length ? (
              <details className="border-t border-border">
                <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-muted hover:text-text">
                  {onTrack.length} on track
                </summary>
                <ul className="divide-y divide-border">
                  {onTrack.map((item) => (
                    <li key={item.task.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        {item.task.course ? <span className="mr-1.5 font-mono text-[12px] text-muted">{item.task.course.code}</span> : null}
                        {item.task.title}
                      </span>
                      <span className="shrink-0 text-[12px] text-muted">{item.task.dueAt ? formatDue(item.task.dueAt, tz, now) : ""}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {undated.length ? (
              <details className="border-t border-border">
                <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-muted hover:text-text">{undated.length} without a deadline</summary>
                <ul className="divide-y divide-border">
                  {undated.map((task) => (
                    <li key={task.id} className="px-4 py-2 text-sm">
                      {task.course ? <span className="mr-1.5 font-mono text-[12px] text-muted">{task.course.code}</span> : null}
                      {task.title}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Quick add" />
            <CardBody>
              <TaskForm courses={courses} compact />
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Today" description="Classes, events and suggested study blocks." />
            <CardBody className="py-1">
              {agenda.length ? (
                <div className="divide-y divide-border">
                  {agenda.map((item) => (
                    <AgendaRow key={item.id} item={item} tz={tz} />
                  ))}
                </div>
              ) : (
                <EmptyState title="Nothing scheduled">A free day — see Do first for what to work on.</EmptyState>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Next 14 days" description="Busy vs. free hours; dots mark deadlines." />
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

          <Card>
            <CardHeader title="Morning brief" description="Also emailed at 06:30 when digests are on." />
            <CardBody className="prose-hub text-sm">
              <Markdown>{data.brief.markdown}</Markdown>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
