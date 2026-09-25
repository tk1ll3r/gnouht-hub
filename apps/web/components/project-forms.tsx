"use client";

import { useState } from "react";
import { addMilestone, createTeamTask, saveProject } from "@/app/(app)/projects/actions";
import { ActionForm, SubmitButton } from "./forms";
import { Field, Input, Select, Textarea } from "./ui";

const COLORS = ["#7c3aed", "#2458e6", "#0f9d8a", "#d0342c", "#b86e00", "#db2777", "#0891b2", "#4d7c0f", "#475569"];
const STATUSES = [
  ["active", "Active"],
  ["done", "Done"],
  ["archived", "Archived (stop syncing)"],
] as const;
const KINDS = [
  ["course", "Course project"],
  ["research", "Research"],
  ["ctf", "CTF"],
  ["personal", "Personal"],
] as const;

export interface ProjectFormValues {
  id: string;
  name: string;
  slug: string;
  kind: string;
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
            <Input id={`p-name-${key}`} name="name" defaultValue={project?.name} required maxLength={100} placeholder="Đồ án NT219" />
          </Field>
          <Field label="Kind" htmlFor={`p-kind-${key}`} error={state.errors?.kind} className="sm:col-span-3">
            <Select id={`p-kind-${key}`} name="kind" defaultValue={project?.kind ?? "course"}>
              {KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Short name"
            htmlFor={`p-slug-${key}`}
            error={state.errors?.slug}
            hint="Used to link a folder on your PC: hub-agent project add <folder> --slug <short name>"
            className="sm:col-span-3"
          >
            <Input id={`p-slug-${key}`} name="slug" defaultValue={project?.slug ?? ""} maxLength={40} placeholder="made from the name" pattern="[a-z0-9][a-z0-9\-]{1,39}" />
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

export interface MemberOption {
  user_id: string;
  display_name: string;
}

/**
 * Adds a project task. Editors and the lead may assign it; only the lead may restrict who can change it
 * (the database enforces both, the form just hides what the caller cannot do).
 */
export function TeamTaskForm({ projectId, members, canRestrict }: { projectId: string; members: MemberOption[]; canRestrict: boolean }) {
  return (
    <ActionForm action={createTeamTask} resetOnSuccess className="grid gap-3 sm:grid-cols-6">
      {(state) => (
        <>
          <input type="hidden" name="project_id" value={projectId} />
          <Field label="Task" htmlFor={`tt-title-${projectId}`} error={state.errors?.title} className="sm:col-span-6">
            <Input id={`tt-title-${projectId}`} name="title" required maxLength={300} placeholder="Viết phần Related work" />
          </Field>
          <Field label="Assign to" htmlFor={`tt-assignee-${projectId}`} error={state.errors?.assignee_id} className="sm:col-span-3">
            <Select id={`tt-assignee-${projectId}`} name="assignee_id" defaultValue="">
              <option value="">Nobody yet</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due" htmlFor={`tt-due-${projectId}`} error={state.errors?.due_date} className="sm:col-span-3">
            <Input id={`tt-due-${projectId}`} name="due_date" type="date" />
          </Field>
          {canRestrict ? (
            <Field label="Who can change it" htmlFor={`tt-perm-${projectId}`} error={state.errors?.permission} className="sm:col-span-6">
              <Select id={`tt-perm-${projectId}`} name="permission" defaultValue="team">
                <option value="team">Team: the lead, editors and the assignee</option>
                <option value="assignee">Only the assignee (and you)</option>
                <option value="owner">Locked: only you</option>
              </Select>
            </Field>
          ) : null}
          <div className="sm:col-span-6">
            <SubmitButton pendingLabel="Adding…">Add task</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function MilestoneForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={addMilestone} resetOnSuccess className="flex flex-wrap items-end gap-2">
      {(state) => (
        <>
          <input type="hidden" name="project_id" value={projectId} />
          <Field label="Milestone" htmlFor={`ms-title-${projectId}`} error={state.errors?.title} className="min-w-40 flex-1">
            <Input id={`ms-title-${projectId}`} name="title" required maxLength={300} placeholder="Nộp proposal" />
          </Field>
          <Field label="Date" htmlFor={`ms-due-${projectId}`} error={state.errors?.due_on}>
            <Input id={`ms-due-${projectId}`} name="due_on" type="date" required className="w-auto" />
          </Field>
          <label className="flex h-9 items-center gap-1.5 text-[13px]">
            <input type="checkbox" name="hard" className="size-3.5 accent-accent" /> Hard deadline
          </label>
          <SubmitButton pendingLabel="Adding…">Add</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
