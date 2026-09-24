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

export function TaskForm({ courses, compact = false }: { courses: CourseOption[]; compact?: boolean }) {
  return (
    <ActionForm action={createTask} resetOnSuccess hideSuccess={compact} className="grid gap-3 sm:grid-cols-6">
      {(state) => (
        <>
          <Field label="Task" htmlFor="t-title" error={state.errors?.title} className="sm:col-span-6">
            <Input id="t-title" name="title" required maxLength={300} placeholder="Finish lab 3 report" />
          </Field>
          <Field label="Course" htmlFor="t-course" error={state.errors?.course_id} className="sm:col-span-3">
            <Select id="t-course" name="course_id" defaultValue="">
              <option value="">No course</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type" htmlFor="t-kind" error={state.errors?.kind} className="sm:col-span-3">
            <Select id="t-kind" name="kind" defaultValue="task">
              {TASK_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind[0]!.toUpperCase() + kind.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date" htmlFor="t-date" error={state.errors?.due_date} className="sm:col-span-2">
            <Input id="t-date" name="due_date" type="date" />
          </Field>
          <Field label="Time" htmlFor="t-time" hint="Default 23:59" error={state.errors?.due_time} className="sm:col-span-2">
            <Input id="t-time" name="due_time" type="time" />
          </Field>
          <Field label="Effort (hours)" htmlFor="t-est" hint="Leave empty to guess" error={state.errors?.estimate_hours} className="sm:col-span-2">
            <Input id="t-est" name="estimate_hours" type="number" min={0.25} max={500} step={0.25} />
          </Field>
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
