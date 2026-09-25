import {
  addDaysToKey,
  findConflicts,
  formatHours,
  formatZoned,
  freeHoursUntil,
  freeIntervals,
  isoWeekdayOfKey,
  parseClock,
  zonedDateKey,
  zonedInstant,
} from "@hub/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { WeekGrid, type GridDay } from "@/components/week-grid";
import { requireUser } from "@/lib/auth";
import { busyIntervals, classesBetween, loadEvents, loadTasks, loadWorkspace, periodsOf } from "@/lib/data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendar" };

interface Item {
  id: string;
  title: string;
  detail: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
  busy: boolean;
  href?: string;
}

function mondayOf(key: string): string {
  return addDaysToKey(key, 1 - isoWeekdayOfKey(key));
}

/** One day's busy blocks across the productive window, drawn as an SVG strip. */
function DayStrip({ items, dayStartMin, dayEndMin, dateKey, tz }: { items: Item[]; dayStartMin: number; dayEndMin: number; dateKey: string; tz: string }) {
  const span = dayEndMin - dayStartMin;
  const origin = zonedInstant(dateKey, dayStartMin, tz).getTime();
  return (
    <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="h-1.5 w-full" aria-hidden>
      <rect width="100" height="6" rx="3" className="fill-surface-2" />
      {items
        .filter((item) => item.busy && !item.allDay)
        .map((item) => {
          const x = Math.max(0, ((item.start.getTime() - origin) / 60_000 / span) * 100);
          const w = Math.min(100 - x, ((item.end.getTime() - item.start.getTime()) / 60_000 / span) * 100);
          return w > 0 ? <rect key={item.id} x={x} width={w} height="6" fill={item.color} opacity={0.8} /> : null;
        })}
    </svg>
  );
}

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const params = await searchParams;
  const { user, supabase } = await requireUser();
  const ws = await loadWorkspace(supabase, user.id);
  const { tz } = ws.options;
  const now = new Date();
  const todayKey = zonedDateKey(now, tz);
  const requested = typeof params.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.week) ? params.week : todayKey;
  const monday = mondayOf(requested);
  const from = zonedInstant(monday, 0, tz);
  const to = zonedInstant(addDaysToKey(monday, 7), 0, tz);

  const [events, tasks] = await Promise.all([loadEvents(supabase, user.id, from, to), loadTasks(supabase, user.id)]);
  const classes = classesBetween(ws, from, to);
  const courseById = new Map(ws.courses.map((c) => [c.id, c]));
  const items: Item[] = [
    ...classes.map((c) => {
      const course = courseById.get(c.courseId);
      return {
        id: `class:${c.sessionId}:${c.date}`,
        title: course?.name ?? "Class",
        detail: [course?.code, c.kind !== "lecture" ? c.kind : null, c.room].filter(Boolean).join(", ") || null,
        start: c.start,
        end: c.end,
        allDay: false,
        color: course?.color ?? "#2458e6",
        busy: true,
        href: course ? `/courses/${course.id}` : undefined,
      };
    }),
    ...events.map((e) => ({
      id: `event:${e.id}`,
      title: e.title,
      detail: e.location,
      start: new Date(e.starts_at),
      end: new Date(e.ends_at),
      allDay: e.all_day,
      color: "#64748b",
      busy: e.busy,
    })),
  ];
  const conflicts = new Set(findConflicts(items.filter((i) => !i.allDay && i.busy)).flat());
  const busy = busyIntervals(classes, events);
  const dayStartMin = parseClock(ws.options.dayStart);
  const dayEndMin = parseClock(ws.options.dayEnd);

  const days = Array.from({ length: 7 }, (_, i) => {
    const key = addDaysToKey(monday, i);
    const start = zonedInstant(key, 0, tz);
    const end = zonedInstant(addDaysToKey(key, 1), 0, tz);
    const dayItems = items
      .filter((item) => item.start < end && item.end > start)
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
    const free = freeHoursUntil(freeIntervals(start, end, busy, ws.options), start, end);
    const due = tasks.filter((t) => t.due_at && zonedDateKey(new Date(t.due_at), tz) === key);
    return { key, start, dayItems, free, due };
  });

  // The grid shows the productive day, stretched to include anything scheduled outside it.
  const minutesIn = (date: Date, dayStart: Date) => (date.getTime() - dayStart.getTime()) / 60_000;
  const timed = days.flatMap((d) => d.dayItems.filter((i) => !i.allDay).map((i) => [minutesIn(i.start, d.start), minutesIn(i.end, d.start)] as const));
  const fromMin = Math.max(0, Math.floor(Math.min(dayStartMin, ...timed.map(([a]) => a)) / 60) * 60);
  const toMin = Math.min(24 * 60, Math.ceil(Math.max(dayEndMin, ...timed.map(([, b]) => b)) / 60) * 60);
  const gridDays: GridDay[] = days.map((day) => ({
    key: day.key,
    label: formatZoned(zonedInstant(day.key, 12 * 60, tz), "EEE d", tz),
    isToday: day.key === todayKey,
    free: day.free,
    items: day.dayItems
      .filter((i) => !i.allDay)
      .map((i) => ({ id: i.id, title: i.title, detail: i.detail, start: i.start, end: i.end, color: i.color, busy: i.busy, conflict: conflicts.has(i.id), href: i.href })),
    allDay: day.dayItems.filter((i) => i.allDay).map((i) => ({ id: i.id, title: i.title })),
    due: day.due.map((t) => ({ id: t.id, title: t.title, at: new Date(t.due_at!), done: t.status === "done" })),
  }));

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`Week of ${formatZoned(from, "d MMMM yyyy", tz)}`}
        actions={
          <>
            <ButtonLink href={`/calendar?week=${addDaysToKey(monday, -7)}`} size="sm" aria-label="Previous week">
              <ChevronLeft className="size-4" />
            </ButtonLink>
            <ButtonLink href="/calendar" size="sm">
              This week
            </ButtonLink>
            <ButtonLink href={`/calendar?week=${addDaysToKey(monday, 7)}`} size="sm" aria-label="Next week">
              <ChevronRight className="size-4" />
            </ButtonLink>
          </>
        }
      />

      <Card className="hidden overflow-hidden px-2 pt-3 pb-1 md:block">
        <WeekGrid days={gridDays} fromMin={fromMin} toMin={toMin} tz={tz} now={now} periods={periodsOf(ws.profile)} />
      </Card>
      <p className="mt-3 hidden text-[12.5px] text-muted md:block">
        Dashed red outlines mark overlapping commitments; the ticks labelled t1–t10 are class periods (tiết).
      </p>

      {/* Phones: one list per day. */}
      <div className="grid gap-3 md:hidden">
        {days.map((day) => (
          <Card key={day.key} className={cn(day.key === todayKey && "border-accent/60")}>
            <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
              <span className="text-sm font-semibold">
                {formatZoned(zonedInstant(day.key, 12 * 60, tz), "EEE d MMM", tz)}
                {day.key === todayKey ? <Badge tone="accent" className="ml-2">today</Badge> : null}
              </span>
              <span className="text-[12px] text-muted">{formatHours(day.free)} free</span>
            </div>
            <div className="px-3 pt-2">
              <DayStrip items={day.dayItems} dayStartMin={dayStartMin} dayEndMin={dayEndMin} dateKey={day.key} tz={tz} />
            </div>
            <ul className="flex flex-col gap-1 px-3 py-2">
              {day.due.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-[13px]">
                  <Badge tone={t.status === "done" ? "ok" : "danger"}>due {formatZoned(new Date(t.due_at!), "HH:mm", tz)}</Badge>
                  <span className={cn("truncate", t.status === "done" && "text-muted line-through")}>{t.title}</span>
                </li>
              ))}
              {day.dayItems.map((item) => {
                const row = (
                  <div className="flex gap-2 text-[13px]">
                    <span className="w-11 shrink-0 text-[12px] text-muted tabular-nums">{item.allDay ? "all day" : formatZoned(item.start, "HH:mm", tz)}</span>
                    <svg width="3" height="18" viewBox="0 0 3 18" className="mt-0.5 shrink-0" aria-hidden>
                      <rect width="3" height="18" rx="1.5" fill={item.color} />
                    </svg>
                    <span className="min-w-0">
                      <span className={cn("block truncate", !item.busy && "text-muted")}>{item.title}</span>
                      {item.detail ? <span className="block truncate text-[12px] text-muted">{item.detail}</span> : null}
                    </span>
                    {conflicts.has(item.id) ? <Badge tone="warn" className="ml-auto self-start">overlap</Badge> : null}
                  </div>
                );
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <Link href={item.href} className="block rounded-md hover:bg-surface-2">
                        {row}
                      </Link>
                    ) : (
                      row
                    )}
                  </li>
                );
              })}
              {day.dayItems.length === 0 && day.due.length === 0 ? <li className="text-[13px] text-muted">Free</li> : null}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
