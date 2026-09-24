import { STATUS_LABELS, type TaskStatus } from "@hub/core";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CourseForm, SessionForm } from "@/components/course-forms";
import { InlineAction } from "@/components/forms";
import { Badge, Card, CardBody, CardHeader, ColorDot, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { periodsOf, loadWorkspace } from "@/lib/data";
import { formatDue, sessionLabel } from "@/lib/format";
import { uuid } from "@/lib/validation";
import { deleteCourse, deleteSession } from "../actions";

export const metadata: Metadata = { title: "Course" };

export default async function CoursePage({ params }: PageProps<"/courses/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { user, supabase } = await requireUser();

  // RLS returns nothing for another user's course, which becomes a plain 404.
  const { data: course } = await supabase.from("courses").select("*").eq("id", id).maybeSingle();
  if (!course) notFound();

  const [ws, sessionsRes, tasksRes] = await Promise.all([
    loadWorkspace(supabase, user.id),
    supabase.from("course_sessions").select("*").eq("course_id", id).order("weekday"),
    supabase.from("tasks").select("*").eq("course_id", id).order("due_at", { ascending: true, nullsFirst: false }).limit(200),
  ]);
  const sessions = sessionsRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const tz = ws.options.tz;

  return (
    <>
      <Link href="/courses" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-3.5" /> Courses
      </Link>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ColorDot color={course.color} size={12} />
            <span className="font-mono text-sm font-medium">{course.code}</span>
            {course.class_code ? <span className="text-sm text-muted">{course.class_code}</span> : null}
            {course.source !== "manual" ? <Badge tone="accent">from {course.source}</Badge> : null}
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{course.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {[course.lecturer, course.room, course.credits != null ? `${course.credits} credits` : null].filter(Boolean).join(" · ") || "No details yet"}
          </p>
        </div>
        {course.url ? (
          <a href={course.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
            Course page <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Weekly sessions" description="Classes repeat every week of the semester unless limited." />
            {sessions.length ? (
              <ul className="divide-y divide-border">
                {sessions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span>{sessionLabel(s)}</span>
                    <InlineAction action={deleteSession} fields={{ id: s.id }} confirm="Delete this session?" title="Delete session">
                      <Trash2 className="size-3.5" aria-label="Delete" />
                    </InlineAction>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No sessions yet">Add when this course meets so busy time and free slots are accurate.</EmptyState>
            )}
            <CardBody className="border-t border-border">
              <SessionForm courseId={course.id} periods={periodsOf(ws.profile)} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Deadlines & tasks" description={`${tasks.filter((t) => t.status !== "done" && t.status !== "cut").length} open`} />
            {tasks.length ? (
              <ul className="divide-y divide-border">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className={t.status === "done" || t.status === "cut" ? "text-muted line-through" : ""}>{t.title}</span>
                    <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
                      {t.due_at ? formatDue(t.due_at, tz) : "no deadline"}
                      <Badge tone={t.status === "done" ? "ok" : t.status === "attention" ? "danger" : "neutral"}>
                        {STATUS_LABELS[t.status as TaskStatus]}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing due">Deadlines from Moodle appear here once the calendar feed is connected.</EmptyState>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <CourseForm
                course={{
                  id: course.id,
                  code: course.code,
                  class_code: course.class_code,
                  name: course.name,
                  credits: course.credits,
                  lecturer: course.lecturer,
                  room: course.room,
                  color: course.color,
                  weight: Number(course.weight),
                  url: course.url,
                }}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Danger zone" />
            <CardBody className="flex items-center justify-between gap-3 text-[13px] text-muted">
              Deleting removes the course and its sessions. Tasks stay, without a course.
              <InlineAction action={deleteCourse} fields={{ id: course.id }} confirm="Delete this course?" variant="danger">
                Delete course
              </InlineAction>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
