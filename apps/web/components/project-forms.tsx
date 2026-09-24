"use client";

import { useState } from "react";
import { saveProject } from "@/app/(app)/projects/actions";
import { ActionForm, SubmitButton } from "./forms";
import { Field, Input, Select, Textarea } from "./ui";

const COLORS = ["#7c3aed", "#2458e6", "#0f9d8a", "#d0342c", "#b86e00", "#db2777", "#0891b2", "#4d7c0f", "#475569"];
const STATUSES = [
  ["active", "Active"],
  ["paused", "Paused"],
  ["done", "Done"],
  ["archived", "Archived (stop syncing)"],
] as const;

export interface ProjectFormValues {
  id: string;
  name: string;
  description: string | null;
  color: string;
  course_id: string | null;
  status: string;
  due_on: string | null;
}

export function ProjectForm({ project, courses }: { project?: ProjectFormValues; courses: { id: string; code: string; name: string }[] }) {
  const [color, setColor] = useState(project?.color ?? COLORS[0]!);
  const key = project?.id ?? "new";
  return (
    <ActionForm action={saveProject} className="grid gap-3 sm:grid-cols-6">
      {(state) => (
        <>
          {project ? <input type="hidden" name="id" value={project.id} /> : null}
          <input type="hidden" name="color" value={color} />
          <Field label="Name" htmlFor={`p-name-${key}`} error={state.errors?.name} className="sm:col-span-6">
            <Input id={`p-name-${key}`} name="name" defaultValue={project?.name} required maxLength={120} placeholder="Đồ án chuyên ngành" />
          </Field>
          <Field label="Description" htmlFor={`p-desc-${key}`} error={state.errors?.description} className="sm:col-span-6">
            <Textarea id={`p-desc-${key}`} name="description" defaultValue={project?.description ?? ""} maxLength={2000} className="min-h-16" />
          </Field>
          <Field label="Course" htmlFor={`p-course-${key}`} error={state.errors?.course_id} className="sm:col-span-3">
            <Select id={`p-course-${key}`} name="course_id" defaultValue={project?.course_id ?? ""}>
              <option value="">No course</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Final deadline" htmlFor={`p-due-${key}`} error={state.errors?.due_on} className="sm:col-span-3">
            <Input id={`p-due-${key}`} name="due_on" type="date" defaultValue={project?.due_on ?? ""} />
          </Field>
          <Field label="Status" htmlFor={`p-status-${key}`} error={state.errors?.status} className="sm:col-span-3">
            <Select id={`p-status-${key}`} name="status" defaultValue={project?.status ?? "active"}>
              {STATUSES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="flex flex-col gap-1 sm:col-span-3">
            <legend className="mb-1 text-[13px] font-medium">Colour</legend>
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Colour ${c}`}
                  aria-pressed={color === c}
                  className="rounded-full p-0.5 ring-offset-2 ring-offset-surface aria-pressed:ring-2 aria-pressed:ring-text"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                    <circle cx="10" cy="10" r="10" fill={c} />
                  </svg>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-6">
            <SubmitButton>{project ? "Save project" : "Create project"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
