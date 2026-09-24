"use client";

import { STATUS_LABELS, TASK_KINDS, TASK_STATUSES } from "@hub/core";
import { useRef } from "react";
import { createTask, updateTask } from "@/app/(app)/tasks/actions";
import { ActionForm, SubmitButton } from "./forms";
import { Field, Input, Select } from "./ui";

export interface CourseOption {
  id: string;
  code: string;
  name: string;
}

export interface ProjectOption {
  id: string;
  name: string;
}

function TaskDetailFields({ courses, projects, errors }: { courses: CourseOption[]; projects: ProjectOption[]; errors?: Record<string, string[] | undefined> }) {
  return (
    <>
      <Field label="Course" htmlFor="t-course" error={errors?.course_id} className="sm:col-span-3">
        <Select id="t-course" name="course_id" defaultValue="">
          <option value="">No course</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Type" htmlFor="t-kind" error={errors?.kind} className="sm:col-span-3">
        <Select id="t-kind" name="kind" defaultValue="task">
          {TASK_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind[0]!.toUpperCase() + kind.slice(1)}
            </option>
          ))}
        </Select>
      </Field>
      {projects.length ? (
        <Field label="Project" htmlFor="t-project" error={errors?.project_id} className="sm:col-span-6">
          <Select id="t-project" name="project_id" defaultValue="">
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Time" htmlFor="t-time" hint="Default 23:59" error={errors?.due_time} className="sm:col-span-3">
        <Input id="t-time" name="due_time" type="time" />
      </Field>
      <Field label="Effort (hours)" htmlFor="t-est" hint="Leave empty to guess" error={errors?.estimate_hours} className="sm:col-span-3">
        <Input id="t-est" name="estimate_hours" type="number" min={0.25} max={500} step={0.25} />
      </Field>
    </>
  );
}

export function TaskForm({ courses, projects = [], compact = false }: { courses: CourseOption[]; projects?: ProjectOption[]; compact?: boolean }) {
  if (compact) {
    // Quick add: the title and a date are enough; everything else is one click away.
    return (
      <ActionForm action={createTask} resetOnSuccess hideSuccess className="flex flex-col gap-2">
        {(state) => (
          <>
            <div className="flex flex-wrap gap-2">
              <Input name="title" required maxLength={300} placeholder="What needs doing?" aria-label="Task" className="min-w-48 flex-1" />
              <Input name="due_date" type="date" aria-label="Due date" className="w-auto" />
              <SubmitButton pendingLabel="Adding…">Add</SubmitButton>
            </div>
            {state.errors?.title ? <p className="text-[12px] text-danger">{state.errors.title[0]}</p> : null}
            <details className="group">
              <summary className="w-fit cursor-pointer text-[13px] text-muted hover:text-accent">More details</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-6">
                <TaskDetailFields courses={courses} projects={projects} errors={state.errors} />
              </div>
            </details>
          </>
        )}
      </ActionForm>
    );
  }
  return (
    <ActionForm action={createTask} resetOnSuccess className="grid gap-3 sm:grid-cols-6">
      {(state) => (
        <>
          <Field label="Task" htmlFor="t-title" error={state.errors?.title} className="sm:col-span-6">
            <Input id="t-title" name="title" required maxLength={300} placeholder="Finish lab 3 report" />
          </Field>
          <Field label="Due date" htmlFor="t-date" error={state.errors?.due_date} className="sm:col-span-6">
            <Input id="t-date" name="due_date" type="date" />
          </Field>
          <TaskDetailFields courses={courses} projects={projects} errors={state.errors} />
          <div className="sm:col-span-6">
            <SubmitButton pendingLabel="Adding…">Add task</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Status / progress / effort controls for one task row; each change submits immediately. */
export function TaskControls({
  id,
  status,
  progress,
  estimate,
}: {
  id: string;
  status: string;
  progress: number;
  estimate: number | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();
  return (
    <form ref={formRef} action={updateTask} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <select
        name="status"
        defaultValue={status}
        onChange={submit}
        aria-label="Status"
        className="h-7 rounded-md border border-border bg-surface px-1.5 text-[12px]"
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <select
        name="progress"
        defaultValue={String(Math.round(progress * 4) / 4)}
        onChange={submit}
        aria-label="Progress"
        className="h-7 rounded-md border border-border bg-surface px-1.5 text-[12px]"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <option key={p} value={p}>
            {p * 100}%
          </option>
        ))}
      </select>
      <input
        name="estimate_hours"
        type="number"
        min={0.25}
        max={500}
        step={0.25}
        defaultValue={estimate ?? ""}
        placeholder="h"
        onBlur={(event) => {
          if (event.currentTarget.value !== String(estimate ?? "")) submit();
        }}
        aria-label="Effort in hours"
        className="h-7 w-16 rounded-md border border-border bg-surface px-1.5 text-[12px]"
      />
    </form>
  );
}
