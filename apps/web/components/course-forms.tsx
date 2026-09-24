"use client";

import { useState } from "react";
import { addSession, saveCourse, saveSemester } from "@/app/(app)/courses/actions";
import { ActionForm, SubmitButton } from "./forms";
import { Field, Input, Select } from "./ui";

const COLORS = ["#2458e6", "#0f9d8a", "#d0342c", "#b86e00", "#7c3aed", "#db2777", "#0891b2", "#4d7c0f", "#475569"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface SemesterFormValues {
  id?: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_current: boolean;
  skip_dates: string[];
}

export function SemesterForm({ semester, submitLabel = "Save semester" }: { semester: SemesterFormValues; submitLabel?: string }) {
  return (
    <ActionForm action={saveSemester} className="grid gap-3 sm:grid-cols-2">
      {(state) => (
        <>
          {semester.id ? <input type="hidden" name="id" value={semester.id} /> : null}
          <Field label="Name" htmlFor="sem-name" error={state.errors?.name} className="sm:col-span-2">
            <Input id="sem-name" name="name" defaultValue={semester.name} required maxLength={80} />
          </Field>
          <Field label="First day" htmlFor="sem-start" error={state.errors?.starts_on}>
            <Input id="sem-start" name="starts_on" type="date" defaultValue={semester.starts_on} required />
          </Field>
          <Field label="Last day" htmlFor="sem-end" error={state.errors?.ends_on}>
            <Input id="sem-end" name="ends_on" type="date" defaultValue={semester.ends_on} required />
          </Field>
          <Field
            label="Days without classes"
            htmlFor="sem-skip"
            hint="Holidays or exam weeks, as YYYY-MM-DD separated by commas."
            error={state.errors?.skip_dates}
            className="sm:col-span-2"
          >
            <Input id="sem-skip" name="skip_dates" defaultValue={semester.skip_dates.join(", ")} placeholder="2026-11-20, 2027-01-01" />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="is_current" defaultChecked={semester.is_current} className="size-4 accent-accent" />
            This is my current semester
          </label>
          <div className="sm:col-span-2">
            <SubmitButton>{submitLabel}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export interface CourseFormValues {
  id?: string;
  code: string;
  class_code: string | null;
  name: string;
  credits: number | null;
  lecturer: string | null;
  room: string | null;
  color: string;
  weight: number;
  url: string | null;
}

export function CourseForm({ course, semesterId, submitLabel }: { course?: CourseFormValues; semesterId?: string; submitLabel?: string }) {
  const [color, setColor] = useState(course?.color ?? COLORS[0]!);
  return (
    <ActionForm action={saveCourse} resetOnSuccess={!course} className="grid gap-3 sm:grid-cols-6">
      {(state) => (
        <>
          {course?.id ? <input type="hidden" name="id" value={course.id} /> : null}
          {semesterId ? <input type="hidden" name="semester_id" value={semesterId} /> : null}
          <input type="hidden" name="color" value={color} />
          <Field label="Code" htmlFor="c-code" error={state.errors?.code} className="sm:col-span-2">
            <Input id="c-code" name="code" defaultValue={course?.code} placeholder="NT219" required maxLength={20} />
          </Field>
          <Field label="Class" htmlFor="c-class" error={state.errors?.class_code} className="sm:col-span-2">
            <Input id="c-class" name="class_code" defaultValue={course?.class_code ?? ""} placeholder="NT219.Q11" maxLength={40} />
          </Field>
          <Field label="Credits" htmlFor="c-credits" error={state.errors?.credits} className="sm:col-span-2">
            <Input id="c-credits" name="credits" type="number" min={0} max={20} defaultValue={course?.credits ?? ""} />
          </Field>
          <Field label="Name" htmlFor="c-name" error={state.errors?.name} className="sm:col-span-6">
            <Input id="c-name" name="name" defaultValue={course?.name} placeholder="Cryptography" required maxLength={160} />
          </Field>
          <Field label="Lecturer" htmlFor="c-lecturer" error={state.errors?.lecturer} className="sm:col-span-3">
            <Input id="c-lecturer" name="lecturer" defaultValue={course?.lecturer ?? ""} maxLength={120} />
          </Field>
          <Field label="Room" htmlFor="c-room" error={state.errors?.room} className="sm:col-span-3">
            <Input id="c-room" name="room" defaultValue={course?.room ?? ""} placeholder="B1.12" maxLength={60} />
          </Field>
          <Field
            label="Importance"
            htmlFor="c-weight"
            hint="Raises this course's deadlines in the urgency ranking."
            error={state.errors?.weight}
            className="sm:col-span-3"
          >
            <Select id="c-weight" name="weight" defaultValue={String(course?.weight ?? 1)}>
              <option value="0.5">Low (×0.5)</option>
              <option value="1">Normal (×1)</option>
              <option value="1.5">High (×1.5)</option>
              <option value="2">Very high (×2)</option>
              <option value="3">Critical (×3)</option>
            </Select>
          </Field>
          <Field label="Course page" htmlFor="c-url" error={state.errors?.url} className="sm:col-span-3">
            <Input id="c-url" name="url" type="url" defaultValue={course?.url ?? ""} placeholder="https://courses.uit.edu.vn/course/view.php?id=…" />
          </Field>
          <fieldset className="sm:col-span-6">
            <legend className="mb-1 text-[13px] font-medium">Colour</legend>
            <div className="flex flex-wrap gap-2">
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
            <SubmitButton>{submitLabel ?? (course ? "Save course" : "Add course")}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function SessionForm({ courseId, periods }: { courseId: string; periods: { period: number; start: string; end: string }[] }) {
  const [mode, setMode] = useState<"periods" | "times">("periods");
  return (
    <ActionForm action={addSession} className="grid gap-3 sm:grid-cols-6">
      {(state) => (
        <>
          <input type="hidden" name="course_id" value={courseId} />
          <input type="hidden" name="mode" value={mode} />
          <Field label="Day" htmlFor="s-day" error={state.errors?.weekday} className="sm:col-span-2">
            <Select id="s-day" name="weekday" defaultValue="1">
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index + 1}>
                  {day}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type" htmlFor="s-kind" error={state.errors?.kind} className="sm:col-span-2">
            <Select id="s-kind" name="kind" defaultValue="lecture">
              <option value="lecture">Lecture</option>
              <option value="lab">Lab</option>
              <option value="exam">Exam</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Repeats" htmlFor="s-interval" error={state.errors?.week_interval} className="sm:col-span-2">
            <Select id="s-interval" name="week_interval" defaultValue="1">
              <option value="1">Every week</option>
              <option value="2">Every 2 weeks</option>
              <option value="3">Every 3 weeks</option>
              <option value="4">Every 4 weeks</option>
            </Select>
          </Field>

          <div className="flex gap-1 rounded-lg bg-surface-2 p-1 text-[13px] sm:col-span-6 sm:w-fit" role="radiogroup" aria-label="Time format">
            {(["periods", "times"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className="rounded-md px-3 py-1 text-muted aria-checked:bg-surface aria-checked:font-medium aria-checked:text-text"
              >
                {m === "periods" ? "Class periods (tiết)" : "Exact times"}
              </button>
            ))}
          </div>

          {mode === "periods" ? (
            <>
              <Field label="From period" htmlFor="s-p1" error={state.errors?.period_start} className="sm:col-span-3">
                <Select id="s-p1" name="period_start" defaultValue="1">
                  {periods.map((p) => (
                    <option key={p.period} value={p.period}>
                      Period {p.period} ({p.start})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="To period" htmlFor="s-p2" error={state.errors?.period_end} className="sm:col-span-3">
                <Select id="s-p2" name="period_end" defaultValue="3">
                  {periods.map((p) => (
                    <option key={p.period} value={p.period}>
                      Period {p.period} (until {p.end})
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Starts" htmlFor="s-t1" error={state.errors?.start_time} className="sm:col-span-3">
                <Input id="s-t1" name="start_time" type="time" defaultValue="07:30" />
              </Field>
              <Field label="Ends" htmlFor="s-t2" error={state.errors?.end_time} className="sm:col-span-3">
                <Input id="s-t2" name="end_time" type="time" defaultValue="09:45" />
              </Field>
            </>
          )}

          <Field label="Room" htmlFor="s-room" error={state.errors?.room} className="sm:col-span-2">
            <Input id="s-room" name="room" placeholder="B1.12" maxLength={60} />
          </Field>
          <Field label="From (optional)" htmlFor="s-from" hint="Defaults to the semester start." error={state.errors?.starts_on} className="sm:col-span-2">
            <Input id="s-from" name="starts_on" type="date" />
          </Field>
          <Field label="Until (optional)" htmlFor="s-to" hint="Defaults to the semester end." error={state.errors?.ends_on} className="sm:col-span-2">
            <Input id="s-to" name="ends_on" type="date" />
          </Field>
          <div className="sm:col-span-6">
            <SubmitButton>Add session</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
