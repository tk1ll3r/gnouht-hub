import { addDaysToKey, DEFAULT_TZ, zonedDateKey } from "@hub/core";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CourseForm, SemesterForm } from "@/components/course-forms";
import { InlineAction } from "@/components/forms";
import { Badge, Card, CardBody, CardHeader, ColorDot, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadTasks, loadWorkspace } from "@/lib/data";
import { formatDateRange, formatDue, sessionLabel } from "@/lib/format";
import { makeSemesterCurrent } from "./actions";

export const metadata: Metadata = { title: "Courses" };

function suggestedSemester(now: Date) {
  // UIT's first semester starts in early September, the second in February.
  const today = zonedDateKey(now, DEFAULT_TZ);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (month >= 8) return { name: `HK1 ${year}–${year + 1}`, starts_on: `${year}-09-07`, ends_on: `${year}-12-27` };
  if (month <= 1) return { name: `HK1 ${year - 1}–${year}`, starts_on: `${year - 1}-09-07`, ends_on: `${year}-01-17` };
  return { name: `HK2 ${year - 1}–${year}`, starts_on: `${year}-02-16`, ends_on: addDaysToKey(`${year}-02-16`, 125) };
}

export default async function CoursesPage() {
  const { user, supabase } = await requireUser();
  const ws = await loadWorkspace(supabase, user.id);
  const tz = ws.options.tz;

  if (!ws.semester) {
    return (
      <>
        <PageHeader title="Courses" description="Start by describing your current semester." />
        <Card className="max-w-2xl">
          <CardHeader title="Set up your semester" description="Dates are used to repeat your timetable every week." />
          <CardBody>
            <SemesterForm semester={{ ...suggestedSemester(new Date()), is_current: true, skip_dates: [] }} submitLabel="Create semester" />
          </CardBody>
        </Card>
      </>
    );
  }

  const tasks = await loadTasks(supabase, user.id);
  const semester = ws.semester;

  return (
    <>
      <PageHeader
        title="Courses"
        description={
          <>
            {semester.name}, {formatDateRange(semester.starts_on, semester.ends_on)}
            {semester.is_current ? null : <Badge className="ml-2">not current</Badge>}
          </>
        }
      />

      {ws.courses.length === 0 ? (
        <Card className="mb-6">
          <EmptyState title="No courses yet">Add each course you take this semester, then its weekly sessions.</EmptyState>
        </Card>
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ws.courses.map((course) => {
            const sessions = ws.sessions.filter((s) => s.course_id === course.id);
            const open = tasks.filter((t) => t.course_id === course.id);
            const next = open.find((t) => t.due_at && new Date(t.due_at) > new Date());
            return (
              <Link key={course.id} href={`/courses/${course.id}`} className="group">
                <Card className="h-full transition-colors group-hover:border-accent">
                  <CardBody className="flex h-full flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <ColorDot color={course.color} />
                      <span className="text-[13px] font-semibold tracking-tight">{course.code}</span>
                      {course.class_code ? <span className="truncate text-[12px] text-muted">{course.class_code}</span> : null}
                      {course.credits != null ? <Badge className="ml-auto">{course.credits} cr</Badge> : null}
                    </div>
                    <p className="font-medium leading-snug">{course.name}</p>
                    <ul className="text-[13px] text-muted">
                      {sessions.length ? (
                        sessions.map((s) => <li key={s.id}>{sessionLabel(s)}</li>)
                      ) : (
                        <li className="text-warn">No weekly sessions yet</li>
                      )}
                    </ul>
                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 text-[12px] text-muted">
                      <span>{open.length} open task{open.length === 1 ? "" : "s"}</span>
                      {next?.due_at ? <span>next {formatDue(next.due_at, tz)}</span> : null}
                      {Number(course.weight) !== 1 ? <Badge tone="accent">×{Number(course.weight)}</Badge> : null}
                    </div>
                  </CardBody>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-1.5"><Plus className="size-4" />Add a course</span>} />
          <CardBody>
            <CourseForm semesterId={semester.id} />
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Semester" description="Edit dates and days without classes." />
            <CardBody>
              <SemesterForm
                semester={{
                  id: semester.id,
                  name: semester.name,
                  starts_on: semester.starts_on,
                  ends_on: semester.ends_on,
                  is_current: semester.is_current,
                  skip_dates: semester.skip_dates ?? [],
                }}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="All semesters" />
            <ul className="divide-y divide-border">
              {ws.semesters.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span>
                    {s.name} <span className="ml-1 text-muted">{formatDateRange(s.starts_on, s.ends_on)}</span>
                  </span>
                  {s.is_current ? (
                    <Badge tone="ok">current</Badge>
                  ) : (
                    <InlineAction action={makeSemesterCurrent} fields={{ id: s.id }}>
                      Make current
                    </InlineAction>
                  )}
                </li>
              ))}
            </ul>
            <CardBody className="border-t border-border">
              <details>
                <summary className="cursor-pointer text-[13px] font-medium text-accent">New semester</summary>
                <div className="mt-3">
                  <SemesterForm semester={{ ...suggestedSemester(new Date()), is_current: false, skip_dates: [] }} submitLabel="Create semester" />
                </div>
              </details>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
