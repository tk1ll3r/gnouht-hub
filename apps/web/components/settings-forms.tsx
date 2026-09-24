"use client";

import { addIcsSource, updatePeriods, updateProfile } from "@/app/(app)/settings/actions";
import { ActionForm, SubmitButton } from "./forms";
import { Field, Input, Select } from "./ui";

const COMMON_ZONES = ["Asia/Ho_Chi_Minh", "Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "UTC"];

export interface ProfileValues {
  display_name: string;
  timezone: string;
  day_start: string;
  day_end: string;
  busy_buffer_minutes: number;
  email_digest: boolean;
}

export function ProfileForm({ profile }: { profile: ProfileValues }) {
  const zones = COMMON_ZONES.includes(profile.timezone) ? COMMON_ZONES : [profile.timezone, ...COMMON_ZONES];
  return (
    <ActionForm action={updateProfile} className="grid gap-3 sm:grid-cols-2">
      {(state) => (
        <>
          <Field label="Display name" htmlFor="p-name" error={state.errors?.display_name}>
            <Input id="p-name" name="display_name" defaultValue={profile.display_name} maxLength={80} />
          </Field>
          <Field label="Time zone" htmlFor="p-tz" error={state.errors?.timezone}>
            <Select id="p-tz" name="timezone" defaultValue={profile.timezone}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Day starts" htmlFor="p-start" hint="Free time is only counted inside your day." error={state.errors?.day_start}>
            <Input id="p-start" name="day_start" type="time" defaultValue={profile.day_start.slice(0, 5)} required />
          </Field>
          <Field label="Day ends" htmlFor="p-end" error={state.errors?.day_end}>
            <Input id="p-end" name="day_end" type="time" defaultValue={profile.day_end.slice(0, 5)} required />
          </Field>
          <Field label="Buffer around busy blocks (minutes)" htmlFor="p-buffer" hint="Travel and context-switch time." error={state.errors?.busy_buffer_minutes}>
            <Input id="p-buffer" name="busy_buffer_minutes" type="number" min={0} max={120} step={5} defaultValue={profile.busy_buffer_minutes} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="email_digest" defaultChecked={profile.email_digest} className="size-4 accent-accent" />
            Email me the morning brief (06:30)
          </label>
          <div className="sm:col-span-2">
            <SubmitButton>Save settings</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function PeriodsForm({ periods }: { periods: { period: number; start: string; end: string }[] }) {
  const rows = Array.from({ length: 12 }, (_, i) => periods.find((p) => p.period === i + 1) ?? { period: i + 1, start: "", end: "" });
  return (
    <ActionForm action={updatePeriods}>
      {() => (
        <>
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            {rows.map((p) => (
              <div key={p.period} className="flex items-center gap-2 text-[13px]">
                <span className="w-11 shrink-0 text-muted">Tiết {p.period}</span>
                <input
                  name={`p${p.period}_start`}
                  type="time"
                  defaultValue={p.start}
                  aria-label={`Period ${p.period} start`}
                  className="h-8 w-full min-w-0 rounded-md border border-border bg-surface px-1.5"
                />
                <input
                  name={`p${p.period}_end`}
                  type="time"
                  defaultValue={p.end}
                  aria-label={`Period ${p.period} end`}
                  className="h-8 w-full min-w-0 rounded-md border border-border bg-surface px-1.5"
                />
              </div>
            ))}
          </div>
          <div className="mt-3">
            <SubmitButton variant="secondary">Save periods</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function IcsSourceForm() {
  return (
    <ActionForm action={addIcsSource} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
      {(state) => (
        <>
          <Field label="Name" htmlFor="ics-name" error={state.errors?.name}>
            <Input id="ics-name" name="name" required maxLength={80} placeholder="UIT Moodle" />
          </Field>
          <Field label="Type" htmlFor="ics-flavor" error={state.errors?.flavor}>
            <Select id="ics-flavor" name="flavor" defaultValue="moodle">
              <option value="moodle">Moodle deadlines → tasks</option>
              <option value="generic">Other calendar → busy time</option>
            </Select>
          </Field>
          <Field
            label="Calendar URL (.ics)"
            htmlFor="ics-url"
            error={state.errors?.url}
            hint="Moodle: Calendar → Export calendar → All courses, Recent and next 60 days → Get calendar URL."
            className="sm:col-span-2"
          >
            <Input id="ics-url" name="url" type="url" required placeholder="https://courses.uit.edu.vn/calendar/export_execute.php?…" autoComplete="off" />
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Checking the feed…">Connect calendar</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
