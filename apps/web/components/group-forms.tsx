"use client";

import { Check, Copy } from "lucide-react";
import { useActionState, useState } from "react";
import { createGroup, inviteMember, updateGroup, type InviteState } from "@/app/(app)/groups/actions";
import { ActionForm, SubmitButton } from "./forms";
import { buttonClass, Field, Input, Select, Textarea } from "./ui";

const COLORS = ["#0f9d8a", "#2458e6", "#7c3aed", "#d0342c", "#b86e00", "#db2777", "#0891b2", "#4d7c0f", "#475569"];

export function GroupForm({ group }: { group?: { id: string; name: string; description: string | null; color: string; course_code: string | null } }) {
  const [color, setColor] = useState(group?.color ?? COLORS[0]!);
  const key = group?.id ?? "new";
  return (
    <ActionForm action={group ? updateGroup : createGroup} className="flex flex-col gap-3">
      {(state) => (
        <>
          {group ? <input type="hidden" name="id" value={group.id} /> : null}
          <input type="hidden" name="color" value={color} />
          <Field label="Name" htmlFor={`g-name-${key}`} error={state.errors?.name}>
            <Input id={`g-name-${key}`} name="name" defaultValue={group?.name} required maxLength={80} placeholder="Nhóm đồ án NT219" />
          </Field>
          <Field label="Course code" htmlFor={`g-course-${key}`} error={state.errors?.course_code} hint="Optional, e.g. NT219.Q11: shown on the group and its projects.">
            <Input id={`g-course-${key}`} name="course_code" defaultValue={group?.course_code ?? ""} maxLength={40} placeholder="NT219.Q11" className="uppercase" />
          </Field>
          <Field label="Description" htmlFor={`g-desc-${key}`} error={state.errors?.description}>
            <Textarea id={`g-desc-${key}`} name="description" defaultValue={group?.description ?? ""} maxLength={1000} className="min-h-16" />
          </Field>
          <fieldset>
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
          <div>
            <SubmitButton>{group ? "Save group" : "Create group"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={link} aria-label="Invite link" className="font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className={buttonClass("secondary", "md", "shrink-0")}
        onClick={async () => {
          await navigator.clipboard.writeText(link).catch(() => undefined);
          setCopied(true);
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function InviteForm({ groupId }: { groupId: string }) {
  const [state, action] = useActionState<InviteState, FormData>(inviteMember, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="group_id" value={groupId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <Field label="Email" htmlFor="inv-email" error={state.errors?.email} hint="The invite works only for this address.">
          <Input id="inv-email" name="email" type="email" required placeholder="classmate@gm.uit.edu.vn" />
        </Field>
        <Field label="Valid for" htmlFor="inv-days">
          <Select id="inv-days" name="days" defaultValue="7">
            {[1, 3, 7, 14].map((d) => (
              <option key={d} value={d}>
                {d} day{d > 1 ? "s" : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <SubmitButton pendingLabel="Inviting…">Send invite</SubmitButton>
      </div>
      {state.message ? <p className={state.ok ? "text-[13px] text-ok" : "text-[13px] text-danger"}>{state.message}</p> : null}
      {state.link && !state.emailed ? <CopyLink link={state.link} /> : null}
      {state.link ? <p className="text-[12px] text-muted">This link is shown only once. Anyone else who opens it cannot use it.</p> : null}
    </form>
  );
}
